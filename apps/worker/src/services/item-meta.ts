/**
 * 条目的**元数据补丁**（`PATCH /api/items/:id/meta`；M3–M4 从 `services/items.ts` 抽出）。
 *
 * 抽出来的原因有两条，都是实打实的：
 * 1. `items.ts` 顶到了 300 行预算（新增"单向类型变更"后 311 行）——这是仓库的硬约束；
 * 2. 补丁的校验规则（标题 / 文件夹 / 标签 / 置顶收藏 / 单篇加密 / 加密空间 / 类型变更）
 *    已经自成一块，与"创建 / 取正文 / 保存正文"是两条独立的演进线。
 *
 * 写路径与 `items.ts` 同一口径：**预检读 → 一个 batch（主写入 + 条件推进计数器）**，
 * 冲突时整批不产生改动；乐观锁走 `meta_rev`。
 */
import type { ItemMetaPatch } from "@menote/shared";
import {
  SQL_BUMP_SYNC_SEQ_ON_ITEM_META,
  SQL_SELECT_FOLDER_BY_ID,
  SQL_SELECT_ITEM_META_BASE,
  SQL_SELECT_USER_CRYPTO,
  buildUpdateItemMeta,
  type ItemMetaField,
} from "../db/tables";
import { DomainError } from "../errors";

/** 元数据补丁（`PATCH /api/items/:id/meta`）：按 `meta_rev` 乐观锁，不生成冲突副本 */
export async function patchItemMeta(
  db: D1Database,
  userId: string,
  id: string,
  patch: ItemMetaPatch,
  now: number,
): Promise<{ id: string; meta_rev: number }> {
  const base = await db
    .prepare(SQL_SELECT_ITEM_META_BASE)
    .bind(id, userId)
    .first<{ type: string; meta_rev: number; enc_self: number; in_enc_space: number }>();
  if (!base) throw new DomainError("not_found", "条目不存在");
  if (base.meta_rev !== patch.base_meta_rev) {
    throw new DomainError("meta_conflict", "条目已在其他设备更新", { meta_rev: base.meta_rev });
  }
  if (patch.title === null && base.type !== "memo") {
    throw new DomainError("invalid", "笔记与表格必须有标题");
  }

  /*
    **单向类型变更**（M4-9「降级为普通笔记」，2026-09-27 按用户拍板加入）：
    只允许 表格 → 笔记，且**加密内容不允许**（类型变更会让门禁与正文渲染都对不上）。
    契约侧已用 `picklist(["note"])` 收口取值，这里再核"当前确实是表格"与加密状态。
  */
  if (patch.type !== undefined) {
    if (base.type !== "table") {
      throw new DomainError("invalid", "只有表格可以降级为普通笔记");
    }
    if (base.enc_self === 1 || base.in_enc_space === 1) {
      throw new DomainError("invalid", "加密内容不能改类型，请先解除加密");
    }
  }

  const fields: ItemMetaField[] = [];
  const values: unknown[] = [];
  /** 目标文件夹（若本次补丁要改 `folder_id`）：`null` = 根目录，`undefined` = 没给 */
  let targetFolder: { id: string; is_enc_space: number; in_enc_space: number } | null = null;
  if (patch.title !== undefined) {
    fields.push("title");
    values.push(patch.title);
  }
  if (patch.folder_id !== undefined) {
    if (patch.folder_id !== null) {
      const folder = await db
        .prepare(SQL_SELECT_FOLDER_BY_ID)
        .bind(patch.folder_id, userId)
        .first<{ id: string; is_enc_space: number; in_enc_space: number }>();
      if (!folder) throw new DomainError("invalid", "目标文件夹不存在");
      targetFolder = folder;
    }
    fields.push("folder_id");
    values.push(patch.folder_id);
  }
  if (patch.tags !== undefined) {
    fields.push("tags");
    values.push(JSON.stringify(patch.tags));
  }
  if (patch.pinned !== undefined) {
    fields.push("pinned");
    values.push(patch.pinned);
  }
  if (patch.starred !== undefined) {
    fields.push("starred");
    values.push(patch.starred);
  }
  if (patch.enc_self !== undefined) {
    /**
     * 单篇加密（M3-7）。两条硬约束都在这里挡：
     * - **Memo 不做单篇**（Memo 在隐私范围内时的门禁由隐私锁负责；表上也有 CHECK 兜底）；
     * - **必须先启用隐私锁**：没有门禁材料时设 `enc_self = 1`，等于把内容"锁在一个没有门的房间里"，
     *   客户端事后无法解锁。所以宁可 422 也不接受。
     */
    if (patch.enc_self === 1) {
      if (base.type === "memo") {
        throw new DomainError("invalid", "Memo 不支持单篇加密");
      }
      const crypto = await db
        .prepare(SQL_SELECT_USER_CRYPTO)
        .bind(userId)
        .first<{ user_id: string }>();
      if (!crypto) {
        throw new DomainError("invalid", "还没有启用隐私锁，无法给单篇加密", {
          reason: "privacy_not_enabled",
        });
      }
    }
    fields.push("enc_self");
    values.push(patch.enc_self);
  }
  if (patch.in_enc_space !== undefined) {
    /**
     * 移入 / 移出加密空间（M3-8，《隐私锁设计》§6.3）。四条校验：
     * 1. **必须同时给 `folder_id`**：移入空间 = `folder_id` 指向空间行/空间内文件夹；
     *    两条一起写才不会出现"标记在空间里、却挂在普通文件夹下"这种自相矛盾的行；
     * 2. **移入时目标必须是空间的**（空间根或空间内文件夹）；
     * 3. **移出时目标不能在空间里**（否则等于没移出）；
     * 4. 移入还要求：不是 Memo、且已启用隐私锁（与单篇加密同一套理由）。
     */
    if (patch.folder_id === undefined) {
      throw new DomainError("invalid", "移入或移出加密空间时必须同时给出目标文件夹");
    }
    const inSpace =
      targetFolder !== null && (targetFolder.is_enc_space === 1 || targetFolder.in_enc_space === 1);

    if (patch.in_enc_space === 1) {
      if (base.type === "memo") {
        throw new DomainError("invalid", "Memo 不能放进加密空间");
      }
      if (!inSpace) {
        throw new DomainError("invalid", "移入加密空间的目标必须是空间根或空间内文件夹");
      }
      const crypto = await db
        .prepare(SQL_SELECT_USER_CRYPTO)
        .bind(userId)
        .first<{ user_id: string }>();
      if (!crypto) {
        throw new DomainError("invalid", "还没有启用隐私锁，无法移入加密空间", {
          reason: "privacy_not_enabled",
        });
      }
    } else if (inSpace) {
      throw new DomainError("invalid", "移出加密空间的目标不能在空间内");
    }

    fields.push("in_enc_space");
    values.push(patch.in_enc_space);
  }

  if (patch.type !== undefined) {
    // 取值已被契约收成 `"note"`，能走到这里就说明是合法的单向变更（上面已核过"当前是表格且未加密"）
    fields.push("type");
    values.push(patch.type);
  }

  if (fields.length === 0) {
    return { id, meta_rev: patch.base_meta_rev };
  }

  const results = await db.batch([
    db
      .prepare(buildUpdateItemMeta(fields))
      .bind(...values, now, userId, id, userId, patch.base_meta_rev),
    db.prepare(SQL_BUMP_SYNC_SEQ_ON_ITEM_META).bind(userId, id, patch.base_meta_rev + 1, now),
  ]);

  if ((results[0]?.meta.changes ?? 0) !== 1) {
    const after = await db
      .prepare(SQL_SELECT_ITEM_META_BASE)
      .bind(id, userId)
      .first<{ meta_rev: number }>();
    throw new DomainError("meta_conflict", "条目已在其他设备更新", {
      meta_rev: after?.meta_rev ?? patch.base_meta_rev,
    });
  }

  return { id, meta_rev: patch.base_meta_rev + 1 };
}

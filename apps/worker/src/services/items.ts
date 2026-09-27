/**
 * 条目服务：新建、取正文、全文保存、元数据补丁（口径见 `docs/modules/Menote-同步引擎设计-v1.md` §3.4）。
 *
 * 写路径统一是"预检读 → 一个 batch（主写入 + 正文/副作用 + 条件推进计数器）"，判定冲突读
 * `results[0].meta.changes`；冲突时整批不产生任何改动。
 *
 * **已知取舍**：服务端不重算正文哈希（省掉大文档上的一次 SHA-256，10 ms CPU 预算内更稳），
 * 因此 `content_hash` 与正文的一致性由客户端保证；服务端只保证"写入原子 + 冲突不污染"。
 */
import {
  BODY_HARD_LIMIT_BYTES,
  countCodePoints,
  utf8ByteLength,
  type ItemMetaPatch,
  type ItemType,
} from "@menote/shared";
import {
  SQL_BUMP_SYNC_SEQ_ON_ITEM_BODY,
  SQL_BUMP_SYNC_SEQ_ON_ITEM_CREATE,
  SQL_BUMP_SYNC_SEQ_ON_ITEM_META,
  SQL_INSERT_ITEM,
  SQL_SELECT_FOLDER_BY_ID,
  SQL_SELECT_ITEM_BODY,
  SQL_SELECT_ITEM_META_BASE,
  SQL_SELECT_USER_CRYPTO,
  SQL_SELECT_ITEM_REV,
  SQL_UPDATE_ITEM_BODY,
  SQL_UPSERT_ITEM_BODY,
  buildUpdateItemMeta,
  type ItemMetaField,
} from "../db/tables";
import { DomainError } from "../errors";

export interface CreateItemInput {
  id: string;
  type: ItemType;
  title: string | null;
  folderId: string | null;
  tags: string[];
  memoAt: number | null;
  isTask: 0 | 1;
  taskStatus: string | null;
  taskDue: string | null;
  taskPriority: string | null;
  contentHash: string;
  body: string;
  deviceLabel: string | null;
}

export interface ItemBodyWriteResult {
  id: string;
  rev: number;
  bytes: number;
  chars: number;
}

interface ItemRevRow {
  rev: number;
  content_hash: string;
}

function tooLarge(): DomainError {
  return new DomainError("too_large", "已达硬上限，无法继续保存，请拆分内容");
}

/** 表级 CHECK 的等价校验：提前拦掉，避免把约束失败变成 500 */
function assertItemShape(input: CreateItemInput): void {
  if (input.type === "memo") {
    if (input.folderId !== null) throw new DomainError("invalid", "Memo 不能放在文件夹里");
    if (input.memoAt === null) throw new DomainError("invalid", "Memo 必须有时间戳");
    if (input.title !== null) throw new DomainError("invalid", "Memo 没有独立标题");
    return;
  }
  if (input.title === null) throw new DomainError("invalid", "笔记与表格必须有标题");
}

async function measure(body: string): Promise<{ bytes: number; chars: number }> {
  const bytes = utf8ByteLength(body);
  if (bytes > BODY_HARD_LIMIT_BYTES) throw tooLarge();
  return { bytes, chars: countCodePoints(body) };
}

/**
 * 新建（`PUT /api/items/:id`）：ID 由客户端生成。
 * 已存在时按内容哈希判定——相同视为幂等重放（200），不同返回 409（客户端据此生成冲突副本）。
 */
export async function createItem(
  db: D1Database,
  userId: string,
  input: CreateItemInput,
  now: number,
): Promise<ItemBodyWriteResult> {
  assertItemShape(input);
  const { bytes, chars } = await measure(input.body);

  const existing = await db
    .prepare(SQL_SELECT_ITEM_REV)
    .bind(input.id, userId)
    .first<ItemRevRow>();
  if (existing) {
    if (existing.content_hash === input.contentHash) {
      return { id: input.id, rev: existing.rev, bytes, chars };
    }
    throw new DomainError("rev_conflict", "该条目已存在且内容不同", {
      rev: existing.rev,
      content_hash: existing.content_hash,
    });
  }

  const results = await db.batch([
    db
      .prepare(SQL_INSERT_ITEM)
      .bind(
        input.id,
        userId,
        input.type,
        input.folderId,
        input.title,
        bytes,
        input.contentHash,
        JSON.stringify(input.tags),
        input.memoAt,
        input.isTask,
        input.taskStatus,
        input.taskDue,
        input.taskPriority,
        0,
        0,
        userId,
        now,
        now,
        now,
        input.deviceLabel,
        input.id,
      ),
    db.prepare(SQL_UPSERT_ITEM_BODY).bind(input.id, input.body, input.id, userId, 1, input.contentHash),
    db.prepare(SQL_BUMP_SYNC_SEQ_ON_ITEM_CREATE).bind(userId, input.id, now),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 1) {
    return { id: input.id, rev: 1, bytes, chars };
  }

  // 极小窗口：预检后同一 id 被并发创建
  const after = await db.prepare(SQL_SELECT_ITEM_REV).bind(input.id, userId).first<ItemRevRow>();
  if (after && after.content_hash === input.contentHash) {
    return { id: input.id, rev: after.rev, bytes, chars };
  }
  throw new DomainError("rev_conflict", "该条目已存在且内容不同", {
    rev: after?.rev ?? 0,
    content_hash: after?.content_hash ?? "",
  });
}

/** 取正文（`GET /api/items/:id/body`）；不存在或不属于当前用户都返回 null */
export async function getItemBody(
  db: D1Database,
  userId: string,
  id: string,
): Promise<{ body: string; contentHash: string } | null> {
  const row = await db
    .prepare(SQL_SELECT_ITEM_BODY)
    .bind(id, userId)
    .first<{ body: string; content_hash: string }>();
  if (!row) return null;
  return { body: row.body, contentHash: row.content_hash };
}

/**
 * 全文保存（`PUT /api/items/:id/body`）。
 *
 * 预检把三种情况分开，**都不写库**：条目不存在（404）、上次其实已成功（200）、真冲突（409）。
 * 只有 `rev` 与基版本一致时才走 batch，避免"重放空推计数器"。
 */
export async function saveItemBody(
  db: D1Database,
  userId: string,
  id: string,
  baseRev: number,
  contentHash: string,
  body: string,
  deviceLabel: string | null,
  now: number,
): Promise<ItemBodyWriteResult> {
  const { bytes, chars } = await measure(body);

  const current = await db
    .prepare(SQL_SELECT_ITEM_REV)
    .bind(id, userId)
    .first<ItemRevRow>();
  if (!current) throw new DomainError("not_found", "条目不存在");
  if (current.rev !== baseRev) {
    if (current.content_hash === contentHash) {
      // 上次写入其实已成功，只是响应丢了
      return { id, rev: current.rev, bytes, chars };
    }
    throw new DomainError("rev_conflict", "版本冲突", {
      rev: current.rev,
      content_hash: current.content_hash,
    });
  }

  const results = await db.batch([
    db
      .prepare(SQL_UPDATE_ITEM_BODY)
      .bind(bytes, contentHash, now, now, deviceLabel, userId, id, userId, baseRev),
    db.prepare(SQL_UPSERT_ITEM_BODY).bind(id, body, id, userId, baseRev + 1, contentHash),
    db
      .prepare(SQL_BUMP_SYNC_SEQ_ON_ITEM_BODY)
      .bind(userId, id, baseRev + 1, contentHash),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 1) {
    return { id, rev: baseRev + 1, bytes, chars };
  }

  // 极小窗口：预检通过后被并发抢先
  const after = await db.prepare(SQL_SELECT_ITEM_REV).bind(id, userId).first<ItemRevRow>();
  if (after && after.content_hash === contentHash) {
    return { id, rev: after.rev, bytes, chars };
  }
  throw new DomainError("rev_conflict", "版本冲突", {
    rev: after?.rev ?? baseRev,
    content_hash: after?.content_hash ?? "",
  });
}

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
    .first<{ type: string; meta_rev: number }>();
  if (!base) throw new DomainError("not_found", "条目不存在");
  if (base.meta_rev !== patch.base_meta_rev) {
    throw new DomainError("meta_conflict", "条目已在其他设备更新", { meta_rev: base.meta_rev });
  }
  if (patch.title === null && base.type !== "memo") {
    throw new DomainError("invalid", "笔记与表格必须有标题");
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
    const inSpace = targetFolder !== null && (targetFolder.is_enc_space === 1 || targetFolder.in_enc_space === 1);

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

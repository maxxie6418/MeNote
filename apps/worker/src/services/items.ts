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
  if (patch.title !== undefined) {
    fields.push("title");
    values.push(patch.title);
  }
  if (patch.folder_id !== undefined) {
    if (patch.folder_id !== null) {
      const folder = await db
        .prepare(SQL_SELECT_FOLDER_BY_ID)
        .bind(patch.folder_id, userId)
        .first<{ id: string }>();
      if (!folder) throw new DomainError("invalid", "目标文件夹不存在");
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

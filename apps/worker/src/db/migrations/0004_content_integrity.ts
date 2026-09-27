/**
 * 0004 内容完整性六表（M4；权威定义 = `docs/modules/Menote-M4-设计-v1.md` §六）。
 *
 * 六张表分属三摊，但**一次迁移一起建**（都属"内容完整性"这条主线，且互相有引用关系）：
 * 1. **附件**：`attachments`（原图与缩略图各一行，缩略图 `parent_id` 指原图）+ `attachment_refs`（哪条/哪个版本引用了它）；
 * 2. **版本**：`item_versions`（元数据；正文在 R2 `v/{uid}/{item_id}/{version_id}`）；
 * 3. **传播与清理**：`tombstones`（物理删除的同步传播）、`r2_gc_queue`（R2 待删队列）、
 *    `pending_uploads`（上传登记，24 小时未落元数据即视为孤儿）。
 *
 * 与 0001/0003 同样的两条硬约束：每条语句必须**单行**（D1 的 exec/batch 按语句执行，多行 DDL 会被切坏）、
 * 必须幂等（`IF NOT EXISTS`，迁移失败后会被重跑）。
 *
 * **三处刻意的设计取舍**（都在设计 §六 有话）：
 * - **`attachment_refs` 不设主键、不设外键**：它的唯一性靠 `(item_id, IFNULL(version_id,''), attachment_id)`
 *   这个表达式唯一索引（SQLite 的唯一索引允许表达式），而 `version_id` 为 NULL 表示"当前稿引用"；
 * - **`attachments` 的身份 = `(user_id, sha256, kind)`**，缩略图沿用原图的 `sha256`——
 *   于是重复上传同一文件会复用两行（秒传），R2 键也确定（`a/{uid}/{sha256}` 与 `a/{uid}/{sha256}.t`）；
 * - **六张表都不进普通同步游标**：`item_versions` 与附件走各自的端点/界面，
 *   `tombstones` 由 M4 的同步协议扩展单独带回（设计 §5.3），所以这里**没有 `sync_seq` 之外的通用约定**。
 */
import type { MigrationScript } from "./0001_init";

export const migration0004: MigrationScript = {
  version: 4,
  statements: [
    // —— 1 附件 ——
    "CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('original','thumb')), parent_id TEXT, sha256 TEXT NOT NULL, r2_key TEXT NOT NULL, mime TEXT, size_bytes INTEGER NOT NULL CHECK (size_bytes <= 20971520), width INTEGER, height INTEGER, filename TEXT, orphaned_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_dedupe ON attachments(user_id, sha256, kind)",
    "CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments(user_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_attachments_orphan ON attachments(user_id, orphaned_at)",
    // —— 2 引用 ——
    "CREATE TABLE IF NOT EXISTS attachment_refs (item_id TEXT NOT NULL, version_id TEXT, attachment_id TEXT NOT NULL, created_at INTEGER NOT NULL)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_attachment_refs_unique ON attachment_refs(item_id, IFNULL(version_id, ''), attachment_id)",
    "CREATE INDEX IF NOT EXISTS idx_attachment_refs_attachment ON attachment_refs(attachment_id)",
    "CREATE INDEX IF NOT EXISTS idx_attachment_refs_item ON attachment_refs(item_id)",
    // —— 3 版本元数据 ——
    "CREATE TABLE IF NOT EXISTS item_versions (id TEXT PRIMARY KEY, item_id TEXT NOT NULL, user_id TEXT NOT NULL, rev INTEGER NOT NULL, reason TEXT NOT NULL, label TEXT, keep INTEGER NOT NULL DEFAULT 0, codec TEXT NOT NULL CHECK (codec IN ('gzip','none')), size_bytes INTEGER NOT NULL, content_hash TEXT NOT NULL, title TEXT, r2_key TEXT NOT NULL, created_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_versions_item ON item_versions(user_id, item_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_versions_sweep ON item_versions(user_id, keep, created_at)",
    // —— 4 墓碑 ——
    "CREATE TABLE IF NOT EXISTS tombstones (user_id TEXT NOT NULL, entity TEXT NOT NULL CHECK (entity IN ('item','folder')), entity_id TEXT NOT NULL, sync_seq INTEGER NOT NULL, deleted_at INTEGER NOT NULL)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tombstones_entity ON tombstones(user_id, entity, entity_id)",
    "CREATE INDEX IF NOT EXISTS idx_tombstones_seq ON tombstones(user_id, sync_seq)",
    // —— 5 R2 待删队列 ——
    "CREATE TABLE IF NOT EXISTS r2_gc_queue (r2_key TEXT PRIMARY KEY, user_id TEXT NOT NULL, reason TEXT NOT NULL CHECK (reason IN ('delete','replace','orphan')), due_at INTEGER NOT NULL, created_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_r2_gc_due ON r2_gc_queue(due_at)",
    // —— 6 上传登记 ——
    "CREATE TABLE IF NOT EXISTS pending_uploads (r2_key TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, due_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_pending_uploads_due ON pending_uploads(due_at)",
  ],
};

/** 0004 建立的表（selfheal 的完整性校验与测试都用它，避免两处各写一份） */
export const M4_TABLE_NAMES = [
  "attachments",
  "attachment_refs",
  "item_versions",
  "tombstones",
  "r2_gc_queue",
  "pending_uploads",
] as const;

/** 0004 建立的索引（逐条登记：索引不计入校验会漏配，与 0001 的写法一致） */
export const M4_INDEX_NAMES = [
  "idx_attachments_dedupe",
  "idx_attachments_user",
  "idx_attachments_orphan",
  "idx_attachment_refs_unique",
  "idx_attachment_refs_attachment",
  "idx_attachment_refs_item",
  "idx_versions_item",
  "idx_versions_sweep",
  "idx_tombstones_entity",
  "idx_tombstones_seq",
  "idx_r2_gc_due",
  "idx_pending_uploads_due",
] as const;

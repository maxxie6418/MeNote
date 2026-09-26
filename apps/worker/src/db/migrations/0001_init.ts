/**
 * 0001 初始表结构（架构 §15.4：按序号命名、幂等、单脚本 ≤ 45 条语句）。
 *
 * 内容 = `docs/modules/Menote-数据模型与迁移设计-v1.md` §3.2 的权威 DDL（新隐私模型：
 * 不含 title_enc / name_enc / body_enc / key_id / data_keys / user_crypto 密钥列）。
 *
 * 两条硬约束：
 * 1. 每条语句必须**单行**——D1 的 `exec()` 按换行切分语句，多行 DDL 会被切坏。
 * 2. 每条语句必须幂等（`IF NOT EXISTS`），因为迁移可能在失败后被重跑。
 *
 * 已在 SQLite（Node 22 `node:sqlite`）上预演通过：DDL 数量、幂等、全部 CHECK 正反例、
 * 部分唯一索引、`COLLATE NOCASE` 唯一性。见该设计稿 §3.2 末注。
 */
export interface MigrationScript {
  /** 从 1 递增；`app_meta.schema_version` 达到该值即视为已应用 */
  readonly version: number;
  readonly statements: readonly string[];
}

export const migration0001: MigrationScript = {
  version: 1,
  statements: [
    // 1 实例元数据
    "CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    // 2 用户
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, role TEXT NOT NULL CHECK (role IN ('owner','member')), auth_salt BLOB NOT NULL, auth_kdf TEXT NOT NULL, auth_verifier BLOB NOT NULL, status TEXT NOT NULL DEFAULT 'active', sync_seq INTEGER NOT NULL DEFAULT 0, tombstone_floor INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    // 3 会话（只存令牌的 SHA-256）
    "CREATE TABLE IF NOT EXISTS sessions (token_hash BLOB PRIMARY KEY, user_id TEXT NOT NULL, device_label TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)",
    // 4 登录失败计数（只在失败时写）
    "CREATE TABLE IF NOT EXISTS auth_throttle (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, failures INTEGER NOT NULL, locked_until INTEGER)",
    // 5 用户设置（M1 只建表，通用页在 M2）
    "CREATE TABLE IF NOT EXISTS user_settings (user_id TEXT PRIMARY KEY, json TEXT NOT NULL DEFAULT '{}', rev INTEGER NOT NULL DEFAULT 1, sync_seq INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)",
    // 6 文件夹：普通文件夹 depth 为 1/2，加密空间是每用户一条 depth=0 的内置记录
    "CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, parent_id TEXT, is_enc_space INTEGER NOT NULL DEFAULT 0, in_enc_space INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, depth INTEGER NOT NULL, position REAL NOT NULL DEFAULT 0, meta_rev INTEGER NOT NULL DEFAULT 1, sync_seq INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER, CHECK (depth BETWEEN 0 AND 2), CHECK (is_enc_space = 0 OR (depth = 0 AND parent_id IS NULL AND in_enc_space = 0)), CHECK (is_enc_space = 1 OR depth BETWEEN 1 AND 2), CHECK (in_enc_space = 0 OR is_enc_space = 0))",
    "CREATE INDEX IF NOT EXISTS idx_folders_sync ON folders(user_id, sync_seq)",
    "CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(user_id, parent_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_enc_space ON folders(user_id) WHERE is_enc_space = 1",
    // 7 条目元数据（不含正文）
    "CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('note','table','memo')), folder_id TEXT, title TEXT, enc_self INTEGER NOT NULL DEFAULT 0, in_enc_space INTEGER NOT NULL DEFAULT 0, size_bytes INTEGER NOT NULL CHECK (size_bytes <= 1900000), content_hash TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', memo_at INTEGER, is_task INTEGER NOT NULL DEFAULT 0, task_status TEXT, task_due TEXT, task_priority TEXT, pinned INTEGER NOT NULL DEFAULT 0, starred INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 1, meta_rev INTEGER NOT NULL DEFAULT 1, sealed_rev INTEGER, sync_seq INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_edit_at INTEGER, last_device TEXT, deleted_at INTEGER, CHECK (type <> 'memo' OR in_enc_space = 0), CHECK (type <> 'memo' OR enc_self = 0), CHECK (type = 'memo' OR title IS NOT NULL), CHECK (type <> 'memo' OR folder_id IS NULL), CHECK (type <> 'memo' OR memo_at IS NOT NULL))",
    "CREATE INDEX IF NOT EXISTS idx_items_sync ON items(user_id, sync_seq)",
    "CREATE INDEX IF NOT EXISTS idx_items_folder ON items(user_id, folder_id, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_items_memo ON items(user_id, memo_at DESC) WHERE type = 'memo'",
    "CREATE INDEX IF NOT EXISTS idx_items_task ON items(user_id, task_status, task_due) WHERE is_task = 1",
    "CREATE INDEX IF NOT EXISTS idx_items_trash ON items(user_id, deleted_at) WHERE deleted_at IS NOT NULL",
    // 8 正文：一条一行，恒为明文
    "CREATE TABLE IF NOT EXISTS item_bodies (item_id TEXT PRIMARY KEY, body TEXT NOT NULL, CHECK (length(CAST(body AS BLOB)) <= 1900000))",
  ],
};

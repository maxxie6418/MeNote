/**
 * 业务 SQL 常量（架构 §2.3.2：SQL 常量归 `db/tables.ts`）。
 *
 * 约定：
 * - 对用户数据的每个查询都带 `user_id` 条件（架构 §13.2 多用户隔离）；
 * - 服务层只做参数绑定与结果映射，**不在这里拼字符串**；
 * - 条件写（乐观锁）一律带 `rev` / `meta_rev`，并检查影响行数。
 */

// —— app_meta（实例级键值：schema_version / migration_lock / 注册开关）——

export const SQL_SELECT_APP_META = "SELECT value FROM app_meta WHERE key = ?";

export const SQL_UPSERT_APP_META =
  "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value";

// —— users ——

export const SQL_SELECT_USER_BY_USERNAME =
  "SELECT id, username, role, auth_salt, auth_kdf, auth_verifier, status FROM users WHERE username = ?";

export const SQL_SELECT_USER_BY_ID =
  "SELECT id, username, role, auth_salt, auth_kdf, auth_verifier, status FROM users WHERE id = ?";

export const SQL_COUNT_USERS = "SELECT COUNT(*) AS count FROM users";

/**
 * 注册：一条语句同时判定"库中无用户"或"注册开关开启且未到期"，并在库中无用户时写 `role = 'owner'`，
 * 避免两个并发的首次注册都成为 owner（架构 §13.1）。参数（8 个）：
 * id、username、auth_salt、auth_kdf、auth_verifier、created_at、updated_at、now(用于到期比较)。
 */
export const SQL_INSERT_USER = `INSERT INTO users (id, username, role, auth_salt, auth_kdf, auth_verifier, status, created_at, updated_at)
SELECT ?, ?, CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 'owner' ELSE 'member' END, ?, ?, ?, 'active', ?, ?
 WHERE (SELECT COUNT(*) FROM users) = 0
    OR (COALESCE((SELECT value FROM app_meta WHERE key = 'registration_open'), '0') = '1'
        AND (CAST(COALESCE((SELECT value FROM app_meta WHERE key = 'registration_close_at'), '0') AS INTEGER) = 0
             OR CAST((SELECT value FROM app_meta WHERE key = 'registration_close_at') AS INTEGER) > ?))`;

export const SQL_UPDATE_USER_PASSWORD =
  "UPDATE users SET auth_salt = ?, auth_kdf = ?, auth_verifier = ?, updated_at = ? WHERE id = ?";

// —— sessions（库里只存令牌的 SHA-256）——

export const SQL_INSERT_SESSION =
  "INSERT INTO sessions (token_hash, user_id, device_label, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)";

/** 校验会话并一次取回用户身份（1 次 D1 读，符合 §14.2 的预算） */
export const SQL_SELECT_SESSION_USER = `SELECT s.user_id AS id, u.username AS username, u.role AS role, s.expires_at AS expires_at
  FROM sessions s JOIN users u ON u.id = s.user_id
 WHERE s.token_hash = ? AND u.status = 'active'`;

/** 滑动续期：每天最多写一次（需求 §5.4） */
export const SQL_TOUCH_SESSION =
  "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ? AND last_seen_at < ?";

export const SQL_DELETE_SESSION = "DELETE FROM sessions WHERE token_hash = ?";

export const SQL_DELETE_OTHER_SESSIONS = "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?";

export const SQL_COUNT_OTHER_SESSIONS =
  "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND token_hash != ?";

// —— auth_throttle（登录失败计数；只在失败时写）——

export const SQL_SELECT_THROTTLE =
  "SELECT window_start, failures, locked_until FROM auth_throttle WHERE key = ?";

export const SQL_UPSERT_THROTTLE = `INSERT INTO auth_throttle (key, window_start, failures, locked_until)
VALUES (?, ?, ?, ?)
ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, failures = excluded.failures, locked_until = excluded.locked_until`;

export const SQL_DELETE_THROTTLE = "DELETE FROM auth_throttle WHERE key = ?";

// —— items：条件 batch 写模式（需求 §18.3 + 设计稿《同步引擎设计》§3.4）——
//
// 三条语句必须在同一个 batch 内（单事务、按序执行）：
//   ① 主写入以 rev 为条件，sync_seq 取"将要写入的值"（子查询，不推进计数器）
//   ② 正文写入挂在"主写入已生效"之上（rev + content_hash 双守卫），用 upsert 兼容正文行缺失
//   ③ 计数器只在主写入确实生效时才推进
// 判定冲突读 results[0].meta.changes；冲突时整批不产生任何改动。

/** 预检读：存在性 + 当前版本与哈希（batch 之前的 1 次读） */
export const SQL_SELECT_ITEM_REV = "SELECT rev, content_hash FROM items WHERE id = ? AND user_id = ?";

/** 预检读：仅哈希（新建时判断是否重放） */
export const SQL_SELECT_ITEM_HASH = "SELECT content_hash FROM items WHERE id = ? AND user_id = ?";

/** 新建：`NOT EXISTS` 只判 id（id 是全局主键；带 user_id 会在他人占用时撞主键异常） */
export const SQL_INSERT_ITEM = `INSERT INTO items (id, user_id, type, folder_id, title, enc_self, in_enc_space, size_bytes, content_hash, tags, memo_at, is_task, task_status, task_due, task_priority, pinned, starred, rev, meta_rev, sealed_rev, sync_seq, created_at, updated_at, last_edit_at, last_device, deleted_at)
SELECT ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NULL, (SELECT sync_seq + 1 FROM users WHERE id = ?), ?, ?, ?, ?, NULL
 WHERE NOT EXISTS (SELECT 1 FROM items WHERE id = ?)`;

/** 新建路径的计数器推进：以"本次创建的那一行"为条件（读的是 +1，推进后与行上写的值一致） */
export const SQL_BUMP_SYNC_SEQ_ON_ITEM_CREATE = `UPDATE users SET sync_seq = sync_seq + 1
 WHERE id = ? AND EXISTS (SELECT 1 FROM items WHERE id = ? AND rev = 1 AND created_at = ?)`;

/** 正文保存的主写入（rev 条件） */
export const SQL_UPDATE_ITEM_BODY = `UPDATE items
   SET rev = rev + 1, size_bytes = ?, content_hash = ?, updated_at = ?, last_edit_at = ?, last_device = ?,
       sync_seq = (SELECT sync_seq + 1 FROM users WHERE id = ?)
 WHERE id = ? AND user_id = ? AND rev = ?`;

/** 正文 upsert：守卫为 rev + content_hash（只判 rev 会被并发落败者覆盖） */
export const SQL_UPSERT_ITEM_BODY = `INSERT INTO item_bodies (item_id, body)
SELECT ?, ?
 WHERE EXISTS (SELECT 1 FROM items WHERE id = ? AND user_id = ? AND rev = ? AND content_hash = ?)
ON CONFLICT(item_id) DO UPDATE SET body = excluded.body`;

/** 正文保存的计数器推进（守卫与上面一致） */
export const SQL_BUMP_SYNC_SEQ_ON_ITEM_BODY = `UPDATE users SET sync_seq = sync_seq + 1
 WHERE id = ? AND EXISTS (SELECT 1 FROM items WHERE id = ? AND rev = ? AND content_hash = ?)`;

export const SQL_SELECT_ITEM_BODY = `SELECT i.content_hash AS content_hash, b.body AS body
  FROM items i JOIN item_bodies b ON b.item_id = i.id
 WHERE i.id = ? AND i.user_id = ?`;

export const SQL_SELECT_ITEM_META_REV = "SELECT meta_rev FROM items WHERE id = ? AND user_id = ?";

/** 元数据补丁前的预检：需要知道类型（Memo 才允许无标题）与当前 meta_rev */
export const SQL_SELECT_ITEM_META_BASE =
  "SELECT type, meta_rev FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NULL";

/** 元数据补丁允许更新的列（白名单；列名一律来自常量，绝不来自请求） */
export type ItemMetaField = "title" | "folder_id" | "tags" | "pinned" | "starred";

/** 组装元数据补丁语句：`SET` 子句由白名单列拼出（服务层不写 SQL 字面量） */
export function buildUpdateItemMeta(fields: readonly ItemMetaField[]): string {
  const sets = fields.map((field) => `${field} = ?`).join(", ");
  return `UPDATE items SET ${sets}, meta_rev = meta_rev + 1, updated_at = ?,
       sync_seq = (SELECT sync_seq + 1 FROM users WHERE id = ?)
 WHERE id = ? AND user_id = ? AND meta_rev = ?`;
}

/** 元数据补丁的计数器推进：用 `updated_at = 本次时间` 收紧守卫（元数据没有哈希可比） */
export const SQL_BUMP_SYNC_SEQ_ON_ITEM_META = `UPDATE users SET sync_seq = sync_seq + 1
 WHERE id = ? AND EXISTS (SELECT 1 FROM items WHERE id = ? AND meta_rev = ? AND updated_at = ?)`;

// —— folders ——

export const SQL_SELECT_FOLDER_BY_ID =
  "SELECT id, parent_id, depth, meta_rev FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL";

export const SQL_COUNT_FOLDER_CHILDREN =
  "SELECT COUNT(*) AS count FROM folders WHERE user_id = ? AND parent_id = ? AND deleted_at IS NULL";

/** 新建文件夹：ID 由客户端生成，depth 由服务层按父节点算好传入 */
export const SQL_INSERT_FOLDER = `INSERT INTO folders (id, user_id, parent_id, is_enc_space, in_enc_space, name, depth, position, meta_rev, sync_seq, created_at, updated_at, deleted_at)
SELECT ?, ?, ?, 0, 0, ?, ?, 0, 1, (SELECT sync_seq + 1 FROM users WHERE id = ?), ?, ?, NULL
 WHERE NOT EXISTS (SELECT 1 FROM folders WHERE id = ?)`;

export const SQL_BUMP_SYNC_SEQ_ON_FOLDER_CREATE = `UPDATE users SET sync_seq = sync_seq + 1
 WHERE id = ? AND EXISTS (SELECT 1 FROM folders WHERE id = ? AND meta_rev = 1 AND created_at = ?)`;

/** 文件夹补丁允许更新的列（白名单） */
export type FolderField = "name" | "parent_id" | "depth";

export function buildUpdateFolder(fields: readonly FolderField[]): string {
  const sets = fields.map((field) => `${field} = ?`).join(", ");
  return `UPDATE folders SET ${sets}, meta_rev = meta_rev + 1, updated_at = ?,
       sync_seq = (SELECT sync_seq + 1 FROM users WHERE id = ?)
 WHERE id = ? AND user_id = ? AND meta_rev = ? AND deleted_at IS NULL`;
}

export const SQL_BUMP_SYNC_SEQ_ON_FOLDER_META = `UPDATE users SET sync_seq = sync_seq + 1
 WHERE id = ? AND EXISTS (SELECT 1 FROM folders WHERE id = ? AND meta_rev = ? AND updated_at = ?)`;

// —— 增量拉取（架构 §6.1、设计稿《同步引擎设计》§3.2/§3.3）——
//
// 只回元数据、不含正文；按 sync_seq 升序；每类多取 1 行用于判断 has_more（LIMIT = 上限 + 1）。

export const SQL_SELECT_USER_TOMBSTONE_FLOOR =
  "SELECT tombstone_floor FROM users WHERE id = ?";

export const SQL_SELECT_ITEMS_SINCE = `SELECT id, type, folder_id, title, enc_self, in_enc_space, size_bytes,
       content_hash, tags, memo_at, is_task, task_status, task_due, task_priority, pinned, starred,
       rev, meta_rev, sealed_rev, sync_seq, created_at, updated_at, last_edit_at, last_device, deleted_at
  FROM items
 WHERE user_id = ? AND sync_seq > ?
 ORDER BY sync_seq
 LIMIT ?`;

export const SQL_SELECT_FOLDERS_SINCE = `SELECT id, parent_id, is_enc_space, in_enc_space, name, depth,
       position, meta_rev, sync_seq, created_at, updated_at, deleted_at
  FROM folders
 WHERE user_id = ? AND sync_seq > ?
 ORDER BY sync_seq
 LIMIT ?`;

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

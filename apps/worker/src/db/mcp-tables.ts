/**
 * MCP 专用 SQL 常量（架构 §2.3.2 的落点表把 SQL 常量归 `db/tables.ts`）。
 *
 * **为什么单独一个文件**：`db/tables.ts` 已有 430 行，而 ESLint 的 `max-lines` 预算是
 * >300 警告 / >500 失败。MCP 要加 30 条上下（令牌、审计、幂等、范围查询、计数查询），
 * 铺进去必然越线。沿用 `db/privacy.ts` 的先例（它也是从 `tables.ts` 里独立出来的）。
 *
 * 与 `db/tables.ts` 同款约定：对用户数据的每个查询都带 `user_id` 条件（架构 §13.2）；
 * 服务层只做参数绑定与结果映射，不在这里拼字符串。
 */
import { PRIVACY_EXCLUDE_SQL } from "./privacy";

// —— api_tokens ——

/** 建令牌。参数顺序即列顺序（`rate_window_start` 留空 = 还没用过，计数从 0 起） */
export const SQL_INSERT_API_TOKEN =
  "INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, perms, folder_scope, include_memos, allow_url, rate_per_min, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

/**
 * 按哈希取令牌（每次 MCP 调用的第 1 步）。
 *
 * **哈希查的是"整个令牌串"**（含 `mn_` 前缀），不是裸随机字节——见 `services/mcp/tokens.ts`
 * 的说明：会话令牌恰好也是 32 字节 base64url，两边都哈希裸字节就能互相冒充。
 *
 * 连 `revoked_at` / `expires_at` 一起取，鉴权的撤销与过期判定不必再读一次。
 */
export const SQL_SELECT_API_TOKEN_BY_HASH = `SELECT id, user_id, name, token_prefix, perms, folder_scope, include_memos, allow_url, rate_per_min, rate_window_start, rate_call_count, expires_at, created_at, last_used_at, revoked_at
  FROM api_tokens WHERE token_hash = ?`;

/** 管理侧取单条（核归属用） */
export const SQL_SELECT_API_TOKEN_BY_ID = `SELECT id, user_id, name, token_prefix, perms, folder_scope, include_memos, allow_url, rate_per_min, rate_window_start, rate_call_count, expires_at, created_at, last_used_at, revoked_at
  FROM api_tokens WHERE id = ? AND user_id = ?`;

/** 我的令牌列表：未撤销的在前，同组内按创建时间倒序 */
export const SQL_LIST_API_TOKENS = `SELECT id, user_id, name, token_prefix, perms, folder_scope, include_memos, allow_url, rate_per_min, rate_window_start, rate_call_count, expires_at, created_at, last_used_at, revoked_at
  FROM api_tokens WHERE user_id = ? ORDER BY (revoked_at IS NOT NULL), created_at DESC`;

/**
 * 有效令牌数（设计 §17.3 的 20 个上限）。
 *
 * 「有效」＝ 未撤销**且**（永不过期 或 还没到期）——过期的不占额度，否则用户
 * 攒一堆过期令牌就再也建不了新的了。
 */
export const SQL_COUNT_ACTIVE_API_TOKENS = `SELECT COUNT(*) AS count FROM api_tokens
  WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`;

/**
 * 撤销：只置 `revoked_at`，**不物理删**。
 *
 * 审计行还要指回 `token_id`（设计 §七），删了就断链；而且"这枚令牌曾经存在、
 * 后来被撤销"本身就是审计信息。
 */
export const SQL_REVOKE_API_TOKEN =
  "UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL";

/**
 * 限速窗口内的计数自增（设计 §3.5）。
 *
 * 用**条件自增**而不是"读出来算好再写回去"：后者在并发下会让两个请求都读到 count=59、
 * 都判定通过、然后都写 60，等于同一窗口多放行 2 次。条件自增让它们在同一条语句上排队，
 * 只有一个能把 changes 拿到 1。`WHERE rate_window_start = ?` 则是为了识别"窗口已被别人推过"。
 */
export const SQL_BUMP_API_TOKEN_CALL = `UPDATE api_tokens SET rate_call_count = rate_call_count + 1, last_used_at = ?
  WHERE id = ? AND rate_window_start = ?`;

/** 跨窗口：重置计数并记下新窗口；顺带刷新 `last_used_at`（与计数同一条语句，设计 §3.5） */
export const SQL_RESET_API_TOKEN_WINDOW =
  "UPDATE api_tokens SET rate_window_start = ?, rate_call_count = 1, last_used_at = ? WHERE id = ?";

/** 只刷 `last_used_at`（限速判定已在内存里完成、这次不计数时用；批 2 落地） */
export const SQL_TOUCH_API_TOKEN_LAST_USED =
  "UPDATE api_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)";

// —— audit_log ——

/**
 * 写审计。与写入**同一个 `db.batch`**（架构 §十一），所以它是纯 INSERT、不带条件。
 *
 * `token_id` 可空：将来若出现无令牌的内部调用也能记一行，而 `user_id` 永远必填。
 */
export const SQL_INSERT_AUDIT_LOG =
  "INSERT INTO audit_log (id, user_id, token_id, tool, item_id, rev_before, rev_after, result, operation_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

/**
 * 某令牌的审计分页（设计 §七）。
 *
 * 排序 `(at DESC, id DESC)` 而不是只 `at DESC`：**同一毫秒可能落两行**（agent 连续两次调用），
 * 只按 `at` 排会分页漏行或重行。游标编码成 `at:id`，下一页取严格小于。
 */
export const SQL_SELECT_AUDIT_BY_TOKEN = `SELECT id, tool, item_id, rev_before, rev_after, result, operation_id, at
  FROM audit_log WHERE user_id = ? AND token_id = ? AND (at < ? OR (at = ? AND id < ?)) ORDER BY at DESC, id DESC LIMIT ?`;

// —— 可见性（设计 §四；I1 的四个固定条件）——

/**
 * 条目可见性的固定片段（`items` 表别名 `i`）。
 *
 * 四条：**归属 + 非回收站 + 非隐私 + （Memo 看令牌勾选）**。
 * 隐私条件直接引用 `db/privacy.ts` 的那一个字面量，**不重写**——那边有断言测试防漂移。
 */
export function itemVisibilitySql(includeMemos: boolean): string {
  const memo = includeMemos ? "" : " AND i.type <> 'memo'";
  return `i.user_id = ? AND i.deleted_at IS NULL AND ${PRIVACY_EXCLUDE_SQL}${memo}`;
}

/**
 * 文件夹范围片段（架构 §十一 给定的那段：文件夹最多两层，需求 §4.5）。
 *
 * 传两次 `json_each(?)`——第一层选中的文件夹，加上它们的**直接子文件夹**。第三层没有，
 * 所以这个子查询是完整的两层展开，不是"只查一层"的近似。
 */
export const SQL_FOLDER_SCOPE_CLAUSE = ` AND i.folder_id IN (SELECT id FROM folders
  WHERE user_id = ? AND (id IN (SELECT value FROM json_each(?)) OR parent_id IN (SELECT value FROM json_each(?))))`;

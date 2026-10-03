/**
 * 外部备份的 SQL 常量（M7 第 4 项）。
 *
 * 与 `db/mcp-tables.ts` 同款理由：`db/tables.ts` 已近 500 行预算，备份这块单独一份，
 * 两边互不挤。
 *
 * **每个查询都带 `user_id`**：多租户隔离是硬要求（架构 §13.2），不接受"上游已经过滤过"的假设。
 */

export interface BackupTargetRow {
  id: string;
  user_id: string;
  kind: string;
  label: string;
  endpoint: string;
  bucket: string | null;
  region: string | null;
  username: string | null;
  secret_wrapped: ArrayBuffer;
  enabled: number;
  delete_policy: string;
  schedule: string;
  cursor_seq: number;
  last_run_at: number | null;
  last_result: string | null;
  last_error: string | null;
  created_at: number;
}

/**
 * 列目标。
 *
 * **`secret_wrapped` 仍然查出来**——推送时要用它解开凭据。列表接口**不许把它放进响应**，
 * 那一步在服务层做（`toTarget`），不在 SQL 层裁剪：SQL 裁掉列还得维护两套列清单，
 * 迟早有一处忘了裁。
 */
export const SQL_SELECT_BACKUP_TARGETS =
  "SELECT id, user_id, kind, label, endpoint, bucket, region, username, secret_wrapped, enabled, delete_policy, schedule, cursor_seq, last_run_at, last_result, last_error, created_at FROM user_backup_targets WHERE user_id = ? ORDER BY created_at";

export const SQL_SELECT_BACKUP_TARGET =
  "SELECT id, user_id, kind, label, endpoint, bucket, region, username, secret_wrapped, enabled, delete_policy, schedule, cursor_seq, last_run_at, last_result, last_error, created_at FROM user_backup_targets WHERE id = ? AND user_id = ?";

/** 推送时扫的：启用的目标（按创建时间，让同一批目标轮流被推，不偏袒任何一个） */
export const SQL_SELECT_ENABLED_BACKUP_TARGETS =
  "SELECT id, user_id, kind, label, endpoint, bucket, region, username, secret_wrapped, enabled, delete_policy, schedule, cursor_seq, last_run_at, last_result, last_error, created_at FROM user_backup_targets WHERE enabled = 1 ORDER BY created_at";

/** 每日维护里顺带扫（与推送同一批，所以按天） */
export const SQL_SELECT_BACKUP_TARGETS_DUE =
  "SELECT id, user_id, kind, label, endpoint, bucket, region, username, secret_wrapped, enabled, delete_policy, schedule, cursor_seq, last_run_at, last_result, last_error, created_at FROM user_backup_targets WHERE enabled = 1 AND (schedule = 'daily' OR (schedule = 'weekly' AND ? = 1)) ORDER BY created_at";

export const SQL_INSERT_BACKUP_TARGET =
  "INSERT INTO user_backup_targets (id, user_id, kind, label, endpoint, bucket, region, username, secret_wrapped, enabled, delete_policy, schedule, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

/** 改配置。`secret` 缺省时**不更新该列**——两条语句分开，用 `COALESCE` 不行（BLOB 传 null 就成了清空） */
export const SQL_UPDATE_BACKUP_TARGET_CONFIG =
  "UPDATE user_backup_targets SET label = ?, endpoint = ?, bucket = ?, region = ?, username = ?, delete_policy = ?, schedule = ? WHERE id = ? AND user_id = ?";

export const SQL_UPDATE_BACKUP_TARGET_SECRET =
  "UPDATE user_backup_targets SET secret_wrapped = ? WHERE id = ? AND user_id = ?";

export const SQL_UPDATE_BACKUP_TARGET_ENABLED =
  "UPDATE user_backup_targets SET enabled = ? WHERE id = ? AND user_id = ?";

/** 删目标：只清账本，**远端文件不动**（设计 §四 的 DELETE 说明） */
export const SQL_DELETE_BACKUP_TARGET = "DELETE FROM user_backup_targets WHERE id = ? AND user_id = ?";

/** 一轮跑完落账。`result` 三态：全成 / 部分成（配额用尽）／失败 */
export const SQL_UPDATE_BACKUP_TARGET_RUN =
  "UPDATE user_backup_targets SET cursor_seq = ?, last_run_at = ?, last_result = ?, last_error = ? WHERE id = ? AND user_id = ?";

// —— export_queue（变更队列）——

/**
 * 入队。`rev` 每次递增：同一条目被反复改动时只有**最新那一次**留在队里
 * （`ON CONFLICT … DO UPDATE SET rev = excluded.rev`），避免快照阶段把同一篇重做 N 遍。
 */
export const SQL_UPSERT_EXPORT_QUEUE =
  "INSERT INTO export_queue (user_id, key, rev, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET rev = excluded.rev, created_at = excluded.created_at";

/** 按 rev 条件出队：处理完这一项就删掉（架构 §12.1 快照队列的口径） */
export const SQL_DELETE_EXPORT_QUEUE_BY_REV =
  "DELETE FROM export_queue WHERE user_id = ? AND key = ? AND rev = ?";

/** 出队后重置游标 */
export const SQL_UPSERT_EXPORT_CURSOR = "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value";

/** 长期未出队的兜底清理（每日维护）：僵尸 key 留着只会让每轮都白扫一遍 */
export const SQL_PRUNE_EXPORT_QUEUE =
  "DELETE FROM export_queue WHERE created_at + ? * ? <= ?";

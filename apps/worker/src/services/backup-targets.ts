/**
 * 外部备份目标的**管理侧**服务（M7 第 4 项 批 1；设计 §三-§四）。
 *
 * 推送那一侧在批 3（`services/backup-run.ts`），与本文件是两条独立的演进线：
 * 这里管"目标怎么配、凭据怎么存"，那里管"怎么把文件推过去"。
 *
 * ## 凭据的三条纪律
 *
 * 1. **只在创建 / 替换时以一次性明文提交**，包裹后落库；
 * 2. **任何响应都不回显**——`toTarget` 是唯一出口，它把 `secret_wrapped` 换成
 *    `has_secret: boolean`；服务层**不提供**"把凭据取出来给人看"的函数；
 * 3. **测试连接用请求体里的临时凭据**，不落库（设计 §四）。
 *
 * ## 范围校验为什么存在
 *
 * 设计把"推哪些内容"交给快照阶段决定，**目标表本身不存范围**——所以这里也没有范围字段
 * 可校验。`folder_scope` 是 MCP 令牌才有的概念，别串了。
 */
import {
  BACKUP_BATCH_PUT_LIMIT,
  newUlid,
  notePath,
  type BackupDeletePolicy,
  type BackupSchedule,
  type BackupTarget,
  type BackupTargetKind,
  type CreateBackupTargetInput,
  type UpdateBackupTargetInput,
} from "@menote/shared";
import {
  DELETE_KEY_PREFIX,
  SQL_DELETE_BACKUP_TARGET,
  SQL_INSERT_BACKUP_TARGET,
  SQL_SELECT_BACKUP_TARGET,
  SQL_SELECT_BACKUP_TARGETS,
  SQL_UPDATE_BACKUP_TARGET_CONFIG,
  SQL_UPDATE_BACKUP_TARGET_ENABLED,
  SQL_UPDATE_BACKUP_TARGET_SECRET,
  type BackupTargetRow,
} from "../db/backup-tables";
import { DomainError } from "../errors";
import type { EnvBindings } from "../types";
import { openWithBackupKey, sealWithBackupKey } from "./crypto";

/** TextEncoder 在部分 TS lib 下返回 `ArrayBufferLike`，而 WebCrypto 要 `ArrayBuffer`——显式转一次 */
function toBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
}

/** 库里的行 → 响应。**唯一出口，凭据永远出不去** */
function toTarget(row: BackupTargetRow): BackupTarget {
  return {
    id: row.id,
    kind: row.kind as BackupTargetKind,
    label: row.label,
    endpoint: row.endpoint,
    bucket: row.bucket,
    region: row.region,
    username: row.username,
    has_secret: row.secret_wrapped !== null,
    enabled: row.enabled === 1,
    delete_policy: row.delete_policy as BackupDeletePolicy,
    schedule: row.schedule as BackupSchedule,
    cursor_seq: row.cursor_seq,
    last_run_at: row.last_run_at,
    last_result: row.last_result as BackupTarget["last_result"],
    last_error: row.last_error,
    created_at: row.created_at,
  };
}

async function loadRow(db: D1Database, userId: string, id: string): Promise<BackupTargetRow> {
  const row = await db
    .prepare(SQL_SELECT_BACKUP_TARGET)
    .bind(id, userId)
    .first<BackupTargetRow>();
  if (!row) throw new DomainError("not_found", "备份目标不存在");
  return row;
}

/** S3 必须给 bucket；WebDAV 的 bucket / region 恒 null（留着是为了两边共用一条 UPDATE） */
function normalizeS3Fields(
  kind: BackupTargetKind,
  bucket: string | null | undefined,
  region: string | null | undefined,
): { bucket: string | null; region: string | null } {
  if (kind !== "s3") return { bucket: null, region: null };
  const name = (bucket ?? "").trim();
  if (name === "") throw new DomainError("invalid", "S3 目标必须填桶名");
  return { bucket: name, region: (region ?? "").trim() || null };
}

export async function listBackupTargets(db: D1Database, userId: string): Promise<BackupTarget[]> {
  const rows = await db
    .prepare(SQL_SELECT_BACKUP_TARGETS)
    .bind(userId)
    .all<BackupTargetRow>();
  return (rows.results ?? []).map(toTarget);
}

export async function createBackupTarget(
  env: EnvBindings,
  userId: string,
  input: CreateBackupTargetInput,
  now: number,
): Promise<BackupTarget> {
  const { bucket, region } = normalizeS3Fields(input.kind, input.bucket, input.region);
  const id = newUlid();
  // 凭据用备份包裹键加密后**只存密文**；明文在这一行之后就没人拿得到了
  const wrapped = await sealWithBackupKey(env, toBytes(input.secret));

  await env.DB
    .prepare(SQL_INSERT_BACKUP_TARGET)
    .bind(
      id,
      userId,
      input.kind,
      input.label,
      input.endpoint.replace(/\/+$/, ""),
      bucket,
      region,
      (input.username ?? "").trim() || null,
      new Uint8Array(Buffer.from(wrapped, "base64url")),
      input.enabled === false ? 0 : 1,
      input.delete_policy ?? "append_only",
      input.schedule ?? "daily",
      now,
    )
    .run();

  return toTarget(await loadRow(env.DB, userId, id));
}

export async function updateBackupTarget(
  env: EnvBindings,
  userId: string,
  id: string,
  input: UpdateBackupTargetInput,
): Promise<BackupTarget> {
  const current = await loadRow(env.DB, userId, id);
  const kind = current.kind as BackupTargetKind;
  const { bucket, region } = normalizeS3Fields(kind, input.bucket, input.region);

  await env.DB.prepare(SQL_UPDATE_BACKUP_TARGET_CONFIG)
    .bind(
      input.label ?? current.label,
      input.endpoint?.replace(/\/+$/, "") ?? current.endpoint,
      kind === "s3" ? (bucket ?? current.bucket) : null,
      kind === "s3" ? (region ?? current.region) : null,
      input.username === undefined ? current.username : (input.username ?? '').trim() || null,
      input.delete_policy ?? (current.delete_policy as BackupDeletePolicy),
      input.schedule ?? (current.schedule as BackupSchedule),
      id,
      userId,
    )
    .run();

  // 凭据单独一条：`secret` 缺省时**不动这一列**（COALESCE 不行——BLOB 传 null 就成了"清空"）
  if (input.secret !== undefined && input.secret !== "") {
    const wrapped = await sealWithBackupKey(env, toBytes(input.secret));
    await env.DB.prepare(SQL_UPDATE_BACKUP_TARGET_SECRET)
      .bind(new Uint8Array(Buffer.from(wrapped, "base64url")), id, userId)
      .run();
  }

  return toTarget(await loadRow(env.DB, userId, id));
}

export async function setBackupTargetEnabled(
  db: D1Database,
  userId: string,
  id: string,
  enabled: boolean,
): Promise<BackupTarget> {
  await loadRow(db, userId, id);
  await db.prepare(SQL_UPDATE_BACKUP_TARGET_ENABLED).bind(enabled ? 1 : 0, id, userId).run();
  return toTarget(await loadRow(db, userId, id));
}

/** 删目标：**只清账本，远端文件一个都不动**（设计 §四 的 DELETE 说明） */
export async function deleteBackupTarget(db: D1Database, userId: string, id: string): Promise<void> {
  const result = await db.prepare(SQL_DELETE_BACKUP_TARGET).bind(id, userId).run();
  if ((result.meta.changes ?? 0) === 0) throw new DomainError("not_found", "备份目标不存在");
}

/**
 * 取出目标的**已存凭据明文**（只有推送与"用库里那份凭据测连接"两条路会调它）。
 *
 * ⚠️ 拿到之后**立刻用掉、不要拼进任何字符串**：调用方把它交给适配器，
 * 错误消息里也绝不能出现（适配器负责把错误翻译成不含凭据的中文）。
 */
export async function readTargetSecret(
  env: EnvBindings,
  row: BackupTargetRow,
): Promise<string> {
  const bytes = await openWithBackupKey(env, Buffer.from(row.secret_wrapped).toString("base64url"));
  return new TextDecoder().decode(bytes);
}

/**
 * 查一批 id 里**真实存在**的那些，算出它们在快照里对应的路径（带 `del:` 前缀）。
 *
 * **软删不算**：软删是内容变了，快照重推一次就同步过去了。**永久删除**才是路径彻底消失——
 * 快照里不会有任何痕迹说它曾经存在过，所以远端删除的唯一信息源就是这里算出的这几个 key。
 *
 * 只算存在的那几条（`ids` 是客户端报上来的，里面可能有根本不存在的或别人的 id），
 * 且**路径由 shared 的 `notePath` 产出**——不在 SQL 里手拼 `'snapshot/notes/' || id`
 * （手拼过一次就出过清单与实际条目对不上的错）。
 *
 * 分两步（先查后写）是因为写入要排在删除**之后**、留在同一个 D1 batch 里。
 */
export async function lookupRemoteDeletionKeys(
  db: D1Database,
  userId: string,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const slots = ids.map(() => "?").join(", ");
  const existing = await db
    .prepare(
      `SELECT id FROM items WHERE user_id = ? AND id IN (${slots})
       UNION ALL
       SELECT id FROM folders WHERE user_id = ? AND id IN (${slots})`,
    )
    .bind(userId, ...ids, userId, ...ids)
    .all<{ id: string }>();
  return (existing.results ?? []).map((row) => `${DELETE_KEY_PREFIX}${notePath(row.id)}`);
}

/** 把上一步算出的 key 写成一条 batch 语句；**没有要记的就返回 null**（调用方不必判空） */
export function prepareRemoteDeletionEnqueue(
  db: D1Database,
  userId: string,
  keys: readonly string[],
  now: number,
): D1PreparedStatement | null {
  if (keys.length === 0) return null;
  // 每行三个占位符（`user_id` / `key` / `created_at`）；`rev` 是字面量 1，不占位
  return db
    .prepare(
      `INSERT INTO export_queue (user_id, key, rev, created_at) VALUES ${keys
        .map(() => "(?, ?, 1, ?)")
        .join(", ")}
       ON CONFLICT(user_id, key) DO UPDATE SET rev = excluded.rev, created_at = excluded.created_at`,
    )
    .bind(...keys.flatMap((key) => [userId, key, now]));
}

export { toTarget as toBackupTargetResponse, loadRow as loadBackupTargetRow };

/** 一轮能推多少个外部 PUT（架构 §14.3：免费版外部子请求 50 个 / invocation，留 10 个余量） */
export const BACKUP_PUT_BUDGET = BACKUP_BATCH_PUT_LIMIT;

/**
 * 每日维护（M4-8；《M4 设计》§7「每日维护五步」）。
 *
 * 五步固定顺序（先删到期、再瘦身、后清理），**一步一轮**：Cron 每 15 分钟跑一次，
 * 用 `job:maintenance:day`（今天是否已走完一圈）与 `job:maintenance:step`（圈内走到第几步）两个游标，
 * 一天之内把五步走完，之后当天不再重复。
 *
 * **不加锁**（设计 §7 的结论）：多 isolate 可能同时跑同一轮，靠"配额 + 游标 + 幂等"容忍重复——
 * 永久删除按条件删、稀疏化按条件删、墓碑按 floor 推进，重复执行都不会更糟。
 */
import {
  ATTACHMENT_ORPHAN_RETENTION_DAYS,
  DAY_MS,
  PERMANENT_DELETE_BATCH,
  TOMBSTONE_RETENTION_DAYS,
  TRASH_RETENTION_DAYS_DEFAULT,
} from "@menote/shared";
import { SQL_DELETE_OLD_TOMBSTONES, SQL_SELECT_MIN_TOMBSTONE_SEQ, SQL_UPSERT_APP_META } from "../db/tables";
import { permanentDeleteItems } from "../services/trash";

export const KEY_MAINTENANCE_DAY = "job:maintenance:day";
export const KEY_MAINTENANCE_STEP = "job:maintenance:step";

/** 五步的编号与名字（顺序是语义的一部分，别重排） */
export const MAINTENANCE_STEPS = [
  "trash_expiry",
  "version_sweep",
  "attachment_orphans",
  "ref_integrity",
  "cleanup",
] as const;
export type MaintenanceStep = (typeof MAINTENANCE_STEPS)[number];

export interface MaintenanceResult {
  /** 本次实际执行的步骤；当天已走完一圈则为 null */
  step: MaintenanceStep | null;
  /** 该步骤的明细（数字与说明，便于日志与用例断言） */
  detail: Record<string, number | string>;
  /** 是否因为"今天已经走完一圈"而跳过 */
  skipped: boolean;
}

/** UTC 日期串（`2026-09-27`）：以 UTC 分日，避免不同时区的部署各自为政 */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

async function readMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM app_meta WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function writeMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(SQL_UPSERT_APP_META).bind(key, value).run();
}

/** 表是否存在：擦到"M6 才有的表"时不要整轮失败（审计 / MCP 幂等表还没建） */
async function tableExists(db: D1Database, name: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?")
    .bind(name)
    .first<{ x: number }>();
  return row !== null;
}

/**
 * 推进一步。返回本次执行了什么，便于 Cron 日志与用例断言。
 *
 * `now` 由调用方传入（测试要固定时间）。
 */
export async function runMaintenanceStep(
  db: D1Database,
  now: number,
  quota = PERMANENT_DELETE_BATCH,
): Promise<MaintenanceResult> {
  const today = utcDay(now);
  const lastDay = await readMeta(db, KEY_MAINTENANCE_DAY);
  if (lastDay === today) {
    return { step: null, detail: { reason: "今天已走完一圈" }, skipped: true };
  }

  const rawStep = Number.parseInt((await readMeta(db, KEY_MAINTENANCE_STEP)) ?? "0", 10);
  const index = Number.isFinite(rawStep) && rawStep >= 0 && rawStep < MAINTENANCE_STEPS.length ? rawStep : 0;
  const step = MAINTENANCE_STEPS[index] ?? MAINTENANCE_STEPS[0];

  const detail = await executeStep(db, step, now, quota);

  // 走到头就把"今天走完了"记下来，并把圈内游标归零；否则推进一格
  const nextIndex = index + 1;
  if (nextIndex >= MAINTENANCE_STEPS.length) {
    await db.batch([
      db.prepare(SQL_UPSERT_APP_META).bind(KEY_MAINTENANCE_DAY, today),
      db.prepare(SQL_UPSERT_APP_META).bind(KEY_MAINTENANCE_STEP, "0"),
    ]);
  } else {
    await writeMeta(db, KEY_MAINTENANCE_STEP, String(nextIndex));
  }

  return { step, detail, skipped: false };
}

async function executeStep(
  db: D1Database,
  step: MaintenanceStep,
  now: number,
  quota: number,
): Promise<Record<string, number | string>> {
  switch (step) {
    case "trash_expiry":
      return expireTrash(db, now, quota);
    case "version_sweep":
      // 版本稀疏化需要版本服务与 R2 正文（M4-5）；未落地前明确跳过，而不是假装做过
      return { skipped: "版本稀疏化待 M4-5（需要 R2）" };
    case "attachment_orphans":
      return handleAttachmentOrphans(db, now);
    case "ref_integrity":
      return checkRefIntegrity(db);
    case "cleanup":
      return cleanup(db, now);
    default:
      return {};
  }
}

/**
 * ① 回收站到期永久删除（保留期默认 30 天，来自用户设置）。
 *
 * 复用 M4-6 的服务（同一批语句与墓碑语义），每轮最多 `quota` 条。
 */
async function expireTrash(
  db: D1Database,
  now: number,
  quota: number,
): Promise<Record<string, number | string>> {
  // 保留期用**默认 30 天**：按用户覆盖的设置在 M4-11（设置页「版本与回收站」）落地，
  // 那时改成 JOIN user_settings 读；现在写死常量，与 `TRASH_RETENTION_DAYS_DEFAULT` 同一处来源
  const byUser = await db
    .prepare(
      `SELECT i.id AS id, i.user_id AS user_id FROM items i
       WHERE i.deleted_at IS NOT NULL AND i.deleted_at + (? * ?) <= ?
       ORDER BY i.deleted_at ASC
       LIMIT ?`,
    )
    .bind(TRASH_RETENTION_DAYS_DEFAULT, DAY_MS, now, quota)
    .all<{ id: string; user_id: string }>();
  if (byUser.results.length === 0) return { deleted: 0 };

  // 逐用户分组：永久删除要求 user_id（也保证不会跨用户）
  const groups = new Map<string, string[]>();
  for (const row of byUser.results) {
    const list = groups.get(row.user_id) ?? [];
    list.push(row.id);
    groups.set(row.user_id, list);
  }

  let deleted = 0;
  for (const [userId, ids] of groups) {
    const result = await permanentDeleteItems(db, userId, ids, now);
    deleted += result.deleted;
  }
  return { deleted };
}

/**
 * ③ 附件孤儿：两条动作合一步。
 *
 * - **标孤儿**：没有任何引用的附件置 `orphaned_at`（注意"回收站里的条目"仍算引用，
 *   所以只按 `attachment_refs` 判定）；
 * - **到期删除**：`orphaned_at` 超过 30 天的附件，`r2_key` 登记 GC（reason=`orphan`）后删行。
 */
async function handleAttachmentOrphans(db: D1Database, now: number): Promise<Record<string, number | string>> {
  const marked = await db
    .prepare(
      `UPDATE attachments SET orphaned_at = ?, updated_at = ?
       WHERE orphaned_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM attachment_refs r WHERE r.attachment_id = attachments.id)`,
    )
    .bind(now, now)
    .run();

  const dueAt = now + ATTACHMENT_ORPHAN_RETENTION_DAYS * DAY_MS;
  await db
    .prepare(
      `INSERT OR IGNORE INTO r2_gc_queue (r2_key, user_id, reason, due_at, created_at)
       SELECT r2_key, user_id, 'orphan', ?, ? FROM attachments
       WHERE orphaned_at IS NOT NULL AND orphaned_at + (? * ?) <= ?`,
    )
    .bind(dueAt, now, ATTACHMENT_ORPHAN_RETENTION_DAYS, DAY_MS, now)
    .run();

  const removed = await db
    .prepare(
      `DELETE FROM attachments
       WHERE orphaned_at IS NOT NULL AND orphaned_at + (? * ?) <= ?`,
    )
    .bind(ATTACHMENT_ORPHAN_RETENTION_DAYS, DAY_MS, now)
    .run();

  return { marked: marked.meta.changes ?? 0, removed: removed.meta.changes ?? 0 };
}

/** ④ 引用一致性：删掉指向"已不存在的附件或条目"的引用行 */
async function checkRefIntegrity(db: D1Database): Promise<Record<string, number | string>> {
  const orphanRefs = await db
    .prepare(
      `DELETE FROM attachment_refs
       WHERE attachment_id NOT IN (SELECT id FROM attachments)
          OR item_id NOT IN (SELECT id FROM items)`,
    )
    .run();
  return { removed_refs: orphanRefs.meta.changes ?? 0 };
}

/**
 * ⑤ 清理：过期会话 / `auth_throttle` / 墓碑（180 天 + 推进 `tombstone_floor`）。
 *
 * 审计日志（90 天）与 MCP 幂等表（7 天）属 M6，表还不存在——用 `tableExists` 判断后再清，
 * 免得"6 个月后才有的表"让今天的维护整轮失败。
 */
async function cleanup(db: D1Database, now: number): Promise<Record<string, number | string>> {
  const sessions = await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
  // auth_throttle 没有 updated_at：窗口起点 + 7 天，且锁已过期（还在锁定期的不清）
  const throttle = await db
    .prepare(
      `DELETE FROM auth_throttle
       WHERE window_start + ? * ? <= ? AND (locked_until IS NULL OR locked_until <= ?)`,
    )
    .bind(7, DAY_MS, now, now)
    .run();

  const detail: Record<string, number | string> = {
    sessions: sessions.meta.changes ?? 0,
    throttle: throttle.meta.changes ?? 0,
  };

  const cutoff = now - TOMBSTONE_RETENTION_DAYS * DAY_MS;
  const users = await db
    .prepare("SELECT DISTINCT user_id FROM tombstones WHERE deleted_at < ?")
    .bind(cutoff)
    .all<{ user_id: string }>();

  let tombstones = 0;
  for (const row of users.results) {
    const deleted = await db
      .prepare(SQL_DELETE_OLD_TOMBSTONES)
      .bind(row.user_id, cutoff)
      .run();
    tombstones += deleted.meta.changes ?? 0;

    // floor 推进到"剩余墓碑里最小的序号"；一条不剩就推到当前 sync_seq（客户端下次从 0 重建即可）
    const min = await db
      .prepare(SQL_SELECT_MIN_TOMBSTONE_SEQ)
      .bind(row.user_id)
      .first<{ seq: number | null }>();
    await db
      .prepare(
        `UPDATE users SET tombstone_floor = ? WHERE id = ? AND tombstone_floor < ?`,
      )
      .bind(min?.seq ?? 0, row.user_id, min?.seq ?? 0)
      .run();
  }
  detail.tombstones = tombstones;

  if (await tableExists(db, "audit_log")) {
    const audit = await db
      .prepare("DELETE FROM audit_log WHERE created_at + ? * ? <= ?")
      .bind(90, DAY_MS, now)
      .run();
    detail.audit = audit.meta.changes ?? 0;
  }
  if (await tableExists(db, "mcp_idempotency")) {
    const mcp = await db
      .prepare("DELETE FROM mcp_idempotency WHERE created_at + ? * ? <= ?")
      .bind(7, DAY_MS, now)
      .run();
    detail.mcp = mcp.meta.changes ?? 0;
  }

  return detail;
}

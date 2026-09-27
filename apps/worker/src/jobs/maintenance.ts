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
  DAY_MS,
  DEFAULT_VERSION_TRASH_SETTINGS,
  PERMANENT_DELETE_BATCH,
  TOMBSTONE_RETENTION_DAYS,
  TRASH_RETENTION_DAYS_DEFAULT,
  type VersionTrashSettings,
} from "@menote/shared";
import { SQL_DELETE_OLD_TOMBSTONES, SQL_SELECT_MIN_TOMBSTONE_SEQ, SQL_UPSERT_APP_META } from "../db/tables";
import { permanentDeleteItems } from "../services/trash";
import { sweepOrphanedAttachments } from "../services/attachments";
import { sweepVersions } from "../services/version-retention";
import type { StorageEnv } from "../types";

export const KEY_MAINTENANCE_DAY = "job:maintenance:day";
export const KEY_MAINTENANCE_STEP = "job:maintenance:step";
/** 版本稀疏化的条目游标（设计 §7 的四个游标键之一） */
export const KEY_SWEEP_CURSOR = "job:sweep:item";

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
  env: StorageEnv,
  now: number,
  quota = PERMANENT_DELETE_BATCH,
): Promise<MaintenanceResult> {
  const db = env.DB;
  const today = utcDay(now);
  const lastDay = await readMeta(db, KEY_MAINTENANCE_DAY);
  if (lastDay === today) {
    return { step: null, detail: { reason: "今天已走完一圈" }, skipped: true };
  }

  const rawStep = Number.parseInt((await readMeta(db, KEY_MAINTENANCE_STEP)) ?? "0", 10);
  const index = Number.isFinite(rawStep) && rawStep >= 0 && rawStep < MAINTENANCE_STEPS.length ? rawStep : 0;
  const step = MAINTENANCE_STEPS[index] ?? MAINTENANCE_STEPS[0];

  const detail = await executeStep(env, step, now, quota);

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
  env: StorageEnv,
  step: MaintenanceStep,
  now: number,
  quota: number,
): Promise<Record<string, number | string>> {
  const db = env.DB;
  switch (step) {
    case "trash_expiry":
      return expireTrash(db, now, quota);
    case "version_sweep":
      // 版本稀疏化（M4-5）：按游标扫有版本的条目，逐条按**该用户的保留设置**裁剪
      return sweepVersionsStep(env, now, quota);
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
 * ② 版本稀疏化（M4-5）：按 `job:sweep:item` 游标扫有版本的条目，逐条裁剪。
 *
 * 每轮的 `quota` 是**条目数**（不是版本数）——一条条目里删几个版本是它自己按保留设置决定的。
 */
async function sweepVersionsStep(
  env: StorageEnv,
  now: number,
  quota: number,
): Promise<Record<string, number | string>> {
  const db = env.DB;
  const cursor = parseSweepCursor(await readMeta(db, KEY_SWEEP_CURSOR));

  const result = await sweepVersions(
    env,
    now,
    (userId) => versionTrashSettingsOf(db, userId),
    cursor,
    quota,
  );
  await writeMeta(db, KEY_SWEEP_CURSOR, `${result.next.createdAt}:${result.next.id}`);
  // 扫完一轮（本批不足配额）就把游标归零，下一轮从头再扫
  if (result.scanned < quota) await writeMeta(db, KEY_SWEEP_CURSOR, "");

  return { scanned: result.scanned, removed: result.removed };
}

function parseSweepCursor(raw: string | null): { createdAt: number; id: string } {
  if (!raw) return { createdAt: 0, id: "" };
  const [createdAt, id] = raw.split(":");
  const parsed = Number.parseInt(createdAt ?? "0", 10);
  return { createdAt: Number.isFinite(parsed) ? parsed : 0, id: id ?? "" };
}

/** 取某用户的版本保留设置（没写过设置就用默认值） */
async function versionTrashSettingsOf(db: D1Database, userId: string): Promise<VersionTrashSettings> {
  const row = await db
    .prepare("SELECT json FROM user_settings WHERE user_id = ?")
    .bind(userId)
    .first<{ json: string }>();
  if (!row?.json) return DEFAULT_VERSION_TRASH_SETTINGS;
  try {
    const parsed = JSON.parse(row.json) as { version_trash?: VersionTrashSettings };
    return { ...DEFAULT_VERSION_TRASH_SETTINGS, ...parsed.version_trash };
  } catch {
    return DEFAULT_VERSION_TRASH_SETTINGS;
  }
}

/**
 * ① 回收站到期永久删除（M4-6 的服务 + 每用户保留期）。
 *
 * 保留期**按用户设置**（`user_settings.version_trash.trash_retention_days`，默认 30 天）——
 * 设置页能改它，维护就必须读它，否则那个设置是假的。读不到（没写过设置/字段缺失）时用默认值。
 */
async function expireTrash(
  db: D1Database,
  now: number,
  quota: number,
): Promise<Record<string, number | string>> {
  const rows = await db
    .prepare(
      `SELECT i.id AS id, i.user_id AS user_id, i.deleted_at AS deleted_at, s.json AS settings_json
       FROM items i LEFT JOIN user_settings s ON s.user_id = i.user_id
       WHERE i.deleted_at IS NOT NULL
       ORDER BY i.deleted_at ASC
       LIMIT ?`,
    )
    .bind(quota)
    .all<{ id: string; user_id: string; deleted_at: number; settings_json: string | null }>();

  const groups = new Map<string, string[]>();
  for (const row of rows.results) {
    const retention = retentionDaysOf(row.settings_json);
    if (row.deleted_at + retention * DAY_MS > now) continue; // 还没到期
    const list = groups.get(row.user_id) ?? [];
    list.push(row.id);
    groups.set(row.user_id, list);
  }
  if (groups.size === 0) return { deleted: 0 };

  let deleted = 0;
  for (const [userId, ids] of groups) {
    const result = await permanentDeleteItems(db, userId, ids, now);
    deleted += result.deleted;
  }
  return { deleted };
}

/** 从设置 JSON 里取回收站保留天数；解析不了就用默认值（维护任务不能因为一行脏数据停摆） */
function retentionDaysOf(json: string | null): number {
  if (!json) return TRASH_RETENTION_DAYS_DEFAULT;
  try {
    const parsed = JSON.parse(json) as { version_trash?: { trash_retention_days?: number } };
    const value = parsed.version_trash?.trash_retention_days;
    return typeof value === "number" && value >= 1 ? value : TRASH_RETENTION_DAYS_DEFAULT;
  } catch {
    return TRASH_RETENTION_DAYS_DEFAULT;
  }
}

/**
 * ③ 附件孤儿：两条动作合一步。
 *
 * - **标孤儿**：没有任何引用的附件置 `orphaned_at`（注意"回收站里的条目"仍算引用，
 *   所以只按 `attachment_refs` 判定）；
 * - **到期删除**：`orphaned_at` 超过 30 天的附件，`r2_key` 登记 GC（reason=`orphan`）后删行。
 *
 * **【2026-09-27 修】这一段原本是内联 SQL，与服务层的 `sweepOrphanedAttachments` 是两份实现，
 * 而且两边的 GC 登记时间不一致**：这里曾把 `due_at` 写成 `now + 30 天`（像是把"标孤儿"的
 * 等待期又抄了一遍），结果**对象在行删掉之后还要在 R2 里多躺 30 天**；服务层与手动 GC
 * （`POST /api/attachments/gc`）用的都是 `due_at = now`。现在统一走服务层那一份——
 * 一处实现、一处口径，也顺手消掉 30 天的存储泄漏。
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

  const removed = await sweepOrphanedAttachments(db, now);

  return { marked: marked.meta.changes ?? 0, removed };
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

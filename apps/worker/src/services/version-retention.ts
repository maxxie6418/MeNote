/**
 * 版本的保留与稀疏化（M4-5；《M4 设计》§4.3）。
 *
 * 从 `versions.ts` 分出来：那个文件是"封存 / 列表 / 正文 / 恢复"的闭环，而保留策略是**另一摊规则**
 * （密度分档 + 条数上限 + 最长保留时长），两者的改动理由完全不同，混在一起两个都说不清。
 *
 * 一条底线：**删版本必须连 R2 对象一起登记 GC**——D1 行没了而对象还在就是永久泄漏。
 */
import { DAY_MS, VERSIONS_DEFAULT, type VersionTrashSettings } from "@menote/shared";
import {
  SQL_COUNT_VERSIONS,
  SQL_DELETE_VERSION,
  SQL_INSERT_R2_GC,
  SQL_SELECT_OLDEST_REMOVABLE,
  SQL_SELECT_SWEEP_CANDIDATES,
} from "../db/tables";
import type { StorageEnv } from "../types";

/** 时间分档的边界（设计 §4.3）：24h 全留 / 1–7 天每 6 小时 / 7–30 天每天 / 30 天–1 年每周 / 1 年以上每月 */
const TIERS: ReadonlyArray<{ until: number; bucketMs: number }> = [
  { until: 1 * DAY_MS, bucketMs: 0 },
  { until: 7 * DAY_MS, bucketMs: 6 * 60 * 60 * 1000 },
  { until: 30 * DAY_MS, bucketMs: DAY_MS },
  { until: 365 * DAY_MS, bucketMs: 7 * DAY_MS },
  { until: Number.POSITIVE_INFINITY, bucketMs: 30 * DAY_MS },
];

/**
 * 按年龄分档挑出该删的版本（纯函数，便于单测）。
 *
 * 规则：同一档内**每条时间桶只留最新的一条**；`keep = 1` 与手动版本**永不入选**。
 * 返回"要删的 id"。
 */
export function chooseSparseVictims(
  versions: ReadonlyArray<{ id: string; created_at: number; keep: number; reason: string }>,
  now: number,
): string[] {
  const victims: string[] = [];
  // 新的在前，便于"同一桶保留最新"
  const sorted = [...versions].sort((a, b) => b.created_at - a.created_at);
  const seenBucket = new Set<string>();

  for (const version of sorted) {
    if (version.keep === 1 || version.reason === "manual") continue;
    const age = now - version.created_at;
    const tier = TIERS.find((candidate) => age < candidate.until) ?? TIERS[TIERS.length - 1];
    if (!tier || tier.bucketMs === 0) continue; // 24 小时内：全留

    const bucketKey = String(version.created_at - (version.created_at % tier.bucketMs));
    if (seenBucket.has(bucketKey)) victims.push(version.id);
    else seenBucket.add(bucketKey);
  }

  return victims;
}

export interface SparsifyResult {
  removed: number;
  reason: "count" | "age" | "mixed" | "none";
}

/**
 * 就地稀疏化该条目（新增版本后调用；每日维护也会按游标扫一遍）。
 *
 * 两种裁剪：**年龄**（密度分档 + 可选的"最长保留时长"硬线）与**条数**（超过 `versions_keep`
 * 时删最旧的非 keep）。
 */
export async function sparsifyItem(
  env: StorageEnv,
  userId: string,
  itemId: string,
  settings: VersionTrashSettings,
  now: number,
): Promise<SparsifyResult> {
  const candidates = await env.DB.prepare(SQL_SELECT_SWEEP_CANDIDATES)
    .bind(userId, itemId)
    .all<{ id: string; r2_key: string; created_at: number; reason: string }>();

  const rows = candidates.results.map((row) => ({
    id: row.id,
    r2_key: row.r2_key,
    created_at: row.created_at,
    keep: 0,
    reason: row.reason,
  }));
  if (rows.length === 0) return { removed: 0, reason: "none" };

  const doomed = new Set<string>();

  // ① 年龄分档（与最长保留时长无关：密度是**定稿规则**，默认一直生效）
  for (const id of chooseSparseVictims(rows, now)) doomed.add(id);

  // ② 最长保留时长（用户设置，0 = 不限）
  const ageLimitApplied = settings.versions_max_age_days > 0;
  if (ageLimitApplied) {
    const cutoff = now - settings.versions_max_age_days * DAY_MS;
    for (const row of rows) if (row.created_at < cutoff) doomed.add(row.id);
  }

  // ③ 条数上限：把"按年龄该删的"先扣掉，再看还超多少
  const total = await env.DB.prepare(SQL_COUNT_VERSIONS).bind(userId, itemId).first<{ n: number }>();
  const overCount = Math.max(0, (total?.n ?? 0) - doomed.size - settings.versions_keep);
  let countApplied = false;
  if (overCount > 0) {
    const removable = await env.DB.prepare(SQL_SELECT_OLDEST_REMOVABLE)
      .bind(userId, itemId, overCount + doomed.size)
      .all<{ id: string }>();
    let taken = 0;
    for (const row of removable.results) {
      if (doomed.has(row.id)) continue;
      if (taken >= overCount) break;
      doomed.add(row.id);
      taken += 1;
    }
    countApplied = taken > 0;
  }

  if (doomed.size === 0) return { removed: 0, reason: "none" };

  let removed = 0;
  for (const row of rows) {
    if (!doomed.has(row.id)) continue;
    await env.DB.batch([
      env.DB.prepare(SQL_INSERT_R2_GC).bind(row.r2_key, userId, "replace", now, now),
      env.DB.prepare(SQL_DELETE_VERSION).bind(row.id, userId),
    ]);
    removed += 1;
  }

  const reason: SparsifyResult["reason"] =
    ageLimitApplied && countApplied ? "mixed" : countApplied ? "count" : "age";
  return { removed, reason };
}

/**
 * 每日维护：按游标扫一遍有版本的条目（分批，避免一次拉全表）。
 *
 * 逐条按**该用户的**保留设置裁剪——设置页能改它，维护就必须读它。
 */
export async function sweepVersions(
  env: StorageEnv,
  now: number,
  settingsOf: (userId: string) => Promise<VersionTrashSettings>,
  cursor: { createdAt: number; id: string },
  limit: number,
): Promise<{ scanned: number; removed: number; next: { createdAt: number; id: string } }> {
  const rows = await env.DB.prepare(
    `SELECT v.item_id AS item_id, v.user_id AS user_id, MAX(v.created_at) AS created_at
     FROM item_versions v
     WHERE (v.item_id, v.created_at) > (?, ?)
     GROUP BY v.item_id, v.user_id
     ORDER BY created_at ASC, item_id ASC LIMIT ?`,
  )
    .bind(cursor.id, cursor.createdAt, limit)
    .all<{ item_id: string; user_id: string; created_at: number }>();

  let removed = 0;
  for (const row of rows.results) {
    const settings = await settingsOf(row.user_id);
    const result = await sparsifyItem(env, row.user_id, row.item_id, settings, now);
    removed += result.removed;
  }

  const last = rows.results[rows.results.length - 1];
  return {
    scanned: rows.results.length,
    removed,
    next: last ? { createdAt: last.created_at, id: last.item_id } : cursor,
  };
}

/** 默认保留条数（设置缺失时的兜底，与 `DEFAULT_VERSION_TRASH_SETTINGS` 同源） */
export const DEFAULT_VERSIONS_KEEP = VERSIONS_DEFAULT;

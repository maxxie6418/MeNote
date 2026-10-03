/**
 * Cron 任务编排（M4-8；《M4 设计》§7「Cron 分派与维护细则」）。
 *
 * **不加锁**（设计 §7 的明确结论）：多 isolate 可能并发跑同一轮，靠"配额 + 游标 + 幂等"容忍重复——
 *   - R2 GC 删不存在的对象不算错；
 *   - 永久删除按条件删（第二次找不到行就没得删）；
 *   - 维护按"天 + 圈内步"两个游标推进。
 * 代价是偶发的重复劳动，收益是不必实现租约与续租（架构 §12.2 没定义租约）。
 *
 * 每轮的顺序与配额（架构 §12.1）：① 注册开关到期 ② **R2 GC 20 个** ③ 快照队列 10 个【接口位】
 * ④ **idle 封存兜底 3 条** ⑤ 外部备份【接口位】 ⑥ 每日维护推进一步。
 * ③④⑤ 依赖 M5/M6 的服务与 R2；没有时**明确跳过**并把原因记进返回值，而不是假装跑过。
 */
import { JOB_IDLE_SEAL_BATCH, JOB_R2_GC_BATCH, JOB_SWEEP_BATCH } from "@menote/shared";
import { SQL_UPSERT_APP_META } from "../db/tables";
import { SQL_SELECT_ENABLED_BACKUP_TARGETS, type BackupTargetRow } from "../db/backup-tables";
import { getRegistrationState, setRegistrationState } from "../services/settings";
import { runMaintenanceStep, type MaintenanceResult } from "../jobs/maintenance";
import { pushOneRound } from "../jobs/push";
import { materializeSnapshot, type SnapshotOutcome } from "../jobs/snapshot";
import { sealIdleVersions } from "./versions";

export const KEY_GC_CURSOR = "job:gc:cursor";

/** ③ 槽每轮最多给几个用户物化（家里 3–5 人时够用；防的是"多账号把一轮撑爆"） */
const SNAPSHOT_USER_LIMIT = 5;

/** ⑤ 槽每轮最多推几个目标（同上：子请求是每次 invocation 的限额） */
const PUSH_TARGET_LIMIT = 5;

export interface ScheduledSummary {
  /** ① 注册开关：本来开着但已过期 → 写回关闭 */
  registrationClosed: boolean;
  /** ② R2 GC：本轮删掉的对象数与队列剩余 */
  gcDeleted: number;
  /** ③ 快照物化（M7 第 4 项 批 2 落地，不再是接口位） */
  snapshot: SnapshotOutcome | { skipped: string };
  /** ④ idle 封存兜底【接口位】*/
  idleSeal: { skipped: string } | { sealed: number };
  /** ⑤ 外部备份推送（M7 第 4 项 批 3） */
  backup: { skipped: string } | { targets: number; pushed: number; failed: number };
  /** ⑥ 每日维护 */
  maintenance: MaintenanceResult;
}

export interface ScheduledEnv {
  DB: D1Database;
  /** 附件与版本对象桶（`wrangler.jsonc` 绑为 `ATTACHMENTS`）；缺绑定时 R2 GC 只跳过、不删队列行 */
  ATTACHMENTS?: R2Bucket;
}

/**
 * 跑一轮 Cron。
 *
 * 单个任务失败**不拖垮整轮**：每个任务各自 try/catch，失败只记进 summary（
 * 否则一个坏掉的 R2 键会让每日维护永远轮不到）。
 */
export async function runScheduled(env: ScheduledEnv, now: number = Date.now()): Promise<ScheduledSummary> {
  const summary: ScheduledSummary = {
    registrationClosed: false,
    gcDeleted: 0,
    snapshot: { skipped: "尚未接线" },
    idleSeal: { skipped: "idle 封存依赖版本服务与 R2（M4-5）" },
    backup: { skipped: "尚未接线" },
    maintenance: { step: null, detail: {}, skipped: true },
  };

  // ① 注册开关到期：读路径已按 close_at 判过期（不依赖 Cron），这里只是把状态写回磁盘
  try {
    const state = await getRegistrationState(env.DB, now);
    if (!state.open && state.close_at > 0 && state.close_at <= now) {
      const current = await env.DB.prepare("SELECT value FROM app_meta WHERE key = ?")
        .bind("registration_open")
        .first<{ value: string }>();
      if (current?.value === "1") {
        await setRegistrationState(env.DB, { open: false }, now);
        summary.registrationClosed = true;
      }
    }
  } catch (error) {
    console.error("cron: registration task failed", error);
  }

  // ② R2 GC：按 due_at 取一批，删对象后删队列行；没绑 R2 就只推进游标、不删行（否则会丢对象）
  try {
    summary.gcDeleted = await runR2Gc(env, now, JOB_R2_GC_BATCH);
  } catch (error) {
    console.error("cron: r2 gc failed", error);
  }

  // ③ 快照物化（M7 第 4 项 批 2）：D1 → R2 `snap/{uid}/`，增量按游标推进
  try {
    summary.snapshot = await runSnapshotSlot(env, now);
  } catch (error) {
    console.error("cron: snapshot failed", error);
    summary.snapshot = { skipped: "本轮快照物化失败，下轮重试" };
  }

  // ④ idle 封存兜底：客户端"关了标签页就走了"的那一批，由服务端补封（每轮 3 条）
  try {
    summary.idleSeal = {
      // 10 分钟＝设计默认档；用户把 `seal_idle_minutes` 调大/调小只影响"早一点或晚一点封存一次"，
      // 不会丢内容（逐用户精确判定要按用户查设置，收益不抵这一步的复杂度）
      sealed: await sealIdleVersions(env, now, 10, JOB_IDLE_SEAL_BATCH),
    };
  } catch (error) {
    console.error("cron: idle seal failed", error);
    summary.idleSeal = { skipped: "本轮 idle 封存失败，下轮重试" };
  }

  // ⑤ 外部备份推送（M7 第 4 项 批 3 落地，不再是接口位）
  try {
    summary.backup = await runPushSlot(env, now);
  } catch (error) {
    console.error("cron: backup push failed", error);
    summary.backup = { skipped: "本轮推送失败，下轮重试" };
  }

  // ⑥ 每日维护（放最后：前面几个都是"每轮都跑"的，这个是"一天一圈"的）
  try {
    summary.maintenance = await runMaintenanceStep(env, now);
  } catch (error) {
    console.error("cron: maintenance failed", error);
  }

  return summary;
}

/**
 * ③ 槽的实现：**只给"至少有一个启用中的目标"的用户物化快照**。
 *
 * 没有目标却照样物化 = 白写 R2（一天 96 轮 × 每轮全量，那是纯浪费）。
 * `limit` 是**每轮最多几个用户**——免费版一次 invocation 的子请求有限，
 * 家里 3–5 个人时它从来不生效，但它是防止"哪天多了一批账号把一轮撑爆"的那道闸。
 */
async function runSnapshotSlot(env: ScheduledEnv, now: number): Promise<SnapshotOutcome | { skipped: string }> {
  if (!env.ATTACHMENTS) return { skipped: "未绑定对象存储（ATTACHMENTS），快照无处可放" };

  const targets = await env.DB.prepare(
    "SELECT DISTINCT user_id FROM user_backup_targets WHERE enabled = 1 ORDER BY user_id LIMIT ?",
  )
    .bind(SNAPSHOT_USER_LIMIT)
    .all<{ user_id: string }>();
  const userIds = (targets.results ?? []).map((row) => row.user_id);
  if (userIds.length === 0) return { skipped: "没有启用中的备份目标，本轮无需物化" };

  const merged: SnapshotOutcome = { files: 0, items: 0, encrypted: 0, deferred: 0, cursorSeq: 0 };
  for (const userId of userIds) {
    const result = await materializeSnapshot(env, userId, now);
    if (result.skipped !== undefined) continue;
    merged.files += result.files;
    merged.items += result.items;
    merged.encrypted += result.encrypted;
    merged.deferred += result.deferred;
  }
  return merged;
}

/**
 * ⑤ 槽：给每个启用中的目标推**一批**。
 *
 * 每个目标各推一批（不是"总共一批分给所有人"）——限额是**每次 invocation** 的外部
 * 子请求数，多目标共享一个池子的话先跑完的目标会把后面的饿着，而"每个目标都按自己的
 * 游标推进"本来就是这个设计的口径。
 *
 * `limit` 是**每轮最多推几个目标**：家里 3–5 个人时它从来不生效。
 */
async function runPushSlot(
  env: ScheduledEnv,
  now: number,
): Promise<{ skipped: string } | { targets: number; pushed: number; failed: number }> {
  if (!env.ATTACHMENTS) return { skipped: "未绑定对象存储（ATTACHMENTS），无快照可推" };

  const rows = await env.DB.prepare(SQL_SELECT_ENABLED_BACKUP_TARGETS).all<BackupTargetRow>();
  const targets = (rows.results ?? []).slice(0, PUSH_TARGET_LIMIT);
  if (targets.length === 0) return { skipped: "没有启用中的备份目标" };

  let pushed = 0;
  let failed = 0;
  for (const target of targets) {
    const result = await pushOneRound(env, target, now);
    if (result.error !== null) {
      failed += 1;
      console.error("cron: backup push failed for target", target.id, result.error);
    }
    pushed += result.pushed;
  }
  return { targets: targets.length, pushed, failed };
}

/**
 * R2 GC：删队列里到期的对象。
 *
 * **顺序**：先删对象、再删队列行。反过来的话，删行成功而删对象失败就永久泄漏一个对象。
 * 删不存在的对象不算错（幂等口径），照删队列行。
 */
async function runR2Gc(env: ScheduledEnv, now: number, quota: number): Promise<number> {
  const rows = await env.DB.prepare(
    "SELECT r2_key, reason FROM r2_gc_queue WHERE due_at <= ? ORDER BY due_at ASC LIMIT ?",
  )
    .bind(now, quota)
    .all<{ r2_key: string; reason: string }>();
  if (rows.results.length === 0) return 0;

  let deleted = 0;
  for (const row of rows.results) {
    if (!env.ATTACHMENTS) {
      // 没绑对象存储：**队列行也不删**。删行等于宣布"对象已清理"，而它还在桶外面漂着——
      // 宁可下一轮重来，也不能把待删记录丢掉（这正是 r2_gc_queue 存在的意义）
      console.error("cron: ATTACHMENTS 未绑定，跳过 R2 GC（队列保留）");
      return deleted;
    }
    try {
      await env.ATTACHMENTS.delete(row.r2_key);
    } catch (error) {
      // 删除失败就留到下一轮（队列行不删）
      console.error(`cron: r2 delete failed for ${row.r2_key}`, error);
      continue;
    }
    await env.DB.prepare("DELETE FROM r2_gc_queue WHERE r2_key = ?").bind(row.r2_key).run();
    deleted += 1;
  }

  const last = rows.results[rows.results.length - 1];
  await env.DB.prepare(SQL_UPSERT_APP_META).bind(KEY_GC_CURSOR, last?.r2_key ?? "").run();
  return deleted;
}

/** 空转一轮的判定：Cron 里用不到，但单测与本地手验要看"这轮做了什么" */
export function summarize(summary: ScheduledSummary): string {
  const parts = [
    `gc=${summary.gcDeleted}`,
    `maintenance=${summary.maintenance.skipped ? "skip" : (summary.maintenance.step ?? "?")}`,
  ];
  if (summary.registrationClosed) parts.push("registration=closed");
  return parts.join(" ");
}

/** 供测试与日志引用（配额常量只有一处来源） */
export const QUOTAS = { gc: JOB_R2_GC_BATCH, sweep: JOB_SWEEP_BATCH } as const;

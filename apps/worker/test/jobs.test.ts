/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Cron 任务编排与每日维护（M4-8；《M4 设计》§7）。
 *
 * 这一摊的价值全在"重复跑也不会更糟"：Cron 每 15 分钟一次、多 isolate 可能并发，
 * 所以每个用例都同时检查**副作用**与**幂等性**（连跑两轮不该产生重复效果）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import {
  ATTACHMENT_ORPHAN_RETENTION_DAYS,
  DAY_MS,
  JOB_R2_GC_BATCH,
  TOMBSTONE_RETENTION_DAYS,
  TRASH_RETENTION_DAYS_DEFAULT,
} from "@menote/shared";
import { KEY_GC_CURSOR, QUOTAS, runScheduled } from "../src/services/jobs";
import {
  KEY_MAINTENANCE_DAY,
  KEY_MAINTENANCE_STEP,
  MAINTENANCE_STEPS,
  runMaintenanceStep,
  utcDay,
} from "../src/jobs/maintenance";
import { freshDatabase } from "./helpers";

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

async function meta(key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

async function seedUser(id = "u1"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (id, username, role, auth_salt, auth_kdf, auth_verifier, sync_seq, tombstone_floor, created_at, updated_at)
     VALUES (?, ?, 'owner', X'00', 'PBKDF2-SHA-256', X'00', 10, 0, 1, 1)`,
  )
    .bind(id, `user-${id}`)
    .run();
}

/** 造一条软删条目（永久删除与到期删除都要它） */
async function seedTrashedItem(id: string, deletedAt: number, userId = "u1"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO items (id, user_id, type, title, enc_self, in_enc_space, size_bytes, content_hash, tags,
       is_task, pinned, starred, rev, meta_rev, sync_seq, created_at, updated_at, deleted_at)
     VALUES (?, ?, 'note', '被删的', 0, 0, 1, 'h', '[]', 0, 0, 0, 1, 1, 1, 1, 1, ?)`,
  )
    .bind(id, userId, deletedAt)
    .run();
  await env.DB.prepare("INSERT INTO item_bodies (item_id, body) VALUES (?, '正文')").bind(id).run();
}

beforeEach(async () => {
  await freshDatabase();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("每日维护", () => {
  it("每轮推进一步并写 job:maintenance:step；走完一圈后记 day", async () => {
    await seedUser();

    const first = await runMaintenanceStep(env, NOW);
    expect(first.skipped).toBe(false);
    expect(first.step).toBe(MAINTENANCE_STEPS[0]);
    expect(await meta(KEY_MAINTENANCE_STEP)).toBe("1");

    // 依次走完剩下的步骤
    for (let index = 1; index < MAINTENANCE_STEPS.length; index += 1) {
      const result = await runMaintenanceStep(env, NOW);
      expect(result.step).toBe(MAINTENANCE_STEPS[index]);
    }
    expect(await meta(KEY_MAINTENANCE_DAY)).toBe(utcDay(NOW));
    expect(await meta(KEY_MAINTENANCE_STEP)).toBe("0");
  });

  it("同一天不再重复推进（day 游标挡住）", async () => {
    await seedUser();
    for (let index = 0; index < MAINTENANCE_STEPS.length; index += 1) {
      await runMaintenanceStep(env, NOW);
    }

    const again = await runMaintenanceStep(env, NOW);
    expect(again.skipped).toBe(true);
    expect(again.step).toBeNull();

    // 换一天又能跑
    const tomorrow = await runMaintenanceStep(env, NOW + DAY_MS);
    expect(tomorrow.skipped).toBe(false);
  });

  it("连跑两圈不产生重复副作用（不做锁的幂等要求）", async () => {
    await seedUser();
    await seedTrashedItem("old1", NOW - (TRASH_RETENTION_DAYS_DEFAULT + 1) * DAY_MS);

    const counts: number[] = [];
    for (let round = 0; round < 2; round += 1) {
      for (let index = 0; index < MAINTENANCE_STEPS.length; index += 1) {
        await runMaintenanceStep(env, NOW + round * DAY_MS);
      }
      counts.push(
        (await env.DB.prepare("SELECT COUNT(*) AS n FROM tombstones").first<{ n: number }>())?.n ?? 0,
      );
    }

    // 第一圈把它删了并写墓碑；第二圈不会再写一条
    expect(counts[0]).toBe(1);
    expect(counts[1]).toBe(1);
  });

  it("回收站到期条目被永久删除并写墓碑（未到期的不动）", async () => {
    await seedUser();
    await seedTrashedItem("expired", NOW - (TRASH_RETENTION_DAYS_DEFAULT + 1) * DAY_MS);
    await seedTrashedItem("fresh", NOW - 1 * DAY_MS);

    const result = await runMaintenanceStep(env, NOW);
    expect(result.step).toBe("trash_expiry");
    expect(result.detail.deleted).toBe(1);

    expect(await env.DB.prepare("SELECT 1 AS x FROM items WHERE id = 'expired'").first()).toBeNull();
    expect(await env.DB.prepare("SELECT 1 AS x FROM items WHERE id = 'fresh'").first()).not.toBeNull();
    const tombstones = await env.DB.prepare(
      "SELECT entity_id FROM tombstones WHERE user_id = 'u1'",
    ).all<{ entity_id: string }>();
    expect(tombstones.results.map((row) => row.entity_id)).toEqual(["expired"]);
  });

  it("保留期按**用户设置**走（设成 7 天时第 8 天就该删）", async () => {
    await seedUser();
    // 8 天前删的：默认 30 天不该删，但用户把保留期设成 7 天后就该删
    await seedTrashedItem("eight-days", NOW - 8 * DAY_MS);
    await env.DB.prepare(
      "INSERT INTO user_settings (user_id, json, rev, updated_at) VALUES ('u1', ?, 1, 1)",
    )
      .bind(JSON.stringify({ version_trash: { trash_retention_days: 7 } }))
      .run();

    const result = await runMaintenanceStep(env, NOW);
    expect(result.detail.deleted).toBe(1);
    expect(await env.DB.prepare("SELECT 1 AS x FROM items WHERE id = 'eight-days'").first()).toBeNull();
  });

  it("设置行损坏时退回默认保留期（维护任务不因一行脏数据停摆）", async () => {
    await seedUser();
    await seedTrashedItem("broken-settings", NOW - 5 * DAY_MS);
    await env.DB.prepare(
      "INSERT INTO user_settings (user_id, json, rev, updated_at) VALUES ('u1', '{不是 JSON', 1, 1)",
    ).run();

    const result = await runMaintenanceStep(env, NOW);
    // 默认 30 天：5 天前的还没到期
    expect(result.detail.deleted).toBe(0);
    expect(
      await env.DB.prepare("SELECT 1 AS x FROM items WHERE id = 'broken-settings'").first(),
    ).not.toBeNull();
  });

  it("附件：无引用标孤儿；到期登记 r2_gc_queue 并删行", async () => {
    await seedUser();
    // 一条已到期的孤儿（孤儿时刻早于保留期），一条刚标上的孤儿
    await env.DB.prepare(
      `INSERT INTO attachments (id, user_id, kind, sha256, r2_key, size_bytes, orphaned_at, created_at, updated_at)
       VALUES ('att-old', 'u1', 'original', 'h1', 'a/u1/h1', 10, ?, 1, 1)`,
    )
      .bind(NOW - (ATTACHMENT_ORPHAN_RETENTION_DAYS + 1) * DAY_MS)
      .run();
    await env.DB.prepare(
      `INSERT INTO attachments (id, user_id, kind, sha256, r2_key, size_bytes, created_at, updated_at)
       VALUES ('att-new', 'u1', 'original', 'h2', 'a/u1/h2', 10, 1, 1)`,
    ).run();

    // 走到第三步（attachment_orphans）
    await runMaintenanceStep(env, NOW); // 0 trash_expiry
    await runMaintenanceStep(env, NOW); // 1 version_sweep
    const result = await runMaintenanceStep(env, NOW); // 2 attachment_orphans
    expect(result.step).toBe("attachment_orphans");
    expect(result.detail.removed).toBe(1);

    // 到期的孤儿：进 GC 队列 + 行没了
    const queued = await env.DB.prepare("SELECT reason FROM r2_gc_queue WHERE r2_key = 'a/u1/h1'")
      .first<{ reason: string }>();
    expect(queued?.reason).toBe("orphan");
    expect(await env.DB.prepare("SELECT 1 AS x FROM attachments WHERE id = 'att-old'").first()).toBeNull();

    // 新孤儿被标上 orphaned_at，但还没到期
    const fresh = await env.DB.prepare("SELECT orphaned_at FROM attachments WHERE id = 'att-new'")
      .first<{ orphaned_at: number | null }>();
    expect(fresh?.orphaned_at).toBe(NOW);
  });

  it("引用一致性：指向已不存在附件/条目的引用行被清掉", async () => {
    await seedUser();
    await env.DB.prepare(
      "INSERT INTO attachment_refs (item_id, version_id, attachment_id, created_at) VALUES ('ghost-item', NULL, 'ghost-att', 1)",
    ).run();

    await runMaintenanceStep(env, NOW); // 0
    await runMaintenanceStep(env, NOW); // 1
    await runMaintenanceStep(env, NOW); // 2
    const result = await runMaintenanceStep(env, NOW); // 3 ref_integrity
    expect(result.step).toBe("ref_integrity");
    expect(result.detail.removed_refs).toBe(1);
  });

  it("墓碑超过 180 天被清理，且 users.tombstone_floor 推进到剩余最小序号", async () => {
    await seedUser();
    await env.DB.prepare(
      "INSERT INTO tombstones (user_id, entity, entity_id, sync_seq, deleted_at) VALUES ('u1', 'item', 'old', 2, ?)",
    )
      .bind(NOW - (TOMBSTONE_RETENTION_DAYS + 1) * DAY_MS)
      .run();
    await env.DB.prepare(
      "INSERT INTO tombstones (user_id, entity, entity_id, sync_seq, deleted_at) VALUES ('u1', 'item', 'recent', 7, ?)",
    )
      .bind(NOW - 1 * DAY_MS)
      .run();
    await env.DB.prepare("DELETE FROM sessions").run(); // 顺手确认清理步骤不依赖会话表内容

    // 走到最后一步（cleanup）
    for (let index = 0; index < MAINTENANCE_STEPS.length - 1; index += 1) {
      await runMaintenanceStep(env, NOW);
    }
    const result = await runMaintenanceStep(env, NOW);
    expect(result.step).toBe("cleanup");
    expect(result.detail.tombstones).toBe(1);

    const rows = await env.DB.prepare("SELECT entity_id FROM tombstones WHERE user_id = 'u1'")
      .all<{ entity_id: string }>();
    expect(rows.results.map((row) => row.entity_id)).toEqual(["recent"]);

    const floor = await env.DB.prepare("SELECT tombstone_floor FROM users WHERE id = 'u1'")
      .first<{ tombstone_floor: number }>();
    expect(floor?.tombstone_floor).toBe(7); // 剩余墓碑的最小序号
  });
});

describe("Cron 一轮", () => {
  it(`一轮最多删 ${JOB_R2_GC_BATCH} 个 GC 对象并推进 ${KEY_GC_CURSOR}`, async () => {
    await seedUser();
    const total = JOB_R2_GC_BATCH + 5;
    for (let index = 0; index < total; index += 1) {
      await env.DB.prepare(
        "INSERT INTO r2_gc_queue (r2_key, user_id, reason, due_at, created_at) VALUES (?, 'u1', 'delete', ?, 1)",
      )
        .bind(`k${String(index).padStart(3, "0")}`, NOW - 1)
        .run();
    }

    // 现在生产绑定已就位（`wrangler.jsonc` 的 `r2_buckets`），测试里直接用 miniflare 的真实桶；
    // 只额外记录"删了哪些键"，好断言游标推进到哪一把
    const deletedKeys: string[] = [];
    const realBucket = env.ATTACHMENTS as R2Bucket;
    const bucket = {
      delete: async (key: string) => {
        deletedKeys.push(key);
        await realBucket.delete(key);
      },
    } as unknown as R2Bucket;

    const first = await runScheduled({ DB: env.DB, ATTACHMENTS: bucket }, NOW);
    expect(first.gcDeleted).toBe(JOB_R2_GC_BATCH);
    expect(deletedKeys).toHaveLength(JOB_R2_GC_BATCH);
    expect(await meta(KEY_GC_CURSOR)).toBe(`k${String(JOB_R2_GC_BATCH - 1).padStart(3, "0")}`);

    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM r2_gc_queue").first<{ n: number }>();
    expect(left?.n).toBe(5);

    const second = await runScheduled({ DB: env.DB, ATTACHMENTS: bucket }, NOW);
    expect(second.gcDeleted).toBe(5);
    expect(deletedKeys).toHaveLength(total);
  });

  it("没绑 R2 时不删队列行（宁可不删，也不能丢掉对象）", async () => {
    await seedUser();
    await env.DB.prepare(
      "INSERT INTO r2_gc_queue (r2_key, user_id, reason, due_at, created_at) VALUES ('k1', 'u1', 'delete', ?, 1)",
    )
      .bind(NOW - 1)
      .run();

    const summary = await runScheduled({ DB: env.DB }, NOW);
    expect(summary.gcDeleted).toBe(0);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM r2_gc_queue").first<{ n: number }>();
    expect(left?.n).toBe(1);
  });

  it("注册开关到期时写回关闭（读路径本来就按 close_at 判，这里只归位状态）", async () => {
    await seedUser();
    await env.DB.prepare(
      "INSERT INTO app_meta (key, value) VALUES ('registration_open', '1'), ('registration_close_at', ?)",
    )
      .bind(String(NOW - 1000))
      .run();

    const summary = await runScheduled({ DB: env.DB }, NOW);
    expect(summary.registrationClosed).toBe(true);
    expect(await meta("registration_open")).toBe("0");
  });

  it("未落地的任务明确跳过并把原因写进 summary（不假装跑过）", async () => {
    await seedUser();
    const summary = await runScheduled({ DB: env.DB }, NOW);
    expect(summary.snapshot).toEqual({ skipped: "快照队列属 M5/M6（接口位已留）" });
    // idle 封存（M4-5）已经落地：没有候选时如实报 0，而不是报"跳过"
    expect(summary.idleSeal).toEqual({ sealed: 0 });
    expect(summary.backup).toEqual({ skipped: "外部备份属 M5（接口位已留）" });
    expect(QUOTAS.sweep).toBeGreaterThan(0);
  });

  it("scheduled 只转调：入口用 waitUntil 把这一轮交给运行时（架构 §2.3.1）", async () => {
    await seedUser();
    const worker = (await import("../src/index")).default;
    const ctx = createExecutionContext();

    worker.scheduled?.({ cron: "*/15 * * * *", scheduledTime: NOW, noRetry: () => {} } as never, env, ctx);
    await waitOnExecutionContext(ctx);

    // 这一轮确实落到了业务侧（游标写出来了），而不是空壳
    expect(await meta(KEY_MAINTENANCE_STEP)).toBe("1");
  });
});

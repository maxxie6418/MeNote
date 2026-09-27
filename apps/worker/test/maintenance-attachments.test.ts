/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 维护任务的孤儿附件清理（2026-09-27 修）。
 *
 * **背景**：这一段原本在 `jobs/maintenance.ts` 里是**内联 SQL**，与服务层的
 * `sweepOrphanedAttachments` 是两份实现，而且两边的 GC 登记时间不一致——维护那边把
 * `due_at` 写成了 `now + 30 天`（像是把"标孤儿"的等待期又抄了一遍），
 * 于是**对象在行删掉之后还要在 R2 里多躺 30 天**。现在统一走服务层那一份，
 * 这个用例钉住"登记时间就是现在"，避免它再漂回去。
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ATTACHMENT_ORPHAN_RETENTION_DAYS, DAY_MS } from "@menote/shared";
import { runMaintenanceStep } from "../src/jobs/maintenance";
import { freshDatabase } from "./helpers";

const NOW = Date.UTC(2026, 8, 27, 3, 0, 0);

async function seedUser(id = "u1"): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, username, role, auth_salt, auth_kdf, auth_verifier, sync_seq, tombstone_floor, created_at, updated_at)
     VALUES (?, ?, 'owner', X'00', 'PBKDF2-SHA-256', X'00', 0, 0, 1, 1)`,
  )
    .bind(id, `user-${id}`)
    .run();
}

/** 一条附件行；`orphanedAt` 给 null 表示"还在被引用" */
async function seedAttachment(
  id: string,
  orphanedAt: number | null,
  withRef = false,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO attachments (id, user_id, kind, parent_id, sha256, r2_key, mime, size_bytes,
       width, height, filename, orphaned_at, created_at, updated_at)
     VALUES (?, 'u1', 'original', NULL, ?, ?, 'image/png', 10, NULL, NULL, 'a.png', ?, 1, 1)`,
  )
    .bind(id, id.padEnd(64, "0").slice(0, 64), `a/u1/${id}`, orphanedAt)
    .run();
  if (withRef) {
    await env.DB.prepare(
      "INSERT INTO items (id, user_id, type, title, enc_self, in_enc_space, size_bytes, content_hash, tags, is_task, pinned, starred, rev, meta_rev, sync_seq, created_at, updated_at) VALUES ('i1','u1','note','t',0,0,1,'h','[]',0,0,0,1,1,1,1,1)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO attachment_refs (item_id, version_id, attachment_id, created_at) VALUES ('i1', NULL, ?, 1)",
    )
      .bind(id)
      .run();
  }
}

/** 跑到第 3 步（attachment_orphans）为止 */
async function runToOrphanStep(): Promise<Record<string, number | string>> {
  await runMaintenanceStep(env, NOW); // 0 trash_expiry
  await runMaintenanceStep(env, NOW); // 1 version_sweep
  const result = await runMaintenanceStep(env, NOW); // 2 attachment_orphans
  expect(result.step).toBe("attachment_orphans");
  return result.detail;
}

beforeEach(async () => {
  await freshDatabase();
  await seedUser();
});

describe("孤儿附件的标记与到期清理", () => {
  it("没有引用的附件被标孤儿；有引用的不动", async () => {
    await seedAttachment("orphan", null);
    await seedAttachment("referenced", null, true);

    const detail = await runToOrphanStep();
    expect(detail.marked).toBe(1);
    expect(detail.removed).toBe(0);

    const rows = await env.DB.prepare("SELECT id, orphaned_at FROM attachments ORDER BY id").all<{
      id: string;
      orphaned_at: number | null;
    }>();
    const byId = new Map(rows.results.map((row) => [row.id, row.orphaned_at]));
    expect(byId.get("orphan")).toBe(NOW);
    expect(byId.get("referenced")).toBeNull();
  });

  it("到期孤儿：登记 GC（**due_at = now**）并删行——不再多躺 30 天", async () => {
    const expired = NOW - (ATTACHMENT_ORPHAN_RETENTION_DAYS + 1) * DAY_MS;
    await seedAttachment("old", expired);

    const detail = await runToOrphanStep();
    expect(detail.removed).toBe(1);

    // 行删了
    expect(
      await env.DB.prepare("SELECT 1 AS x FROM attachments WHERE id = 'old'").first(),
    ).toBeNull();

    // 对象进了 GC 队列，且**现在就该删**（曾经写成 now + 30 天）
    const queued = await env.DB.prepare(
      "SELECT r2_key, reason, due_at FROM r2_gc_queue WHERE r2_key = 'a/u1/old'",
    ).first<{ r2_key: string; reason: string; due_at: number }>();
    expect(queued?.reason).toBe("orphan");
    expect(queued?.due_at).toBe(NOW);
  });

  it("没到期的孤儿只标记、不删（30 天保留期的意义）", async () => {
    const recent = NOW - 5 * DAY_MS;
    await seedAttachment("recent", recent);

    const detail = await runToOrphanStep();
    expect(detail.marked).toBe(0); // 已经有 orphaned_at 了
    expect(detail.removed).toBe(0);

    expect(
      await env.DB.prepare("SELECT 1 AS x FROM attachments WHERE id = 'recent'").first(),
    ).not.toBeNull();
    expect(
      await env.DB.prepare("SELECT 1 AS x FROM r2_gc_queue WHERE r2_key = 'a/u1/recent'").first(),
    ).toBeNull();
  });
});

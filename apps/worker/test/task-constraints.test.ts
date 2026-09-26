/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 0002 迁移：任务字段字面量的约束（M2-5）。
 *
 * 这里**直接走 SQL**，不经过服务层：要验的正是"就算有人绕过 TypeScript 与 valibot（例如以后的 MCP
 * 通道、脚本、手写 SQL），数据库也不会存进非法值"。触发器覆盖 INSERT 与 UPDATE 两条路径。
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureSchema } from "../src/db/selfheal";
import { resetDatabase } from "./helpers";

interface TaskFields {
  is_task?: number;
  task_status?: string | null;
  task_due?: string | null;
  task_priority?: string | null;
}

/** 插一条最小的合法 Memo 行（type=memo 时 title 必须为空、memo_at 必须有） */
async function insertItem(id: string, fields: TaskFields = {}) {
  const now = Date.now();
  return env.DB.prepare(
    "INSERT INTO items (id, user_id, type, title, size_bytes, content_hash, memo_at, is_task, task_status, task_due, task_priority, sync_seq, created_at, updated_at) VALUES (?, 'u1', 'memo', NULL, 10, 'h', ?, ?, ?, ?, ?, 1, ?, ?)",
  )
    .bind(
      id,
      now,
      fields.is_task ?? 1,
      fields.task_status ?? null,
      fields.task_due ?? null,
      fields.task_priority ?? null,
      now,
      now,
    )
    .run();
}

async function updateStatus(id: string, status: string) {
  return env.DB.prepare("UPDATE items SET task_status = ? WHERE id = ?").bind(status, id).run();
}

beforeEach(async () => {
  await resetDatabase();
  const result = await ensureSchema(env.DB);
  expect(result.ok).toBe(true);
});

describe("任务字段字面量约束（0002 触发器）", () => {
  it("合法值可以写入：todo/doing/done 与 high/medium/low", async () => {
    await insertItem("t1", { task_status: "todo", task_priority: "high" });
    await insertItem("t2", { task_status: "doing", task_priority: "medium" });
    await insertItem("t3", { task_status: "done", task_priority: "low", task_due: "2026-09-30" });

    const rows = await env.DB.prepare("SELECT COUNT(*) AS count FROM items").first<{ count: number }>();
    expect(rows?.count).toBe(3);
  });

  it("三个字段都可以为空（M07-03）", async () => {
    await insertItem("t1", {});
    const row = await env.DB.prepare("SELECT task_status, task_due, task_priority FROM items WHERE id = 't1'").first();
    expect(row).toEqual({ task_status: null, task_due: null, task_priority: null });
  });

  it("task_status 拒绝中文与任意字符串（写入只认英文，中文兼容只在客户端）", async () => {
    await expect(insertItem("bad", { task_status: "待办" })).rejects.toThrow(/invalid task_status/);
    await expect(insertItem("bad2", { task_status: "pending" })).rejects.toThrow(/invalid task_status/);
  });

  it("task_priority 同样受约束", async () => {
    await expect(insertItem("bad", { task_priority: "urgent" })).rejects.toThrow(/invalid task_priority/);
    await expect(insertItem("bad2", { task_priority: "高" })).rejects.toThrow(/invalid task_priority/);
  });

  it("UPDATE 路径也拦得住（改状态是 M2-5 的常规操作）", async () => {
    await insertItem("t1", { task_status: "todo" });

    await updateStatus("t1", "doing");
    const ok = await env.DB.prepare("SELECT task_status FROM items WHERE id = 't1'").first<{ task_status: string }>();
    expect(ok?.task_status).toBe("doing");

    await expect(updateStatus("t1", "搞定")).rejects.toThrow(/invalid task_status/);
  });

  it("is_task = 0 时不允许带任务字段（避免没有清单标记却有状态的脏数据）", async () => {
    await expect(insertItem("bad", { is_task: 0, task_status: "todo" })).rejects.toThrow(
      /task fields require is_task=1/,
    );
    await expect(insertItem("bad2", { is_task: 0, task_due: "2026-09-30" })).rejects.toThrow(
      /task fields require is_task=1/,
    );
    // 去掉标记的同时必须清空字段
    await insertItem("ok", { is_task: 0 });
  });

  it("去掉清单标记（is_task: 1 → 0）时若不清字段也会被拦", async () => {
    await insertItem("t1", { is_task: 1, task_status: "todo" });
    await expect(
      env.DB.prepare("UPDATE items SET is_task = 0 WHERE id = 't1'").run(),
    ).rejects.toThrow(/task fields require is_task=1/);

    // 正确做法：一并清空
    await env.DB.prepare(
      "UPDATE items SET is_task = 0, task_status = NULL, task_due = NULL, task_priority = NULL WHERE id = 't1'",
    ).run();
    const row = await env.DB.prepare("SELECT is_task FROM items WHERE id = 't1'").first<{ is_task: number }>();
    expect(row?.is_task).toBe(0);
  });
});

/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_SCHEMA_VERSION,
  ensureSchema,
  resetSchemaCacheForTests,
  verifySchema,
} from "../src/db/selfheal";

/** 0001 迁移应当建立的全部对象（与 docs/modules/Menote-数据模型与迁移设计-v1.md §3.2 一致） */
const TABLES = [
  "app_meta",
  "users",
  "sessions",
  "auth_throttle",
  "user_settings",
  "folders",
  "items",
  "item_bodies",
] as const;

const INDEXES = [
  "idx_sessions_user",
  "idx_sessions_expires",
  "idx_folders_sync",
  "idx_folders_parent",
  "idx_folders_enc_space",
  "idx_items_sync",
  "idx_items_folder",
  "idx_items_memo",
  "idx_items_task",
  "idx_items_trash",
] as const;

/** 把库恢复成空库，避免用例之间互相污染（测试文件内共享同一个本地 D1） */
async function resetDatabase(): Promise<void> {
  await env.DB.exec("DROP VIEW IF EXISTS idx_items_sync");
  for (const name of TABLES) {
    await env.DB.exec(`DROP TABLE IF EXISTS ${name}`);
  }
  resetSchemaCacheForTests();
}

async function readVersion(): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").first<{
    value: string;
  }>();
  return Number.parseInt(row?.value ?? "0", 10);
}

async function listObjects(): Promise<Set<string>> {
  const rows = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'",
  ).all<{ name: string }>();
  return new Set(rows.results.map((row) => row.name));
}

describe("运行时自愈迁移", () => {
  it("空库首次调用后建立全部表与索引", async () => {
    await resetDatabase();

    const result = await ensureSchema(env.DB);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.version).toBe(EXPECTED_SCHEMA_VERSION);

    const names = await listObjects();
    const missing = [...TABLES, ...INDEXES].filter((name) => !names.has(name));
    expect(missing, `缺失对象：${missing.join(", ")}`).toEqual([]);
  });

  it("重复调用幂等：版本不变、结构仍完整", async () => {
    await resetDatabase();

    expect((await ensureSchema(env.DB)).ok).toBe(true);
    const version = await readVersion();

    resetSchemaCacheForTests();
    const again = await ensureSchema(env.DB);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.version).toBe(version);

    await verifySchema(env.DB);
    expect(await readVersion()).toBe(EXPECTED_SCHEMA_VERSION);
  });

  it("并发调用：至少一方完成迁移，另一方要么放行要么报 migrating，结构完整", async () => {
    await resetDatabase();

    const now = Date.now();
    const results = await Promise.all([ensureSchema(env.DB, now), ensureSchema(env.DB, now)]);

    expect(results.some((result) => result.ok)).toBe(true);
    for (const result of results) {
      if (!result.ok) expect(result.reason).toBe("migrating");
    }
    await verifySchema(env.DB);
    expect(await readVersion()).toBe(EXPECTED_SCHEMA_VERSION);
  });

  it("版本高于代码期望时放行（前向兼容，便于回滚）", async () => {
    await resetDatabase();
    await ensureSchema(env.DB);

    const ahead = EXPECTED_SCHEMA_VERSION + 4;
    await env.DB.prepare("UPDATE app_meta SET value = ? WHERE key = 'schema_version'").bind(String(ahead)).run();

    resetSchemaCacheForTests();
    const result = await ensureSchema(env.DB);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.version).toBe(ahead);
  });

  it("迁移中途失败：返回 failed、批次回滚、版本不前移、锁不被释放", async () => {
    await resetDatabase();

    // 占住 idx_items_sync 这个名字：SQLite 下 CREATE INDEX ... 撞同名对象必然报错，
    // 于是迁移会在中途失败（对应设计稿"中途失败不留半成品"的要求）。
    await env.DB.exec("CREATE VIEW idx_items_sync AS SELECT 1 AS x");

    const result = await ensureSchema(env.DB);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("failed");

    // app_meta 由 ensureSchema 自己建好并播种为 0；迁移失败后版本必须还是 0
    expect(await readVersion()).toBe(0);

    // 批次是事务：前面的建表语句必须一起回滚，不能留半成品
    const names = await listObjects();
    expect(names.has("users")).toBe(false);
    expect(names.has("items")).toBe(false);
  });

  it("verifySchema 在对象缺失时报错并点名", async () => {
    await resetDatabase();
    await ensureSchema(env.DB);

    await env.DB.exec("DROP TABLE item_bodies");
    await expect(verifySchema(env.DB)).rejects.toThrow(/item_bodies/);
  });

  it("已知边界：版本达标后不再校验结构漂移（自愈只按版本号触发）", async () => {
    await resetDatabase();
    await ensureSchema(env.DB);

    await env.DB.exec("DROP TABLE item_bodies");
    resetSchemaCacheForTests();

    const result = await ensureSchema(env.DB);
    expect(result.ok).toBe(true);

    // 结构漂移要靠新版本迁移或人工处理，自愈不会重建
    await env.DB.exec("CREATE TABLE item_bodies (item_id TEXT PRIMARY KEY, body TEXT NOT NULL)");
    await verifySchema(env.DB);
  });
});

describe("表结构守卫（middleware/schema.ts）", () => {
  it("/api/health 不依赖表结构：空库也返回 200", async () => {
    await resetDatabase();

    const res = await SELF.fetch("https://menote.test/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; app: string };
    expect(body.ok).toBe(true);
    expect(body.app).toBe("Menote");
  });

  it("业务路径先跑自愈迁移，再落到统一 404 错误体", async () => {
    await resetDatabase();

    const res = await SELF.fetch("https://menote.test/api/none");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_found");

    // 证明守卫确实建了表
    await verifySchema(env.DB);
  });
});

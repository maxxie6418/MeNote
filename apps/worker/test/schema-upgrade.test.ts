/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 迁移演练：**0003 → 0004**（M4-13 收口要求）。
 *
 * 线上库是"运行时自愈"升上去的（`ensureSchema`，架构 §15.5），所以演练要复现的正是那个状态：
 * **`schema_version = 3` + 六张 M4 表不存在 + 库里已经有存量数据**，然后调一次 `ensureSchema`，
 * 核对三件事：
 * 1. 版本推到 4，六张表与索引都建出来；
 * 2. **存量数据一条不少**（升级不能动既有表）；
 * 3. `verifySchema` 通过（收口判据就是它）。
 *
 * 把 M4 的对象"拆回 0003 的样子"而不是重放 0001–0003 的 DDL：两者的差别只在
 * "哪些对象存在"，而 0004 的 DDL 是 `CREATE ... IF NOT EXISTS`（幂等），
 * 所以"删掉再让自愈建回来"与"线上从无到有"走的是同一条代码路径。
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { M4_INDEX_NAMES, M4_TABLE_NAMES } from "../src/db/migrations/0004_content_integrity";
import {
  EXPECTED_SCHEMA_VERSION,
  ensureSchema,
  resetSchemaCacheForTests,
  verifySchema,
} from "../src/db/selfheal";
import { INDEXES, TABLES, listObjects, readSchemaVersion, resetDatabase } from "./helpers";

/** 造出"0003 时代的存量数据"：一个用户、一个文件夹、一条笔记 + 正文、一条设置 */
async function seedLegacyData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, username, role, auth_salt, auth_kdf, auth_verifier, sync_seq, tombstone_floor, created_at, updated_at)
       VALUES ('u-legacy', 'legacy', 'owner', X'00', 'PBKDF2-SHA-256', X'00', 7, 0, 1, 1)`,
    ),
    env.DB.prepare(
      `INSERT INTO folders (id, user_id, parent_id, is_enc_space, in_enc_space, name, depth, position,
         meta_rev, sync_seq, created_at, updated_at)
       VALUES ('f-legacy', 'u-legacy', NULL, 0, 0, '旧文件夹', 1, 0, 1, 1, 1, 1)`,
    ),
    env.DB.prepare(
      `INSERT INTO items (id, user_id, folder_id, type, title, enc_self, in_enc_space, size_bytes,
         content_hash, tags, is_task, pinned, starred, rev, meta_rev, sync_seq, created_at, updated_at, last_edit_at)
       VALUES ('i-legacy', 'u-legacy', 'f-legacy', 'note', '旧笔记', 0, 0, 12, 'hash-legacy', '["旧标签"]',
         0, 0, 0, 3, 2, 5, 1, 2, 2)`,
    ),
    env.DB.prepare("INSERT INTO item_bodies (item_id, body) VALUES ('i-legacy', '旧正文内容')"),
    env.DB.prepare(
      `INSERT INTO user_settings (user_id, json, rev, updated_at)
       VALUES ('u-legacy', '{"start_view":"home"}', 1, 1)`,
    ),
  ]);
}

/** 把库还原成 0003 的样子：M4 的对象全删、版本号写回 3 */
async function downgradeTo0003(): Promise<void> {
  for (const index of M4_INDEX_NAMES) {
    await env.DB.exec(`DROP INDEX IF EXISTS ${index}`);
  }
  for (const table of M4_TABLE_NAMES) {
    await env.DB.exec(`DROP TABLE IF EXISTS ${table}`);
  }
  await env.DB.prepare("UPDATE app_meta SET value = '3' WHERE key = 'schema_version'").run();
  resetSchemaCacheForTests();
}

async function legacySnapshot(): Promise<string> {
  const user = await env.DB.prepare("SELECT username, sync_seq FROM users WHERE id = 'u-legacy'").first();
  const folder = await env.DB.prepare("SELECT name FROM folders WHERE id = 'f-legacy'").first();
  const item = await env.DB.prepare(
    "SELECT title, tags, rev, meta_rev, sync_seq FROM items WHERE id = 'i-legacy'",
  ).first();
  const body = await env.DB.prepare("SELECT body FROM item_bodies WHERE item_id = 'i-legacy'").first();
  const settings = await env.DB.prepare("SELECT json FROM user_settings WHERE user_id = 'u-legacy'").first();
  return JSON.stringify({ user, folder, item, body, settings });
}

beforeEach(async () => {
  await resetDatabase();
  await ensureSchema(env.DB);
  await seedLegacyData();
});

describe("迁移演练 0003 → 0004", () => {
  it("升级后版本到 4、六张表与索引齐全，且**存量数据一条不少**", async () => {
    const before = await legacySnapshot();
    await downgradeTo0003();

    // 前提成立：此刻确实"少了 0004"
    expect(await readSchemaVersion()).toBe(3);
    const namesBefore = await listObjects();
    expect(M4_TABLE_NAMES.filter((name) => namesBefore.has(name))).toEqual([]);

    const result = await ensureSchema(env.DB);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.version).toBe(EXPECTED_SCHEMA_VERSION);

    expect(await readSchemaVersion()).toBe(4);
    const names = await listObjects();
    const missing = [...TABLES, ...INDEXES].filter((name) => !names.has(name));
    expect(missing, `升级后仍缺对象：${missing.join(", ")}`).toEqual([]);

    // 存量数据逐字段比对（升级只加对象，不该碰既有行）
    expect(await legacySnapshot()).toBe(before);
  });

  it("升级后 verifySchema 通过（收口判据）", async () => {
    await downgradeTo0003();
    await ensureSchema(env.DB);
    await expect(verifySchema(env.DB)).resolves.toBeUndefined();
  });

  it("升级是幂等的：再跑一次版本不变、数据不变", async () => {
    await downgradeTo0003();
    await ensureSchema(env.DB);
    const after = await legacySnapshot();

    resetSchemaCacheForTests();
    const again = await ensureSchema(env.DB);
    expect(again.ok).toBe(true);
    expect(await readSchemaVersion()).toBe(4);
    expect(await legacySnapshot()).toBe(after);
  });

  it("**半升级**（部分 M4 表已存在）也能补齐：自愈按对象逐个判存在", async () => {
    await downgradeTo0003();
    // 只留一张 M4 表，模拟"上一轮迁到一半就被打断"（`exec` 按行切分，所以写成一行）
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS item_versions (id TEXT PRIMARY KEY, item_id TEXT NOT NULL, user_id TEXT NOT NULL, rev INTEGER NOT NULL, reason TEXT NOT NULL, label TEXT, keep INTEGER NOT NULL DEFAULT 0, codec TEXT NOT NULL, size_bytes INTEGER NOT NULL, content_hash TEXT NOT NULL, title TEXT, r2_key TEXT NOT NULL, created_at INTEGER NOT NULL)",
    );

    const result = await ensureSchema(env.DB);
    expect(result.ok).toBe(true);
    const names = await listObjects();
    expect(M4_TABLE_NAMES.filter((name) => !names.has(name))).toEqual([]);
  });

  it("升级新建的表可写可查（不是空壳）", async () => {
    await downgradeTo0003();
    await ensureSchema(env.DB);

    // 用 0004 的一张表做一次真实写入：归档队列（GC 与墓碑之外的第三张）
    await env.DB.prepare(
      "INSERT INTO r2_gc_queue (r2_key, user_id, reason, due_at, created_at) VALUES (?, ?, 'delete', ?, ?)",
    )
      .bind("a/u-legacy/deadbeef", "u-legacy", 10, 1)
      .run();
    const row = await env.DB.prepare("SELECT reason FROM r2_gc_queue WHERE r2_key = ?")
      .bind("a/u-legacy/deadbeef")
      .first<{ reason: string }>();
    expect(row?.reason).toBe("delete");
  });
});

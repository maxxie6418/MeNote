/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 集成测试共用助手：把本地 D1 恢复成空库、或空库 + 建好表结构。
 * 同一个测试文件内共享一份本地 D1，因此每个用例开头都要重置。
 */
import { env } from "cloudflare:test";
import { EXPECTED_SCHEMA_VERSION, ensureSchema, resetSchemaCacheForTests } from "../src/db/selfheal";

/** 0001 迁移应当建立的全部对象（与 docs/modules/Menote-数据模型与迁移设计-v1.md §3.2 一致） */
export const TABLES = [
  "app_meta",
  "users",
  "sessions",
  "auth_throttle",
  "user_settings",
  "folders",
  "items",
  "item_bodies",
] as const;

export const INDEXES = [
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

/** 恢复到空库（含清掉 isolate 级的"已达标"标记） */
export async function resetDatabase(): Promise<void> {
  await env.DB.exec("DROP VIEW IF EXISTS idx_items_sync");
  for (const name of TABLES) {
    await env.DB.exec(`DROP TABLE IF EXISTS ${name}`);
  }
  resetSchemaCacheForTests();
}

/** 空库 + 通过自愈迁移建好表结构；用例开头调用 */
export async function freshDatabase(): Promise<void> {
  await resetDatabase();
  const result = await ensureSchema(env.DB);
  if (!result.ok) {
    throw new Error(`建表失败：${JSON.stringify(result)}`);
  }
}

export async function readSchemaVersion(): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").first<{
    value: string;
  }>();
  return Number.parseInt(row?.value ?? "0", 10);
}

export async function listObjects(): Promise<Set<string>> {
  const rows = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'",
  ).all<{ name: string }>();
  return new Set(rows.results.map((row) => row.name));
}

export { EXPECTED_SCHEMA_VERSION };

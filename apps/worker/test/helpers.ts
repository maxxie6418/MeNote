/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 集成测试共用助手：把本地 D1 恢复成空库、或空库 + 建好表结构。
 * 同一个测试文件内共享一份本地 D1，因此每个用例开头都要重置。
 */
import { env } from "cloudflare:test";
import { M4_INDEX_NAMES, M4_TABLE_NAMES } from "../src/db/migrations/0004_content_integrity";
import {
  M5_SHARE_INDEX_NAMES,
  M5_SHARE_TABLE_NAMES,
} from "../src/db/migrations/0005_shares";
import { EXPECTED_SCHEMA_VERSION, ensureSchema, resetSchemaCacheForTests } from "../src/db/selfheal";

/**
 * 迁移应当建立的全部对象（0001 的 8 张 + 0003 的 `user_crypto` + 0004 的六张 + 0005 的两张；
 * 见《数据模型与迁移设计》§3.2、《隐私锁设计》§4.1、《M4 设计》§六、设计文档 §DDL）。
 * 0004 / 0005 直接引迁移文件导出的清单，免得两处各写一份而漂移。
 */
export const TABLES = [
  "app_meta",
  "users",
  "sessions",
  "auth_throttle",
  "user_settings",
  "folders",
  "items",
  "item_bodies",
  // 0003（M3）：隐私锁的门禁材料
  "user_crypto",
  // 0004（M4）：内容完整性六表
  ...M4_TABLE_NAMES,
  // 0005（M5）：分享两表
  ...M5_SHARE_TABLE_NAMES,
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
  ...M4_INDEX_NAMES,
  ...M5_SHARE_INDEX_NAMES,
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

/**
 * 把刚注册的账号还原成 **M1/M2 存量账号**的样子：删掉注册时补建的加密空间行、把用户计数器归零。
 *
 * 为什么需要它：M3 起**每个新账号都自带一条空间行**（《隐私锁设计》§6.2），
 * 于是"空库首拉"这类游标用例的空库前提不再成立。存量账号（还没有空间行）是真实存在的状态，
 * 所以这里不是绕过断言，而是换一个同样真实的起点。
 */
export async function asLegacyAccount(userId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM folders WHERE user_id = ? AND is_enc_space = 1")
    .bind(userId)
    .run();
  await env.DB.prepare("UPDATE users SET sync_seq = 0 WHERE id = ?").bind(userId).run();
}

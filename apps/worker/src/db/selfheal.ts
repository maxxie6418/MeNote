/**
 * 运行时自愈迁移（架构 §15.4；口径见 `docs/modules/Menote-数据模型与迁移设计-v1.md` §4）。
 *
 * 为什么不用 `wrangler d1 migrations apply`：该命令在全新账户上会因查不到库而失败
 * （CLI 不会自动供给 D1），而主部署通道 Workers Builds 用的是 `npx wrangler deploy`，
 * 改根 `deploy` 脚本对它无效。自愈迁移让"一键部署零手工步骤"真正成立：
 * 部署时 D1 自动供给并绑定，第一个请求建表。
 *
 * 流程：建 app_meta → 读版本 → 抢锁（TTL 60s）→ 按序执行 → 校验对象齐备 → 写版本。
 * 中途失败不写版本、不释放锁（用 TTL 自然限流重试），下次请求重跑（DDL 全部幂等）。
 */
import { MIGRATION_LOCK_TTL_MS } from "@menote/shared";
import { migration0001, type MigrationScript } from "./migrations/0001_init";

/** 全部迁移脚本，按 version 升序 */
export const MIGRATIONS: readonly MigrationScript[] = [migration0001];

/** 代码期望的表结构版本 */
export const EXPECTED_SCHEMA_VERSION = MIGRATIONS.reduce(
  (max, script) => (script.version > max ? script.version : max),
  0,
);

const KEY_VERSION = "schema_version";
const KEY_LOCK = "migration_lock";

/** 迁移完成后必须存在的对象（缺失即视为迁移不完整） */
const REQUIRED_TABLES = [
  "app_meta",
  "users",
  "sessions",
  "auth_throttle",
  "user_settings",
  "folders",
  "items",
  "item_bodies",
] as const;

const REQUIRED_INDEXES = [
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

export type EnsureSchemaResult =
  | { ok: true; version: number }
  | { ok: false; reason: "migrating" | "failed"; detail?: string };

/** isolate 级标记：达标后不再每请求读 app_meta */
let schemaReady = false;

/** 仅供测试：清掉 isolate 级标记，让下一次 ensureSchema 走完整流程 */
export function resetSchemaCacheForTests(): void {
  schemaReady = false;
}

/** 读 `app_meta.schema_version`；表/行缺失一律视为 0 */
async function readSchemaVersion(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .bind(KEY_VERSION)
    .first<{ value: string }>();
  const parsed = Number.parseInt(row?.value ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 用条件更新抢迁移锁：只有把过期的锁值改成 `now` 的那一次更新才算抢到。
 * 返回 true 表示本请求负责执行迁移。
 */
async function acquireLock(db: D1Database, now: number): Promise<boolean> {
  const result = await db
    .prepare("UPDATE app_meta SET value = ? WHERE key = ? AND CAST(value AS INTEGER) < ?")
    .bind(String(now), KEY_LOCK, now - MIGRATION_LOCK_TTL_MS)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

/** 释放锁：用 `now` 精确匹配，避免误放他人的锁 */
async function releaseLock(db: D1Database, now: number): Promise<void> {
  await db
    .prepare("UPDATE app_meta SET value = '0' WHERE key = ? AND CAST(value AS INTEGER) = ?")
    .bind(KEY_LOCK, now)
    .run();
}

/** 执行所有未应用的脚本（每个脚本一个 batch = 一个事务） */
async function applyMigrations(db: D1Database, currentVersion: number): Promise<void> {
  for (const script of MIGRATIONS) {
    if (script.version <= currentVersion) continue;
    if (script.statements.length === 0) continue;
    await db.batch(script.statements.map((sql) => db.prepare(sql)));
  }
}

/**
 * 校验必需的表与索引齐备；缺失则抛错（错误信息带上缺失对象名，便于日志定位）。
 * 导出仅为便于测试直接覆盖失败分支。
 */
export async function verifySchema(db: D1Database): Promise<void> {
  const rows = await db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'")
    .all<{ name: string }>();
  const present = new Set(rows.results.map((row) => row.name));
  const missing = [...REQUIRED_TABLES, ...REQUIRED_INDEXES].filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new Error(`迁移后缺少对象：${missing.join(", ")}`);
  }
}

/**
 * 确保表结构就绪。幂等、可并发调用。
 *
 * - 已达标（isolate 缓存或版本号）→ 直接放行，不读库或只读一次。
 * - 别的 isolate 正在迁移 → `reason: "migrating"`，调用方按 503 处理，客户端稍后重试。
 * - 迁移或校验失败 → `reason: "failed"`，版本不前移，锁保留到 TTL 过期。
 */
export async function ensureSchema(db: D1Database, now: number = Date.now()): Promise<EnsureSchemaResult> {
  if (schemaReady) return { ok: true, version: EXPECTED_SCHEMA_VERSION };

  try {
    // 元数据表必须先能读写：这两条自身幂等，且不参与锁
    await db.exec("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    await db.exec(
      `INSERT OR IGNORE INTO app_meta (key, value) VALUES ('${KEY_VERSION}', '0'), ('${KEY_LOCK}', '0')`,
    );

    const current = await readSchemaVersion(db);
    if (current >= EXPECTED_SCHEMA_VERSION) {
      schemaReady = true;
      return { ok: true, version: current };
    }

    if (!(await acquireLock(db, now))) {
      // 别的 isolate 正在迁移：重读一次，达标就放行，否则让调用方回 503
      const after = await readSchemaVersion(db);
      if (after >= EXPECTED_SCHEMA_VERSION) {
        schemaReady = true;
        return { ok: true, version: after };
      }
      return { ok: false, reason: "migrating" };
    }

    await applyMigrations(db, current);
    await verifySchema(db);
    await db
      .prepare("UPDATE app_meta SET value = ? WHERE key = ?")
      .bind(String(EXPECTED_SCHEMA_VERSION), KEY_VERSION)
      .run();
    await releaseLock(db, now);

    schemaReady = true;
    return { ok: true, version: EXPECTED_SCHEMA_VERSION };
  } catch (error) {
    console.error("ensureSchema failed:", error);
    return {
      ok: false,
      reason: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

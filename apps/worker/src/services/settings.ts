/**
 * 设置与隐私标记服务（架构 §2.3.2：设置归 `routes/settings.ts` + `services/settings.ts`）。
 *
 * M1 只承载实例级注册开关。存放形态【已定·用户确认 2026-09-26】：用 `app_meta` 的键
 * （需求 §18.2 的 DDL 只有这张表），**不新建 `site_settings` 表**；字段变多时在 M6 再评估。
 */
import type { PublicRegistrationState, RegistrationState } from "@menote/shared";
import {
  SQL_COUNT_USERS,
  SQL_SELECT_APP_META,
  SQL_UPSERT_APP_META,
} from "../db/tables";

const KEY_REGISTRATION_OPEN = "registration_open";
const KEY_REGISTRATION_CLOSE_AT = "registration_close_at";

async function readMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(SQL_SELECT_APP_META).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

/** 读注册开关；`close_at` 已过期即视为关闭（到期自动关闭不依赖 Cron） */
export async function getRegistrationState(db: D1Database, now: number): Promise<RegistrationState> {
  const open = (await readMeta(db, KEY_REGISTRATION_OPEN)) === "1";
  const rawCloseAt = Number.parseInt((await readMeta(db, KEY_REGISTRATION_CLOSE_AT)) ?? "0", 10);
  const closeAt = Number.isFinite(rawCloseAt) && rawCloseAt > 0 ? rawCloseAt : 0;
  return { open: open && (closeAt === 0 || closeAt > now), close_at: closeAt };
}

/** 写注册开关（两个键一个 batch，避免只写一半） */
export async function setRegistrationState(
  db: D1Database,
  state: { open: boolean; closeAt?: number },
  now: number,
): Promise<RegistrationState> {
  const closeAt = state.closeAt ?? 0;
  await db.batch([
    db.prepare(SQL_UPSERT_APP_META).bind(KEY_REGISTRATION_OPEN, state.open ? "1" : "0"),
    db.prepare(SQL_UPSERT_APP_META).bind(KEY_REGISTRATION_CLOSE_AT, String(closeAt)),
  ]);
  return getRegistrationState(db, now);
}

/**
 * 公开的注册状态（无需登录）：登录页据此决定是否显示注册入口；
 * `has_users: false` 时前端直接进注册页（拆解 M01-01）。
 */
export async function getPublicRegistrationState(
  db: D1Database,
  now: number,
): Promise<PublicRegistrationState> {
  const state = await getRegistrationState(db, now);
  const row = await db.prepare(SQL_COUNT_USERS).first<{ count: number }>();
  return { open: state.open, has_users: (row?.count ?? 0) > 0 };
}

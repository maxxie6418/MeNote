/**
 * 设置与隐私标记服务（架构 §2.3.2：设置归 `routes/settings.ts` + `services/settings.ts`）。
 *
 * M1 承载实例级注册开关。存放形态【已定·用户确认 2026-09-26】：用 `app_meta` 的键
 * （需求 §18.2 的 DDL 只有这张表），**不新建 `site_settings` 表**；字段变多时在 M6 再评估。
 *
 * M2-7 起再加**用户级设置**（`user_settings` 表，DDL 在 0001 就建好了）：整份 JSON 覆盖写、
 * **后写为准**（不是用户内容，不生成冲突副本）。读不到或 JSON 坏了都退回默认值——
 * 设置坏掉不该让整个设置页打不开。
 */
import {
  DEFAULT_USER_SETTINGS,
  UserSettingsSchema,
  type PublicRegistrationState,
  type RegistrationState,
  type UserSettings,
  type UserSettingsPayload,
  type UserSettingsWrite,
} from "@menote/shared";
import * as v from "valibot";
import {
  SQL_BUMP_SYNC_SEQ_ON_SETTINGS,
  SQL_COUNT_USERS,
  SQL_SELECT_APP_META,
  SQL_SELECT_USER_SETTINGS,
  SQL_UPSERT_APP_META,
  SQL_UPSERT_USER_SETTINGS,
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

// ——————————————————————————— 用户级设置（M2-7） ———————————————————————————

interface SettingsRow {
  json: string;
  rev: number;
  updated_at: number;
}

/**
 * 读用户设置。**没写过就返回默认值**（`rev = 0`），JSON 解析或校验失败同样退回默认值——
 * 设置是用来让应用更好用的，坏一份别把设置页整个堵死。
 */
export async function getUserSettings(
  db: D1Database,
  userId: string,
): Promise<UserSettingsPayload> {
  const row = await db
    .prepare(SQL_SELECT_USER_SETTINGS)
    .bind(userId)
    .first<SettingsRow>();

  if (!row) return { settings: DEFAULT_USER_SETTINGS, rev: 0, updated_at: 0 };

  let settings: UserSettings = DEFAULT_USER_SETTINGS;
  try {
    const parsed = v.safeParse(UserSettingsSchema, JSON.parse(row.json));
    if (parsed.success) settings = parsed.output;
  } catch {
    // 坏 JSON：用默认值（下面照常返回 rev，客户端下次写入会覆盖它）
  }

  return { settings, rev: row.rev, updated_at: row.updated_at };
}

/** 写用户设置：整份覆盖、后写为准；行上的 `sync_seq` 与用户计数器一起推进 */
export async function putUserSettings(
  db: D1Database,
  userId: string,
  input: UserSettingsWrite,
  now: number,
): Promise<UserSettingsPayload> {
  const json = JSON.stringify(input.settings);
  await db.batch([
    db.prepare(SQL_UPSERT_USER_SETTINGS).bind(userId, json, userId, now),
    db.prepare(SQL_BUMP_SYNC_SEQ_ON_SETTINGS).bind(userId),
  ]);
  return getUserSettings(db, userId);
}

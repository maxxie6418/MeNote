/**
 * 用户设置的本地读写（M2-7）。
 *
 * 单独一个文件：`repository.ts` 已经贴着 500 行的预算（架构 §2.3.1），设置这块自成一体，
 * 与搜索索引（`search.ts`）一样按职责分文件。
 *
 * 口径：**即时生效**（改一下就落盘并排队上传）；**本地有未上传改动时不接受服务端覆盖**
 * （别把用户刚改的顶掉）；服务端 `rev` 不比本地新也不覆盖（旧响应不能盖回新值）。
 */
import {
  DEFAULT_USER_SETTINGS,
  type UserSettings,
  type UserSettingsPayload,
} from "@menote/shared";
import { db } from "./database";
import { enqueue } from "./repository";

const SETTINGS_KEY = "user";

export interface LocalSettings {
  settings: UserSettings;
  rev: number;
  /** 本地有未上传的改动（同步拉取时据此跳过覆盖） */
  pending: boolean;
}

/** 读本地设置；还没有就返回默认值（`rev = 0`） */
export async function getLocalSettings(): Promise<LocalSettings> {
  const row = await db.settings.get(SETTINGS_KEY);
  if (!row) return { settings: DEFAULT_USER_SETTINGS, rev: 0, pending: false };
  return { settings: row.json, rev: row.rev, pending: row.pending !== null };
}

/**
 * 本地保存设置并入队上传（`put_settings`）。
 *
 * 同一份设置只保留一行出队记录——连点几次开关不该排出一串请求（与元数据补丁同一合并规则）。
 */
export async function saveLocalSettings(settings: UserSettings, now: number): Promise<void> {
  await db.transaction("rw", db.settings, db.outbox, async () => {
    const existing = await db.settings.get(SETTINGS_KEY);
    await db.settings.put({
      key: SETTINGS_KEY,
      json: settings,
      rev: existing?.rev ?? 0,
      updated_at: now,
      pending: "put_settings",
    });

    const rows = await db
      .outbox
      .where("[entity+entity_id]")
      .equals(["setting", SETTINGS_KEY])
      .toArray();
    if (!rows.some((row) => row.op === "put_settings")) {
      await enqueue({
        entity: "setting",
        entity_id: SETTINGS_KEY,
        op: "put_settings",
        base_rev: 0,
        base_meta_rev: 0,
        now,
      });
    }
  });
}

/**
 * 落库服务端带下来的设置（同步拉取时调用）。
 *
 * 返回是否真的应用了：调用方（与测试）据此判断"本地改动是否保住了"。
 */
export async function applySyncSettings(payload: UserSettingsPayload): Promise<boolean> {
  const existing = await db.settings.get(SETTINGS_KEY);
  if (existing?.pending) return false;
  if (existing && existing.rev >= payload.rev) return false;

  await db.settings.put({
    key: SETTINGS_KEY,
    json: payload.settings,
    rev: payload.rev,
    updated_at: payload.updated_at,
    pending: null,
  });
  return true;
}

/** 上传成功后把服务端返回的 `rev` 记回本地并清掉待上传标记 */
export async function markSettingsSynced(rev: number, updatedAt: number): Promise<void> {
  const existing = await db.settings.get(SETTINGS_KEY);
  await db.settings.put({
    key: SETTINGS_KEY,
    json: existing?.json ?? DEFAULT_USER_SETTINGS,
    rev,
    updated_at: updatedAt,
    pending: null,
  });
}

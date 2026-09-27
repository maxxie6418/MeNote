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
  DEFAULT_PRIVACY_SETTINGS,
  DEFAULT_USER_SETTINGS,
  type PrivacySettings,
  type UserSettings,
  type UserSettingsPayload,
} from "@menote/shared";
import { db } from "./database";
import { enqueue } from "./repository";

const SETTINGS_KEY = "user";

/**
 * 把**旧行补齐**到当前契约。
 *
 * 设置是"整份覆盖"的：行里的 JSON 由**写入时的那个客户端**决定长什么样。早期版本写下的行缺后来
 * 新增的字段（M3 之前的行没有 `privacy`），而这段补默认值是《隐私锁设计》§7.1 对旧数据的口径
 * （"旧数据缺字段时按默认值补齐"）——服务端 `services/settings.ts` 一直这么做，**客户端这条路径
 * 原先漏了**：直接把行里的 JSON 交给上层，于是旧行把 `undefined` 当成了配置。
 *
 * 为什么必须在这里补（真实故障，2026-09-27 线上整站白屏）：`privacy` 为 `undefined` →
 * `usePrivacyLock` 读 `config.tier` 抛 TypeError → React 卸载整棵树 → **只剩 CSS 底色、没有内容**。
 * 而这条旧行只在"用户改设置"或"服务端 rev 更高被覆盖"时才重写，两者都不会发生（改设置要先有界面），
 * 所以会一直崩下去，刷新与重装浏览器都救不回来。
 *
 * 只补不校验：值非法（例如 `editor_mode` 是未知档位）是另一类问题，留给使用方判断，
 * 不在这里静默改写用户的选择。
 */
function withSettingsDefaults(raw: unknown): UserSettings {
  const row = (raw ?? {}) as Partial<UserSettings>;
  const privacy = (row.privacy ?? {}) as Partial<PrivacySettings>;
  return {
    ...DEFAULT_USER_SETTINGS,
    ...row,
    // 嵌套对象要单独合：`privacy` 存在但缺字段（如只写了 tier）时顶层的展开补不上
    privacy: {
      ...DEFAULT_PRIVACY_SETTINGS,
      ...privacy,
      scope: { ...DEFAULT_PRIVACY_SETTINGS.scope, ...privacy.scope },
    },
  };
}

export interface LocalSettings {
  settings: UserSettings;
  rev: number;
  /** 本地有未上传的改动（同步拉取时据此跳过覆盖） */
  pending: boolean;
}

/** 读本地设置；还没有就返回默认值（`rev = 0`）。**行里的旧 JSON 一律先补齐默认值** */
export async function getLocalSettings(): Promise<LocalSettings> {
  const row = await db.settings.get(SETTINGS_KEY);
  if (!row) return { settings: DEFAULT_USER_SETTINGS, rev: 0, pending: false };
  return { settings: withSettingsDefaults(row.json), rev: row.rev, pending: row.pending !== null };
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
    json: withSettingsDefaults(payload.settings),
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
    // 顺手把旧行写回成补齐过的形状：读路径已经不依赖它，但别让缺字段的行一直留在库里
    json: withSettingsDefaults(existing?.json ?? DEFAULT_USER_SETTINGS),
    rev,
    updated_at: updatedAt,
    pending: null,
  });
}

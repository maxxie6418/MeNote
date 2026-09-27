/**
 * 隐私锁的**运行时状态机**（M3；《隐私锁设计》§4/§5）。
 *
 * 纯函数：不碰网络、不碰 Dexie、不碰 localStorage——那三件事在 `usePrivacyLock`（组装层）里做。
 * 这里只回答"现在是什么状态、解锁后怎么变、什么时候该锁"。
 *
 * 两条正交的门禁（设计 §2.2）：
 * - **范围门禁**：`lockState` 决定隐私范围（加密空间 + 范围内的 Memo）此刻给不给看；
 * - **单篇门禁**：`unlockedItems` 记住"本次浏览器会话里已逐篇解密的条目"，
 *   与 `lockState` **互不影响**：解锁隐私锁不会解开单篇，锁定隐私锁默认会一起清（"锁全部"）。
 */
import {
  privacyGateFrom,
  type PrivacyGate,
  type PrivacyLockState,
  type PrivacyScope,
} from "@menote/shared";

/** 三档（「仅本次查看」已于 2026-09-27 作废） */
export type PrivacyTier = "session" | "minutes" | "device";

export const PRIVACY_TIERS: readonly PrivacyTier[] = ["minutes", "session", "device"];

export const TIER_LABELS: Readonly<Record<PrivacyTier, string>> = {
  minutes: "N 分钟",
  session: "本次会话",
  device: "当前设备长期",
};

/** `localStorage` 里记"本设备长期解锁"的键（设备级标记，不进同步） */
export const DEVICE_UNLOCK_KEY = "menote:privacy:device-unlocked";

export interface PrivacyRuntime {
  lockState: PrivacyLockState;
  tier: PrivacyTier;
  /** `minutes` 档的到期时刻（ms）；另外两档为 null */
  expiresAt: number | null;
  /** 本次浏览器会话里已逐篇解密的条目 */
  unlockedItems: ReadonlySet<string>;
}

/** 未启用 = 无门禁；已启用 = 一律从"已锁定"开始（刷新页面不会自动解锁） */
export function initialRuntime(enabled: boolean, tier: PrivacyTier = "minutes"): PrivacyRuntime {
  return {
    lockState: enabled ? "locked" : "disabled",
    tier,
    expiresAt: null,
    unlockedItems: new Set<string>(),
  };
}

/** 按档位算到期时刻：只有 `minutes` 档有 */
export function expiryFor(tier: PrivacyTier, now: number, minutes: number): number | null {
  return tier === "minutes" ? now + minutes * 60_000 : null;
}

/** 解锁范围门禁（不动单篇集合） */
export function unlock(
  runtime: PrivacyRuntime,
  tier: PrivacyTier,
  now: number,
  minutes: number,
): PrivacyRuntime {
  if (runtime.lockState === "disabled") return runtime;
  return { ...runtime, lockState: "unlocked", tier, expiresAt: expiryFor(tier, now, minutes) };
}

/** 换档位（已解锁时改档：从"现在"重新计时） */
export function changeTier(
  runtime: PrivacyRuntime,
  tier: PrivacyTier,
  now: number,
  minutes: number,
): PrivacyRuntime {
  if (runtime.lockState !== "unlocked") return { ...runtime, tier };
  return { ...runtime, tier, expiresAt: expiryFor(tier, now, minutes) };
}

/** 锁全部：范围门禁 + 单篇已解密集合一起清（顶栏「立即锁定」的默认语义） */
export function lockAll(runtime: PrivacyRuntime): PrivacyRuntime {
  if (runtime.lockState === "disabled") return runtime;
  return { ...runtime, lockState: "locked", expiresAt: null, unlockedItems: new Set<string>() };
}

/** 只锁范围门禁，单篇保持已解密（档位到期走这条） */
export function lockScope(runtime: PrivacyRuntime): PrivacyRuntime {
  if (runtime.lockState === "disabled") return runtime;
  return { ...runtime, lockState: "locked", expiresAt: null };
}

/** 逐篇解密：把这一篇记进"本次会话已解密" */
export function unlockItem(runtime: PrivacyRuntime, itemId: string): PrivacyRuntime {
  const next = new Set(runtime.unlockedItems);
  next.add(itemId);
  return { ...runtime, unlockedItems: next };
}

/** 锁上某篇 */
export function lockItem(runtime: PrivacyRuntime, itemId: string): PrivacyRuntime {
  if (!runtime.unlockedItems.has(itemId)) return runtime;
  const next = new Set(runtime.unlockedItems);
  next.delete(itemId);
  return { ...runtime, unlockedItems: next };
}

/** 锁上全部单篇（不动范围门禁） */
export function lockAllItems(runtime: PrivacyRuntime): PrivacyRuntime {
  if (runtime.unlockedItems.size === 0) return runtime;
  return { ...runtime, unlockedItems: new Set<string>() };
}

/** `minutes` 档是否已到期 */
export function isExpired(runtime: PrivacyRuntime, now: number): boolean {
  return runtime.expiresAt !== null && now >= runtime.expiresAt;
}

/**
 * 计时器每跳一次调用：到期就锁**范围门禁**（保留单篇已解密集合——那是独立的另一道门）。
 * 返回同一个对象表示没变化，调用方据此决定要不要重渲染。
 */
export function tick(runtime: PrivacyRuntime, now: number): PrivacyRuntime {
  if (!isExpired(runtime, now)) return runtime;
  return lockScope(runtime);
}

/** 剩多少毫秒（`minutes` 档，用于胶囊倒计时）；其它状态为 null */
export function remainingMs(runtime: PrivacyRuntime, now: number): number | null {
  if (runtime.lockState !== "unlocked" || runtime.expiresAt === null) return null;
  return Math.max(0, runtime.expiresAt - now);
}

/** 组装判定用的 gate（唯一入口；不要在别处自己拼对象） */
export function gateFrom(
  runtime: PrivacyRuntime,
  config: { scope: PrivacyScope; search_bodies_when_unlocked: boolean },
): PrivacyGate {
  return privacyGateFrom(config, runtime.lockState, runtime.unlockedItems);
}

/** 设备长期档是否需要"持久标记"（组装层据此写 / 清 localStorage） */
export function needsDeviceFlag(runtime: PrivacyRuntime): boolean {
  return runtime.tier === "device" && runtime.lockState === "unlocked";
}

/**
 * 输错隐私密码后的**本地等待秒数**：1、2、4、8、16、30 封顶。
 *
 * 服务端不参与密码校验，所以这只是界面层面的减速（《隐私锁设计》§4.5）——
 * 它挡不住有决心的攻击者，但能挡住"边上有人乱试"。
 */
export function unlockBackoffSeconds(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(30, 2 ** (failures - 1));
}

/** 倒计时文案：`4:32`；不足一分钟也给 `0:07` 这种形式（与原型一致） */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

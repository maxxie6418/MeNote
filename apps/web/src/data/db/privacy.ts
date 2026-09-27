/**
 * 隐私锁门禁材料的本地缓存（M3；《隐私锁设计》§10）。
 *
 * 服务端 `user_crypto` 是**唯一权威**；本地这份只有一个用途：**离线解锁**
 * （有缓存时校验完全在浏览器里做，不需要联网）。它**不是**解锁状态——
 * 解锁态是内存里的会话状态，换设备、关标签页就没了。
 *
 * `rev` 的用法：每次登录/启动拉一次服务端材料，若服务端 `rev` **高于**本地，
 * 说明密码在别处改过（或重置过），此时覆盖缓存并让调用方**清空解锁态与已解密集合**。
 */
import type { CryptoMaterials, CryptoState } from "@menote/shared";
import { db } from "./database";
import type { PrivacyStateRow } from "./schema";

const KEY = "user" as const;

export async function readCachedCrypto(): Promise<PrivacyStateRow | undefined> {
  return db.privacyState.get(KEY);
}

export interface CacheCryptoResult {
  /** 缓存被更新（首次写入、或服务端 rev 更高） */
  changed: boolean;
  /** 服务端 rev 高于本地 → 调用方必须清空解锁态与已解密集合 */
  invalidatesUnlock: boolean;
}

/** 把服务端状态写进缓存；`rev` 相同时不动（避免每次启动都写库） */
export async function cacheCryptoState(
  state: CryptoState,
  now = Date.now(),
): Promise<CacheCryptoResult> {
  const current = await db.privacyState.get(KEY);
  if (current && current.enabled === state.enabled && current.rev >= state.rev) {
    return { changed: false, invalidatesUnlock: false };
  }

  const row: PrivacyStateRow = {
    key: KEY,
    enabled: state.enabled,
    materials: state.materials,
    rev: state.rev,
    updated_at: state.updated_at,
    cached_at: now,
  };
  await db.privacyState.put(row);

  return {
    changed: true,
    invalidatesUnlock: current !== undefined && state.rev > current.rev,
  };
}

/** 登出 / 清除本机数据时用（Q22 的处置见《隐私锁设计》§10.4） */
export async function clearCachedCrypto(): Promise<void> {
  await db.privacyState.delete(KEY);
}

/** 缓存里的材料（没有则 undefined） */
export async function cachedMaterials(): Promise<CryptoMaterials | null> {
  const row = await readCachedCrypto();
  return row?.materials ?? null;
}

/** 缓存里记着"已启用隐私锁"吗（离线时用它决定要不要走门禁） */
export async function isPrivacyEnabledLocally(): Promise<boolean> {
  return (await readCachedCrypto())?.enabled ?? false;
}

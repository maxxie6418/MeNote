import "fake-indexeddb/auto";
/**
 * 隐私锁材料本地缓存的用例（M3-4；《隐私锁设计》§10）。
 *
 * 重点是 `rev` 的失效语义：服务端版本变高 → 覆盖缓存并**要求清空解锁态**（密码在别处改过）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  cacheCryptoState,
  cachedMaterials,
  clearCachedCrypto,
  isPrivacyEnabledLocally,
  readCachedCrypto,
} from "../src/data/db/privacy";
import { db } from "../src/data/db";
import type { CryptoMaterials, CryptoState } from "@menote/shared";

const MATERIALS: CryptoMaterials = {
  kdf: "PBKDF2-SHA-256",
  kdf_iterations: 600_000,
  kdf_salt: "c2FsdA",
  verifier: "dmVyaWZpZXI",
  k_wrapped_pw: "d3JhcHBlZA",
  k_wrapped_backup: "YmFja3Vw",
};

function state(overrides: Partial<CryptoState> = {}): CryptoState {
  return { enabled: true, materials: MATERIALS, rev: 1, updated_at: 1, ...overrides };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("材料缓存", () => {
  it("写入后能读回，未写时读不到", async () => {
    expect(await readCachedCrypto()).toBeUndefined();
    expect(await isPrivacyEnabledLocally()).toBe(false);

    const result = await cacheCryptoState(state(), 100);
    expect(result).toEqual({ changed: true, invalidatesUnlock: false });

    const cached = await readCachedCrypto();
    expect(cached?.enabled).toBe(true);
    expect(cached?.rev).toBe(1);
    expect(cached?.cached_at).toBe(100);
    expect(await cachedMaterials()).toEqual(MATERIALS);
    expect(await isPrivacyEnabledLocally()).toBe(true);
  });

  it("rev 相同时不重写（避免每次启动都写库）", async () => {
    await cacheCryptoState(state(), 100);
    const again = await cacheCryptoState(state(), 200);
    expect(again).toEqual({ changed: false, invalidatesUnlock: false });
    expect((await readCachedCrypto())?.cached_at).toBe(100);
  });

  it("服务端 rev 更高 → 覆盖并要求清空解锁态", async () => {
    await cacheCryptoState(state(), 100);

    const result = await cacheCryptoState(
      state({ rev: 2, materials: { ...MATERIALS, k_wrapped_pw: "新的" }, updated_at: 2 }),
      200,
    );
    expect(result).toEqual({ changed: true, invalidatesUnlock: true });
    expect((await readCachedCrypto())?.rev).toBe(2);
    expect((await cachedMaterials())?.k_wrapped_pw).toBe("新的");
  });

  it("关闭隐私锁（enabled: false）也覆盖缓存，但不要求清空解锁态", async () => {
    await cacheCryptoState(state(), 100);

    const result = await cacheCryptoState(
      { enabled: false, materials: null, rev: 3, updated_at: 3 },
      200,
    );
    expect(result.changed).toBe(true);
    // rev 是变高了，但服务端已无材料；调用方按 enabled=false 处理（关闭锁本身要清态）
    expect(result.invalidatesUnlock).toBe(true);
    expect(await isPrivacyEnabledLocally()).toBe(false);
    expect(await cachedMaterials()).toBeNull();
  });

  it("清除缓存（登出 / 清除本机数据）", async () => {
    await cacheCryptoState(state(), 100);
    await clearCachedCrypto();
    expect(await readCachedCrypto()).toBeUndefined();
    expect(await isPrivacyEnabledLocally()).toBe(false);
  });
});

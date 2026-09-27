// @vitest-environment node
/**
 * 隐私锁浏览器端原语的用例（M3-4）：派生、verifier 校验、K 的包裹与解包。
 *
 * 这些是**真正在跑 WebCrypto** 的用例（node 环境自带 `crypto.subtle`），
 * 所以能验到"错密码解不开""换了盐就不同"这类真实性质，而不是打桩。
 * PBKDF2 用 600k 太慢，这里统一用 1,000 次（参数是从材料里读的，与生产同一套代码路径）。
 */
import { describe, expect, it } from "vitest";
import {
  deriveKek,
  makeVerifier,
  randomContentKey,
  randomSalt,
  unwrapContentKey,
  verifyPassword,
  wrapContentKey,
} from "../src/features/privacy/crypto";
import { CRYPTO_KEY_BYTES, CRYPTO_SALT_BYTES } from "@menote/shared";

const ITERATIONS = 1_000;

async function kekOf(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return deriveKek(password, salt, ITERATIONS);
}

describe("随机量", () => {
  it("盐与内容密钥都是规定长度，且两次不同", () => {
    const saltA = randomSalt();
    const saltB = randomSalt();
    expect(saltA.length).toBe(CRYPTO_SALT_BYTES);
    expect(randomContentKey().length).toBe(CRYPTO_KEY_BYTES);
    expect([...saltA]).not.toEqual([...saltB]);
  });
});

describe("verifier：本地校验隐私密码", () => {
  it("正确密码通过，错误密码不通过", async () => {
    const salt = randomSalt();
    const verifier = await makeVerifier(await kekOf("正确的密码", salt));

    expect(await verifyPassword(await kekOf("正确的密码", salt), verifier)).toBe(true);
    expect(await verifyPassword(await kekOf("错误的密码", salt), verifier)).toBe(false);
  });

  it("盐不同则同一个密码也解不开（盐是材料的一部分）", async () => {
    const verifier = await makeVerifier(await kekOf("同一个密码", randomSalt()));
    expect(await verifyPassword(await kekOf("同一个密码", randomSalt()), verifier)).toBe(false);
  });

  it("verifier 被改坏时返回 false，不抛错（界面只需知道「不对」）", async () => {
    const kek = await kekOf("密码", randomSalt());
    expect(await verifyPassword(kek, "这不是合法的密文块")).toBe(false);
    expect(await verifyPassword(kek, "")).toBe(false);
  });
});

describe("内容密钥 K 的包裹与解包", () => {
  it("往返一致", async () => {
    const kek = await kekOf("密码", randomSalt());
    const key = randomContentKey();

    const wrapped = await wrapContentKey(key, kek);
    expect([...(await unwrapContentKey(wrapped, kek))]).toEqual([...key]);
  });

  it("换一把 KEK 解不开（改密后旧包裹作废）", async () => {
    const salt = randomSalt();
    const wrapped = await wrapContentKey(randomContentKey(), await kekOf("旧密码", salt));
    await expect(unwrapContentKey(wrapped, await kekOf("新密码", salt))).rejects.toThrow();
  });

  it("长度不对的包裹被拒绝（不把坏数据当钥匙用）", async () => {
    const kek = await kekOf("密码", randomSalt());
    const shortKey = new Uint8Array(16).fill(1);
    const wrappedShort = await wrapContentKey(shortKey, kek);
    await expect(unwrapContentKey(wrappedShort, kek)).rejects.toThrow(/长度/);
  });

  it("每次包裹的 IV 都不同（同一把 K 两次包裹结果不同）", async () => {
    const kek = await kekOf("密码", randomSalt());
    const key = randomContentKey();
    expect(await wrapContentKey(key, kek)).not.toBe(await wrapContentKey(key, kek));
  });
});

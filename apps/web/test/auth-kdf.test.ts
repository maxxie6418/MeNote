import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveLoginKey } from "../src/features/auth/kdf";

const SALT = "AAAAAAAAAAAAAAAAAAAAAA";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("登录密钥派生", () => {
  it("正常环境下派生 base64url 密钥（600k 迭代）", async () => {
    const key = await deriveLoginKey("Passw0rd!demo", SALT);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(key.length).toBeGreaterThanOrEqual(42);
  });

  it("无 WebCrypto 时给出可行动的诊断，而不是 TypeError", async () => {
    const original = globalThis.crypto;
    // 模拟浏览器不提供加密能力：crypto 存在但没有 subtle
    vi.stubGlobal("crypto", {
      getRandomValues: original.getRandomValues.bind(original),
    });

    await expect(deriveLoginKey("Passw0rd!demo", SALT)).rejects.toThrow(/WebCrypto|https/);
    // 文案必须带上观测到的事实（地址/协议/安全上下文/WebCrypto），便于原样反馈
    await expect(deriveLoginKey("Passw0rd!demo", SALT)).rejects.toThrow(/WebCrypto 缺失/);
  });
});

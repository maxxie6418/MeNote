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

  it("非安全上下文（http 页面无 crypto.subtle）下给出可行动的错误，而不是 TypeError", async () => {
    const original = globalThis.crypto;
    // 模拟 http 页面：crypto 存在但没有 subtle
    vi.stubGlobal("crypto", {
      getRandomValues: original.getRandomValues.bind(original),
    });

    await expect(deriveLoginKey("Passw0rd!demo", SALT)).rejects.toThrow(/https/);
  });
});

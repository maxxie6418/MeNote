import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/hash";

describe("sha256Hex", () => {
  it("FIPS 180-4 标准向量", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("UTF-8 输入与字节输入结果一致", async () => {
    const text = "笔记 emoji 📝";
    expect(await sha256Hex(text)).toBe(await sha256Hex(new TextEncoder().encode(text)));
  });

  it("输出为 64 位小写十六进制，不同输入不同结果", async () => {
    const first = await sha256Hex("v1");
    const second = await sha256Hex("v2");
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });
});

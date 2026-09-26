import { describe, expect, it } from "vitest";
import {
  base64UrlDecode,
  base64UrlDecodeUtf8,
  base64UrlEncode,
  base64UrlEncodeUtf8,
} from "../src/base64url";

describe("base64url（无填充）", () => {
  it("RFC 4648 向量", () => {
    expect(base64UrlEncodeUtf8("")).toBe("");
    expect(base64UrlEncodeUtf8("f")).toBe("Zg");
    expect(base64UrlEncodeUtf8("fo")).toBe("Zm8");
    expect(base64UrlEncodeUtf8("foo")).toBe("Zm9v");
    expect(base64UrlEncodeUtf8("foob")).toBe("Zm9vYg");
    expect(base64UrlEncodeUtf8("fooba")).toBe("Zm9vYmE");
    expect(base64UrlEncodeUtf8("foobar")).toBe("Zm9vYmFy");
  });

  it("使用 - 与 _ 而不是 + 与 /", () => {
    // 0xfb 0xff → 标准 base64 为 "+/8="，base64url 为 "-_8"
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
  });

  it("任意长度字节往返一致（含 0 长度与不足一组的尾部）", () => {
    for (let length = 0; length <= 12; length += 1) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = (i * 37 + length) % 256;
      expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
    }
  });

  it("UTF-8 文本往返一致（中文与 emoji）", () => {
    for (const text of ["笔记", "Menote 备忘录", "📝 待办 ✅", "a\u0000b"]) {
      expect(base64UrlDecodeUtf8(base64UrlEncodeUtf8(text))).toBe(text);
    }
  });

  it("容忍尾部填充符", () => {
    expect(base64UrlDecode("Zm9vYg==")).toEqual(base64UrlDecode("Zm9vYg"));
  });

  it("非法字符抛错，不静默丢弃", () => {
    expect(() => base64UrlDecode("Zm9v+")).toThrow(/非法字符/);
    expect(() => base64UrlDecode("Zm9v/")).toThrow(/非法字符/);
    expect(() => base64UrlDecode("Zm 9v")).toThrow(/非法字符/);
  });
});

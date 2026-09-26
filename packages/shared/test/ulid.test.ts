import { describe, expect, it } from "vitest";
import { isUlid, newUlid, ulidTime } from "../src/ulid";

describe("ULID", () => {
  it("长度 26 且只用 Crockford base32 字母表", () => {
    const id = newUlid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("时间部分可解回（毫秒级）", () => {
    const now = 1_700_000_000_000;
    expect(ulidTime(newUlid(now))).toBe(now);
    expect(ulidTime(newUlid(0))).toBe(0);
  });

  it("同一毫秒内不重复（80 位随机）", () => {
    const now = 1_700_000_000_000;
    const ids = new Set(Array.from({ length: 500 }, () => newUlid(now)));
    expect(ids.size).toBe(500);
  });

  it("时间递增时字典序递增（可用作主键排序）", () => {
    const early = newUlid(1_700_000_000_000);
    const later = newUlid(1_700_000_001_000);
    expect(early < later).toBe(true);
  });

  it("拒绝错误长度与易混字符", () => {
    expect(isUlid("")).toBe(false);
    expect(isUlid(newUlid().slice(0, 25))).toBe(false);
    expect(isUlid(`${newUlid().slice(0, 25)}I`)).toBe(false);
    expect(isUlid(`${newUlid().slice(0, 25)}u`)).toBe(false);
    expect(ulidTime("not-a-ulid")).toBeNull();
  });
});

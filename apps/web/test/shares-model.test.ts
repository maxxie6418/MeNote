/**
 * 分享模型（M5-S2）的纯函数用例：过期档位换算、链接拼装（子域优先 / 退回当前 origin）、
 * 密码派生的形状（明文不出浏览器，服务端只收盐 + 校验值）。
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildShareLink,
  deriveSharePasswordMaterial,
  expiryTimestamp,
} from "../src/features/shares/model";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_791_000_000_000;

describe("过期档位", () => {
  it("never 是 null；1/7/30 天按毫秒累加", () => {
    expect(expiryTimestamp("never", NOW)).toBeNull();
    expect(expiryTimestamp("1d", NOW)).toBe(NOW + DAY);
    expect(expiryTimestamp("7d", NOW)).toBe(NOW + 7 * DAY);
    expect(expiryTimestamp("30d", NOW)).toBe(NOW + 30 * DAY);
  });

  it("自定义日期取当天结束（本地时区）；没给日期返回 null（由调用方拦截）", () => {
    const end = expiryTimestamp("custom", NOW, "2026-10-08");
    expect(end).toBeGreaterThan(new Date("2026-10-08T00:00:00").getTime());
    expect(end).toBeLessThanOrEqual(new Date("2026-10-08T23:59:59.999").getTime());
    expect(expiryTimestamp("custom", NOW, undefined)).toBeNull();
  });
});

describe("链接拼装", () => {
  it("子域优先；未配置退回当前站点 origin；尾部斜杠不叠加", () => {
    expect(buildShareLink("abc", "https://share.example.com")).toBe("https://share.example.com/s/abc");
    expect(buildShareLink("abc", "https://share.example.com/")).toBe("https://share.example.com/s/abc");
    expect(buildShareLink("abc", null)).toBe(`${window.location.origin}/s/abc`);
  });
});

describe("密码派生", () => {
  it("材料形状完整且可复算：同密码同盐派生同校验值", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const a = await deriveSharePasswordMaterial("分享密码");
    const b = await deriveSharePasswordMaterial("分享密码");
    expect(a.kdf.alg).toBe("PBKDF2-SHA256");
    expect(a.kdf.iterations).toBeGreaterThan(0);
    expect(a.salt).not.toBe(b.salt); // 每次新盐
    expect(a.verifier).not.toBe(b.verifier); // 盐不同，校验值不同
    void salt;
  });
});

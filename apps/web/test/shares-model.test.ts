/**
 * 分享模型（M5-S2）的纯函数用例：过期档位换算、链接拼装（子域优先 / 退回当前 origin）、
 * 密码派生的形状（明文不出浏览器，服务端只收盐 + 校验值）与**创建者↔访客的派生往返**。
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildShareLink,
  deriveSharePasswordMaterial,
  deriveShareVerifierWithStoredParams,
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
    const a = await deriveSharePasswordMaterial("分享密码");
    const b = await deriveSharePasswordMaterial("分享密码");
    expect(a.kdf.alg).toBe("PBKDF2-SHA256");
    expect(a.kdf.iterations).toBeGreaterThan(0);
    expect(a.salt).not.toBe(b.salt); // 每次新盐
    expect(a.verifier).not.toBe(b.verifier); // 盐不同，校验值不同
  });
});

/**
 * 访客侧派生的**端到端往返**（2026-10-03 收口点验查出来的真 bug 的回归护栏）。
 *
 * 旧实现里访客调的是 `deriveSharePasswordMaterial`——它**每次生成一枚新盐**，
 * 于是访客派生的校验值与服务端存的那枚永远对不上，**带密码的分享链接 100% 打不开**。
 * 这类 bug 自动化没抓到，是因为 worker 用例直接注入 verifier、查看器用例 mock 了
 * unlock 响应，**没有任何一条用例真跑过两端的派生往返**。下面三条把它钉死。
 */
describe("访客侧派生（用状态接口给的盐）", () => {
  it("用创建者那枚盐与迭代数，能复算出完全相同的校验值", async () => {
    const created = await deriveSharePasswordMaterial("分享密码");
    const visitor = await deriveShareVerifierWithStoredParams(
      "分享密码",
      created.salt,
      created.kdf.iterations,
    );
    expect(visitor).toBe(created.verifier);
  });

  it("换一枚盐就对不上——这正是访客不能自己生成新盐的原因", async () => {
    const a = await deriveSharePasswordMaterial("分享密码");
    const b = await deriveSharePasswordMaterial("分享密码");
    const fromB = await deriveShareVerifierWithStoredParams("分享密码", b.salt, b.kdf.iterations);
    expect(fromB).toBe(b.verifier);
    expect(fromB).not.toBe(a.verifier);
  });

  it("盐对但密码不同，校验值也不同（服务端据此判「密码不对」）", async () => {
    const created = await deriveSharePasswordMaterial("分享密码");
    const wrong = await deriveShareVerifierWithStoredParams(
      "另一个密码",
      created.salt,
      created.kdf.iterations,
    );
    expect(wrong).not.toBe(created.verifier);
  });
});

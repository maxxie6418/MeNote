/**
 * 路由往返（2026-09-27 修复的回归）。
 *
 * 背景：`SETTINGS_PAGES` 这份设置分类清单曾漏掉 `editor` / `privacy` / `versions`，
 * `parseRoute` 遇到 `#/settings/privacy` 匹配不到就静默回落到 `general`——
 * **点「隐私锁」显示「通用」**，M3-9 的隐私锁设置页从界面上根本进不去，而且不报错、不白屏，
 * 只有手动对列表才发现。这里钉住"每个分类都能从自己的 URL 解析回自身"。
 */
import { describe, expect, it } from "vitest";
import { SETTINGS_PAGES, parseRoute, routeToHash } from "../src/app/router";

describe("设置分类的路由往返", () => {
  it("清单里的每个分类都能从自己的 hash 解析回自身", () => {
    for (const page of SETTINGS_PAGES) {
      const hash = routeToHash({ name: "settings", page });
      expect(parseRoute(hash), `${page} -> ${hash}`).toEqual({ name: "settings", page });
    }
  });

  it("清单覆盖全部设置分类（漏一个就会落到「通用」）", () => {
    // 期望值独立写在这里：往 SettingsPageId 里加分类时，必须同时进 SETTINGS_PAGES
    // 「编辑试验」2026-10-01 暂时收起（用户 2026-10-01）：试验区按桌面稿排布，
    // 窄面板里会挤成一条，改为直接在正式编辑器上迭代。恢复时把它加回下面这一行即可。
    expect([...SETTINGS_PAGES].sort()).toEqual(
      ["general", "account", "editor", "privacy", "versions", "instance", "about"].sort(),
    );
  });

  it("未知分类仍回落到「通用」，不抛错", () => {
    expect(parseRoute("#/settings/nope")).toEqual({ name: "settings", page: "general" });
  });

  it("顶层目的地不被设置分类的改动影响", () => {
    expect(parseRoute("#/login")).toEqual({ name: "login" });
    expect(parseRoute("#/register")).toEqual({ name: "register" });
    expect(parseRoute("#/notes")).toEqual({ name: "notes" });
    expect(parseRoute("")).toEqual({ name: "notes" });
  });

  it("回收站是独立页（M4-12）：有自己的路由与 hash", () => {
    expect(parseRoute("#/trash")).toEqual({ name: "trash" });
    expect(routeToHash({ name: "trash" })).toBe("#/trash");
  });
});

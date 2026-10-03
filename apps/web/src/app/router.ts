/**
 * 极简 hash 路由（架构 §2.3.1：`main.tsx` 装配路由表；不引入路由库，M1 只有四个目的地）。
 *
 * 目的地：`#/login`、`#/register`、`#/notes`（默认）、`#/settings/<page>`。
 */
import { useEffect, useState } from "react";

/**
 * 设置分类清单——**唯一一份真源**：URL 解析的白名单、设置页的导航顺序、分类 id 的类型都出自它。
 *
 * 踩过的坑（2026-09-27 修复）：原先 `SettingsPageId`（联合类型）与这份白名单是**两份手维护的清单**，
 * M2 加「编辑器」、M3 加「隐私锁」与「版本与回收站」时只动了联合类型与设置页的 `PAGE_META`，
 * 忘了动白名单——于是 `#/settings/privacy` 匹配不到，`parseRoute` **静默**回落到 `general`：
 * 点「隐私锁」显示「通用」，M3-9 的设置页在界面上根本进不去，而且不报错、不白屏。
 *
 * 现在类型由清单推导（`as const` + `typeof [number]`），所以**新增分类只可能在一个地方发生**，
 * 漏改的另一半会直接编译不过（设置页的 `PAGE_META: Record<SettingsPageId, …>` 就是那另一半的守卫）。
 *
 * **顺序照功能拆解 M18-01 的 11 类定稿**（components.md §7.5 同一份）：
 * 通用 / 账户与安全 / 编辑器 / 隐私锁 / 版本与回收站 / 备份 / 分享 / MCP / 数据管理 / 实例管理 / 关于。
 * 「MCP」那一类还没做，**不进导航**（不占位：点进去是空页面比没有更糟）；
 * 「数据管理」M6 批 2c 起有内容（附件管理页），无条件显示——分类是固定的一级入口，空态由内容页自己处理。
 */
export const SETTINGS_PAGES = [
  "general",
  "account",
  "editor",
  // 「编辑试验」2026-10-01 暂时收起（用户 2026-10-01）：试验区按桌面稿排布，
  // 在窄面板里会挤成一条，且本轮改为直接在正式编辑器上迭代。**试验代码全部保留**，
  // 恢复只需把这一行放回来 + 恢复 `SettingsPanel` 里的两处（PAGE_META 与渲染分支）。
  // "editor-lab",
  "privacy",
  "versions",
  "backup",
  "shares",
  "data",
  "instance",
  "about",
] as const;

/** 设置分类 id：**从清单推导**，不再手写第二份 */
export type SettingsPageId = (typeof SETTINGS_PAGES)[number];

export type Route =
  | { name: "login" }
  | { name: "register" }
  | { name: "notes" }
  | { name: "trash" }
  | { name: "settings"; page: SettingsPageId };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").replace(/\/$/, "");

  if (path === "login") return { name: "login" };
  if (path === "register") return { name: "register" };
  // 回收站是**独立页**（功能拆解 Q2：不进功能栏），所以有自己的一档路由
  if (path === "trash") return { name: "trash" };

  if (path.startsWith("settings")) {
    const page = path.split("/")[1] ?? "";
    const matched = SETTINGS_PAGES.find((candidate) => candidate === page);
    return { name: "settings", page: matched ?? "general" };
  }

  return { name: "notes" };
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case "login":
      return "#/login";
    case "register":
      return "#/register";
    case "trash":
      return "#/trash";
    case "settings":
      return `#/settings/${route.page}`;
    default:
      return "#/notes";
  }
}

/** 订阅 `hashchange`；`navigate` 只改 hash，由订阅统一触发重渲染 */
export function useRoute(): { route: Route; navigate: (route: Route) => void } {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    function onHashChange(): void {
      setRoute(parseRoute(window.location.hash));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  return {
    route,
    navigate(next: Route): void {
      const hash = routeToHash(next);
      if (window.location.hash === hash) {
        setRoute(next);
        return;
      }
      window.location.hash = hash;
    },
  };
}

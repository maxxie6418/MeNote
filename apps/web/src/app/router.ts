/**
 * 极简 hash 路由（架构 §2.3.1：`main.tsx` 装配路由表；不引入路由库，M1 只有四个目的地）。
 *
 * 目的地：`#/login`、`#/register`、`#/notes`（默认）、`#/settings/<page>`。
 */
import { useEffect, useState } from "react";

export type SettingsPageId = "general" | "account" | "instance";

export type Route =
  | { name: "login" }
  | { name: "register" }
  | { name: "notes" }
  | { name: "settings"; page: SettingsPageId };

export const SETTINGS_PAGES: readonly SettingsPageId[] = ["general", "account", "instance"];

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").replace(/\/$/, "");

  if (path === "login") return { name: "login" };
  if (path === "register") return { name: "register" };

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

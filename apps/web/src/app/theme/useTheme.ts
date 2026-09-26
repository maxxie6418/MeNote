/**
 * 主题（DESIGN.md §3.2-3/5）：浅色 / 深色 / 跟随系统，默认浅色。
 *
 * 三条硬约束：
 * 1. 切换**只改 `data-theme` 属性**，不整页重渲染（否则丢滚动位置与输入焦点）；
 * 2. 双主题令牌成对提供（`tokens.css`），深色不是浅色的机械反转；
 * 3. 跟随系统时必须响应系统变化；**无 `matchMedia` 的环境回退浅色，不得抛错**。
 *
 * M1 的持久化先用 `localStorage`（本地即时生效）；随账号同步的设置项属 M2。
 */
import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "menote.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readStoredMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // 隐私模式等场景下 localStorage 不可用：忽略，用默认值
  }
  return "light";
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
}

export function useTheme(): {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  const resolved: ResolvedTheme = mode === "system" ? (systemDark ? "dark" : "light") : mode;

  // 始终订阅系统主题变化（不依赖当前 mode）：这样切到"跟随系统"时手上的值一定是最新的，
  // 且**不在 effect 里同步 setState**（react-hooks/set-state-in-effect）
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;

    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // 只改属性，不动组件树
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 存不下就算了，本次会话内仍然生效
    }
  }, []);

  return { mode, resolved, setMode };
}

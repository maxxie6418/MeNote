/**
 * 全局快捷键的唯一监听（捕获阶段，先于输入框，才能拦住浏览器的「保存网页 / 新窗口」）。
 *
 * 内置三条。以后加键：`registerShortcut`，不要在这里再写一个 `if`。
 * - `Ctrl/Cmd+K` 聚焦搜索（原有行为，收进这张表）
 * - `Ctrl/Cmd+S` 有活跃编辑会话就先落盘再同步，否则只同步
 * - `Ctrl/Cmd+N` 打开添加窗口，默认 Memo；已有对话框时不叠
 */
import { useEffect, useRef } from "react";
import {
  canOpenNewMemo,
  dispatchShortcut,
  flushActiveEditingSessions,
  registerShortcut,
} from "./shortcuts";

export interface GlobalShortcutActions {
  /** 立刻跑一轮同步（推送 + 拉取）。引擎还没建好时调用方应做成空操作。 */
  syncNow: () => void;
  /** 打开添加窗口的 Memo 档。未登录时调用方应做成空操作。 */
  openNewMemo: () => void;
}

function focusSearch(): void {
  document.getElementById("search-input")?.focus();
}

function dialogIsOpen(): boolean {
  return document.querySelector("[role='dialog']") !== null;
}

export function useGlobalShortcuts(actions: GlobalShortcutActions): void {
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  useEffect(() => {
    const unregister = [
      registerShortcut({
        id: "search",
        chord: { key: "k", mod: true },
        priority: 10,
        run: () => focusSearch(),
      }),
      registerShortcut({
        id: "save-or-sync",
        chord: { key: "s", mod: true },
        priority: 20,
        run: () => {
          void flushActiveEditingSessions().finally(() => actionsRef.current.syncNow());
        },
      }),
      registerShortcut({
        id: "new-memo",
        chord: { key: "n", mod: true },
        priority: 30,
        run: () => {
          if (!canOpenNewMemo(dialogIsOpen())) return;
          actionsRef.current.openNewMemo();
        },
      }),
    ];

    function onKeyDown(event: KeyboardEvent): void {
      dispatchShortcut(event);
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      for (const off of unregister) off();
    };
  }, []);
}

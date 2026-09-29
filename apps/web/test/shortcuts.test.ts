/**
 * 全局快捷键框架：和弦匹配、优先级、编辑会话冲刷、添加窗口是否允许再开。
 * 不挂真实监听——监听只是把 `dispatchShortcut` 接到 `document` 上。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  activeEditingSessions,
  canOpenNewMemo,
  dispatchShortcut,
  findShortcut,
  flushActiveEditingSessions,
  matchesChord,
  registerEditingSession,
  registerShortcut,
  resetShortcutsForTests,
  type KeyEventLike,
} from "../src/app/shortcuts/shortcuts";

afterEach(() => resetShortcutsForTests());

function key(partial: Partial<KeyEventLike> & Pick<KeyEventLike, "key">): KeyEventLike {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    ...partial,
  };
}

describe("和弦匹配", () => {
  it("Ctrl 与 Cmd 都算 mod；没有 mod 的字母不命中", () => {
    const chord = { key: "s", mod: true };
    expect(matchesChord(key({ key: "s", ctrlKey: true }), chord)).toBe(true);
    expect(matchesChord(key({ key: "S", metaKey: true }), chord)).toBe(true);
    expect(matchesChord(key({ key: "s" }), chord)).toBe(false);
  });

  it("多出来的 Shift / Alt 不算同一条", () => {
    const chord = { key: "s", mod: true };
    expect(matchesChord(key({ key: "s", ctrlKey: true, shiftKey: true }), chord)).toBe(false);
    expect(matchesChord(key({ key: "s", ctrlKey: true, altKey: true }), chord)).toBe(false);
  });

  it("输入法组合中、按住重复，都不命中", () => {
    const chord = { key: "n", mod: true };
    expect(matchesChord(key({ key: "n", ctrlKey: true, isComposing: true }), chord)).toBe(false);
    expect(matchesChord(key({ key: "n", ctrlKey: true, repeat: true }), chord)).toBe(false);
  });
});

describe("登记与分发", () => {
  it("同一和弦取优先级更小的那条，并拦住浏览器默认动作", () => {
    const ran: string[] = [];
    registerShortcut({
      id: "later",
      chord: { key: "k", mod: true },
      priority: 30,
      run: () => ran.push("later"),
    });
    registerShortcut({
      id: "earlier",
      chord: { key: "k", mod: true },
      priority: 10,
      run: () => ran.push("earlier"),
    });

    let prevented = false;
    const handled = dispatchShortcut(
      key({
        key: "k",
        ctrlKey: true,
        preventDefault: () => {
          prevented = true;
        },
      }),
    );

    expect(handled).toBe(true);
    expect(prevented).toBe(true);
    expect(ran).toEqual(["earlier"]);
    expect(findShortcut(key({ key: "k", ctrlKey: true }))?.id).toBe("earlier");
  });

  it("取消登记后不再命中", () => {
    const off = registerShortcut({
      id: "save-or-sync",
      chord: { key: "s", mod: true },
      priority: 20,
      run: () => undefined,
    });
    off();
    expect(findShortcut(key({ key: "s", ctrlKey: true }))).toBeNull();
  });
});

describe("编辑会话", () => {
  it("只冲刷活跃的会话，不活跃的不动", async () => {
    const flushed: string[] = [];
    registerEditingSession({
      id: "note-body",
      isActive: () => true,
      flush: () => {
        flushed.push("note");
      },
    });
    registerEditingSession({
      id: "memo:1",
      isActive: () => false,
      flush: () => {
        flushed.push("memo");
      },
    });

    expect(activeEditingSessions().map((session) => session.id)).toEqual(["note-body"]);
    await expect(flushActiveEditingSessions()).resolves.toBe(1);
    expect(flushed).toEqual(["note"]);
  });

  it("取消登记后不再算活跃", () => {
    const off = registerEditingSession({
      id: "note-title",
      isActive: () => true,
      flush: () => undefined,
    });
    off();
    expect(activeEditingSessions()).toEqual([]);
  });
});

describe("添加窗口", () => {
  it("已有对话框时不再开一个", () => {
    expect(canOpenNewMemo(false)).toBe(true);
    expect(canOpenNewMemo(true)).toBe(false);
  });
});

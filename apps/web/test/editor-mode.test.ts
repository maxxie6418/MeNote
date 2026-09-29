// @vitest-environment jsdom
/**
 * 「上次用的那一档」的本机记忆（`features/notes/editor-mode.ts`）。
 *
 * 背景（用户 2026-09-29 拍板）：设置里不再有"默认档"这一说，打开笔记用**上次用的那一档**，
 * 这个"上次"记在本机（设备级偏好，像主题那样）。
 *
 * 这里只钉**优先级与兜底**：本机记住的（且还开着）→ 设置里的种子（且还开着）→ 还开着的第一档；
 * 任何坏值（手改的、后来被关掉的）都不能把正文卡住。整屏行为在 `note-workspace.test.tsx`。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  LAST_EDITOR_MODE_KEY,
  initialEditorMode,
  readLastEditorMode,
  writeLastEditorMode,
} from "../src/features/notes/editor-mode";

beforeEach(() => window.localStorage.clear());

describe("本机记住的编辑模式", () => {
  it("写进去读得回来；没记过 → null", () => {
    expect(readLastEditorMode()).toBeNull();

    writeLastEditorMode("live");
    expect(readLastEditorMode()).toBe("live");
  });

  it("存了个不认识的档 → 当作没记过（坏值不往下传）", () => {
    window.localStorage.setItem(LAST_EDITOR_MODE_KEY, "typo");

    expect(readLastEditorMode()).toBeNull();
  });

  it("优先级：本机记住的 > 设置里的种子 > 还开着的第一档", () => {
    // 本机记着 preview 且用户还开着 → 用它（哪怕种子是 split）
    writeLastEditorMode("preview");
    expect(initialEditorMode(["split", "edit", "preview", "live"], "split")).toBe("preview");

    // 本机记的那档被关掉了 → 落到设置里的种子（种子还开着）
    expect(initialEditorMode(["split", "edit"], "edit")).toBe("edit");

    // 种子也被关掉了 → 用还开着的第一档（按契约的规范顺序，不是传入顺序）
    expect(initialEditorMode(["preview", "live"], "split")).toBe("preview");
  });
});

// @vitest-environment jsdom
/**
 * 「上次用的那一档」的本机记忆（`features/notes/editor-mode.ts`）。
 *
 * 背景（用户 2026-09-29 拍板）：设置里不再有"默认档"这一说，打开笔记用**上次用的那一档**，
 * 这个"上次"记在本机（设备级偏好，像主题那样）。
 *
 * 这里只钉**优先级与兜底**：本机记住的（且还开着）→ 设置里的种子（且还开着）→ 还开着的第一档；
 * 任何坏值（手改的、后来被关掉的）都不能把正文卡住。整屏行为在 `note-workspace.test.tsx` 与
 * `note-workspace-modes.test.tsx`。
 *
 * 【2026-09-29 阶段 A】写入侧收窄为**产品档**（仅编辑 / 仅预览），读取侧仍认四档——
 * 老版本写下的 `split` / `live` 要读得回来，再由可用清单（产品清单）把它挡掉。
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

    writeLastEditorMode("preview");
    expect(readLastEditorMode()).toBe("preview");
  });

  it("存了个不认识的档 → 当作没记过（坏值不往下传）", () => {
    window.localStorage.setItem(LAST_EDITOR_MODE_KEY, "typo");

    expect(readLastEditorMode()).toBeNull();
  });

  it("老版本写下的 split / live 仍读得回来（读兼容四档，不算坏值）", () => {
    window.localStorage.setItem(LAST_EDITOR_MODE_KEY, "live");
    expect(readLastEditorMode()).toBe("live");

    window.localStorage.setItem(LAST_EDITOR_MODE_KEY, "split");
    expect(readLastEditorMode()).toBe("split");
  });

  it("优先级：本机记住的 > 设置里的种子 > 还开着的第一档", () => {
    // 本机记着 preview 且用户还开着 → 用它（哪怕种子指向别的档）
    writeLastEditorMode("preview");
    expect(initialEditorMode(["edit", "preview"], "edit")).toBe("preview");

    // 本机没记过 → 用种子（种子还开着）
    window.localStorage.clear();
    expect(initialEditorMode(["edit", "preview"], "edit")).toBe("edit");
    expect(initialEditorMode(["edit", "preview"], "preview")).toBe("preview");

    // 种子也被关掉了 → 用还开着的第一档（按传入顺序，不是契约的规范顺序）
    expect(initialEditorMode(["preview", "edit"], "live")).toBe("preview");

    // 本机记着、但这一档已被用户关掉 → 同样落到种子 / 第一档
    writeLastEditorMode("preview");
    expect(initialEditorMode(["edit"], "edit")).toBe("edit");
    expect(initialEditorMode(["edit"], undefined)).toBe("edit");
  });

  it("老记忆 + 已收敛的可用清单：split / live 都回落到产品档，正文不会卡住", () => {
    for (const legacy of ["split", "live"] as const) {
      window.localStorage.setItem(LAST_EDITOR_MODE_KEY, legacy);
      expect(initialEditorMode(["edit", "preview"], "edit"), legacy).toBe("edit");
      expect(initialEditorMode(["edit", "preview"], "live"), legacy).toBe("edit");
      expect(initialEditorMode(["edit", "preview"], undefined), legacy).toBe("edit");
    }
  });
});

// @vitest-environment jsdom
/**
 * 设置 › 通用 里「笔记本树结构」两档选择（用户 2026-10-01 确认）。
 *
 * 钉住三条：**默认是分级文件树**（show_items=false）、两档分别写出 `notebook.show_items`、
 * 说明按三分法（字段级一句留 `setrow__desc`，口径进 `InfoHint`）。
 */
import { DEFAULT_USER_SETTINGS } from "@menote/shared";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../src/features/settings/ui/SettingsPanel";

afterEach(cleanup);

function renderPanel(overrides: Partial<Parameters<typeof SettingsPanel>[0]> = {}) {
  const onPatchSettings = vi.fn();
  render(
    <SettingsPanel
      page="general"
      role="owner"
      themeMode="light"
      onThemeMode={vi.fn()}
      userSettings={DEFAULT_USER_SETTINGS}
      onPatchSettings={onPatchSettings}
      onNavigate={vi.fn()}
      /* 必填的接线（用例不碰它们，给最小可用值；2026-09-28 补：本文件此前漏了这几项，
         `pnpm typecheck` 在 HEAD 上因此是红的——B4 批顺手修掉） */
      registrationOpen={false}
      registrationCloseAt={0}
      onChangeRegistration={async () => undefined}
      onChangePassword={async () => undefined}
      onLogout={vi.fn()}
      {...overrides}
    />,
  );
  return { onPatchSettings };
}

describe("设置：笔记本树结构", () => {
  it("默认是分级文件树（aria-pressed=true），点完整文件树写出 show_items=true", async () => {
    const user = userEvent.setup();
    const { onPatchSettings } = renderPanel();

    const full = screen.getByRole("button", { name: "完整文件树" });
    const graded = screen.getByRole("button", { name: "分级文件树" });
    expect(full.getAttribute("aria-pressed")).toBe("false");
    expect(graded.getAttribute("aria-pressed")).toBe("true");

    await user.click(full);
    expect(onPatchSettings).toHaveBeenCalledWith({ notebook: { show_items: true } });
  });

  it("完整文件树切回分级文件树写回 false", async () => {
    const user = userEvent.setup();
    const { onPatchSettings } = renderPanel({
      userSettings: { ...DEFAULT_USER_SETTINGS, notebook: { show_items: true } },
    });

    expect(screen.getByRole("button", { name: "完整文件树" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "分级文件树" }).getAttribute("aria-pressed")).toBe("false");

    await user.click(screen.getByRole("button", { name: "分级文件树" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ notebook: { show_items: false } });
  });

  it("字段级说明留在行里，口径收进 ⓘ（不平铺）", () => {
    renderPanel();

    expect(screen.getByText("选择左侧树是否把文档列在文件夹下")).toBeTruthy();
    // ⓘ 的口径说明在浮层里，不在行内平铺
    expect(screen.getByRole("button", { name: "笔记本树结构说明" })).toBeTruthy();
  });
});

// @vitest-environment jsdom
/**
 * 设置 › 通用 里那一行「笔记本树里显示条目」（B2 批；用户 2026-09-28 拍板做成设置项、默认关）。
 *
 * 钉住三条：**默认是关**（贴原型形态）、点它写出 `notebook.show_items`、说明按三分法
 * （字段级一句留 `setrow__desc`，口径进 `InfoHint`）。
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
      {...overrides}
    />,
  );
  return { onPatchSettings };
}

describe("设置：笔记本树里显示条目", () => {
  it("默认关（aria-checked=false），点一下写出 notebook.show_items = true", async () => {
    const user = userEvent.setup();
    const { onPatchSettings } = renderPanel();

    const toggle = screen.getByRole("switch", { name: "笔记本树里显示条目" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    await user.click(toggle);
    expect(onPatchSettings).toHaveBeenCalledWith({ notebook: { show_items: true } });
  });

  it("已打开时再点写回 false", async () => {
    const user = userEvent.setup();
    const { onPatchSettings } = renderPanel({
      userSettings: { ...DEFAULT_USER_SETTINGS, notebook: { show_items: true } },
    });

    const toggle = screen.getByRole("switch", { name: "笔记本树里显示条目" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    await user.click(toggle);
    expect(onPatchSettings).toHaveBeenCalledWith({ notebook: { show_items: false } });
  });

  it("字段级说明留在行里，口径收进 ⓘ（不平铺）", () => {
    renderPanel();

    expect(screen.getByText("打开后，左侧每个文件夹下会列出里面的笔记与表格")).toBeTruthy();
    // ⓘ 的口径说明在浮层里，不在行内平铺
    expect(screen.getByRole("button", { name: "笔记本树显示条目的口径" })).toBeTruthy();
  });
});

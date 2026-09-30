// @vitest-environment jsdom
/**
 * 设置 › 编辑器：编辑模式开关组（用户 2026-09-29 拍板"改成可开关显示的，至少留一个"；
 * 同日编辑拓展阶段 A 把产品清单收敛为**仅编辑 / 仅预览**）。
 *
 * 为什么从 `ui.test.tsx` 拆出来：那边是"设置壳"的逐屏验收，本文件只钉**编辑模式这一张卡**的
 * 契约面——①开关组的取值与顺序来自 `PRODUCT_EDITOR_MODES`（界面不另写一份清单）；
 * ②老行里存着的 `split` / `live` 既不显示、也不会被写回去；③"至少留一档"是禁用 + 原因平铺；
 * ④只剩"已退出产品的档"这种老行也不能出现"两档都关、点一下就全开"的怪状态。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_SETTINGS, PRODUCT_EDITOR_MODES } from "@menote/shared";
import { SettingsPanel } from "../src/features/settings/ui/SettingsPanel";

afterEach(cleanup);

const baseProps = {
  role: "owner" as const,
  themeMode: "light" as const,
  onThemeMode: vi.fn(),
  userSettings: DEFAULT_USER_SETTINGS,
  onPatchSettings: vi.fn(),
  registrationOpen: false,
  registrationCloseAt: 0,
  onChangeRegistration: vi.fn(async () => undefined),
  onChangePassword: vi.fn(async () => undefined),
  onLogout: vi.fn(),
  onNavigate: vi.fn(),
};

describe("设置 › 编辑器：编辑模式开关组", () => {
  it("产品清单变了，开关组跟着变（界面不另写一份清单）", () => {
    render(<SettingsPanel {...baseProps} page="editor" />);

    expect(PRODUCT_EDITOR_MODES).toEqual(["edit", "preview"]);
    expect(screen.getAllByRole("switch")).toHaveLength(PRODUCT_EDITOR_MODES.length);
  });

  it("开关组只列产品档；两个都在时都能关，关掉「仅预览」写回 ['edit']", async () => {
    const user = userEvent.setup();
    const onPatchSettings = vi.fn();

    render(<SettingsPanel {...baseProps} page="editor" onPatchSettings={onPatchSettings} />);

    // 单选组退场：不再有"默认编辑模式"这一说（默认档概念整体去掉了）
    expect(screen.queryByRole("group", { name: "默认编辑模式" })).toBeNull();

    for (const mode of ["仅编辑", "仅预览"]) {
      const control = screen.getByRole("switch", { name: mode });
      expect(control.getAttribute("aria-checked"), mode).toBe("true");
      expect((control as HTMLButtonElement).disabled, mode).toBe(false);
    }
    // 双栏与即时渲染都退出了产品，设置里不该再有它们的开关
    expect(screen.queryByRole("switch", { name: "双栏" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "即时渲染" })).toBeNull();

    // 关掉「仅预览」：交回去的是**过滤后的数组**，顺序按契约的规范顺序（不随点击次序漂）
    await user.click(screen.getByRole("switch", { name: "仅预览" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ editor_modes: ["edit"] });
  });

  it("老行里存着四档时，开关按**产品档**显示，写回也不带老值", async () => {
    const user = userEvent.setup();
    const onPatchSettings = vi.fn();

    render(
      <SettingsPanel
        {...baseProps}
        page="editor"
        userSettings={{
          ...DEFAULT_USER_SETTINGS,
          editor_modes: ["split", "edit", "preview", "live"],
        }}
        onPatchSettings={onPatchSettings}
      />,
    );

    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.queryByRole("switch", { name: "双栏" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "即时渲染" })).toBeNull();

    await user.click(screen.getByRole("switch", { name: "仅预览" }));
    expect(onPatchSettings).toHaveBeenCalledWith({ editor_modes: ["edit"] });
  });

  it("只剩一档时，最后那个开关禁用且**原因平铺可见**（DESIGN.md §6.1）", () => {
    render(
      <SettingsPanel
        {...baseProps}
        page="editor"
        userSettings={{ ...DEFAULT_USER_SETTINGS, editor_modes: ["edit"] }}
      />,
    );

    const last = screen.getByRole("switch", { name: "仅编辑" }) as HTMLButtonElement;
    expect(last.disabled).toBe(true);
    // 原因必须看得见（不是只挂在 title 上）
    expect(screen.getByText(/至少保留一个模式/)).toBeTruthy();

    // 另一档是关着的、而且可以重新打开
    const off = screen.getByRole("switch", { name: "仅预览" }) as HTMLButtonElement;
    expect(off.getAttribute("aria-checked")).toBe("false");
    expect(off.disabled).toBe(false);
  });

  it("老行只开着已退出的档（live）时，不出现「两档都关却一点就全开」的怪状态", () => {
    render(
      <SettingsPanel
        {...baseProps}
        page="editor"
        userSettings={{ ...DEFAULT_USER_SETTINGS, editor_modes: ["live"] }}
      />,
    );

    // 归一化后落到产品全集：两档都显示为开（此时"最后一个不许关"不适用——不是只剩一档）
    for (const mode of ["仅编辑", "仅预览"]) {
      const control = screen.getByRole("switch", { name: mode }) as HTMLButtonElement;
      expect(control.getAttribute("aria-checked"), mode).toBe("true");
      expect(control.disabled, mode).toBe(false);
    }
  });
});

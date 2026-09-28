// @vitest-environment jsdom
/**
 * 设置页「版本与回收站」分类（M4-11；界面稿 §五）。
 *
 * 要点：**没有「保存」按钮**（即时生效）、回收站条目数**实时可见**、越界就地报错、
 * 「不限」开关把数值输入禁用、保留密度是**只读**说明（不给假的"可改"入口）。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VERSION_TRASH_SETTINGS } from "@menote/shared";
import {
  VersionsTrashPage,
  type VersionsTrashPageProps,
} from "../src/features/settings/ui/VersionsTrashPage";
import { assertLabelledControls } from "./helpers/a11y";
import { assertSinglePrimaryAction } from "./helpers/design";

afterEach(cleanup);

function renderPage(overrides: Partial<VersionsTrashPageProps> = {}) {
  const onPatchSettings = vi.fn();
  const onOpenTrash = vi.fn();
  const { container } = render(
    <VersionsTrashPage
      settings={DEFAULT_VERSION_TRASH_SETTINGS}
      onPatchSettings={onPatchSettings}
      trashCount={3}
      onOpenTrash={onOpenTrash}
      {...overrides}
    />,
  );
  // 读屏底线（渲染层断言，见 helpers/a11y.ts）：这一屏有数字输入与开关，最容易漏名字
  assertLabelledControls(container, { buttons: 1, fields: 1 });
  assertSinglePrimaryAction(container);
  return { onPatchSettings, onOpenTrash };
}

describe("卡片与回收站入口", () => {
  it("显示回收站条目数（实时计数）与「打开回收站」，且**没有保存按钮**", async () => {
    const user = userEvent.setup();
    const { onOpenTrash } = renderPage();

    expect(screen.getByText("3 条")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "打开回收站" }));
    expect(onOpenTrash).toHaveBeenCalledTimes(1);

    // 即时生效：没有「保存」这类按钮
    expect(screen.queryByRole("button", { name: /保存/ })).toBeNull();
    /*
      2026-09-28：这句是**口径说明**（"即时生效并同步"），按 DESIGN.md §5.4-1 收进卡头 ⓘ。
      断言跟着改成"口径仍在、可读，但不再平铺"——比原来更严格（同时钉住了"不占版面"这件事）。
    */
    expect(screen.queryByText("修改即时生效并同步到其他设备。")).toBeNull();
    expect(screen.getByRole("button", { name: "版本与回收站说明" })).toBeTruthy();
    expect(screen.getByRole("tooltip").textContent).toContain("即时生效并同步到其他设备");
  });

  it("条目数为 0 时照常可点（进去看空状态）", async () => {
    const user = userEvent.setup();
    const { onOpenTrash } = renderPage({ trashCount: 0 });
    const button = screen.getByRole("button", { name: "打开回收站" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await user.click(button);
    expect(onOpenTrash).toHaveBeenCalled();
  });
});

describe("策略设置项", () => {
  it("自动封存：填合法数字即时写进设置", async () => {
    const user = userEvent.setup();
    const { onPatchSettings } = renderPage();

    const input = screen.getByLabelText("自动封存（分钟）");
    await user.clear(input);
    await user.type(input, "20");

    const last = onPatchSettings.mock.calls.at(-1)?.[0] as {
      version_trash: { seal_idle_minutes: number };
    };
    expect(last.version_trash.seal_idle_minutes).toBe(20);
  });

  it("每条最多保留：越界就地报错且**不写进设置**", async () => {
    const user = userEvent.setup();
    const { onPatchSettings } = renderPage();

    const input = screen.getByLabelText("每条最多保留（版本数）");
    await user.clear(input);
    await user.type(input, "9");

    expect(screen.getByText("请填 20–500")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(onPatchSettings).not.toHaveBeenCalled();
  });

  it("每条最多保留：合法值立即生效", async () => {
    const user = userEvent.setup();
    const { onPatchSettings } = renderPage();

    const input = screen.getByLabelText("每条最多保留（版本数）");
    await user.clear(input);
    await user.type(input, "300");

    const last = onPatchSettings.mock.calls.at(-1)?.[0] as {
      version_trash: { versions_keep: number };
    };
    expect(last.version_trash.versions_keep).toBe(300);
    expect(screen.queryByText("请填 20–500")).toBeNull();
  });

  it("「不限」默认打开：数值输入禁用并由**可见文案**说明；关掉后给一个可用起点", async () => {
    const user = userEvent.setup();
    const { onPatchSettings } = renderPage();

    const age = screen.getByLabelText("最长保留时长（天）") as HTMLInputElement;
    expect(age.disabled).toBe(true);
    // 为什么灰着必须**可见**地写出来，不靠 `title` 悬停（DESIGN.md §6.1 / §145）
    expect(age.getAttribute("title")).toBeNull();
    expect(screen.getByText(/不限：只按条数稀疏化/)).toBeTruthy();

    // 开关与其它设置项统一用 role="switch"（2026-09-28 设置页 B 批）
    const unlimited = screen.getByRole("switch", { name: "不限（最长保留时长）" });
    expect(unlimited.getAttribute("aria-checked")).toBe("true");

    await user.click(unlimited);
    const last = onPatchSettings.mock.calls.at(-1)?.[0] as {
      version_trash: { versions_max_age_days: number };
    };
    expect(last.version_trash.versions_max_age_days).toBe(30);
    // 这里不断言点击后的 `aria-checked`：本用例的 `onPatchSettings` 只记录调用、不重渲染，
    // 开关是受控的（值来自 `settings`），所以点完 DOM 上仍是原值——那属于 Harness 的限制，不是实现问题。
  });

  it("回收站保留天数默认 30，可改", async () => {
    const user = userEvent.setup();
    const { onPatchSettings } = renderPage();

    const input = screen.getByLabelText("回收站保留天数") as HTMLInputElement;
    expect(input.value).toBe("30");

    await user.clear(input);
    await user.type(input, "7");
    const last = onPatchSettings.mock.calls.at(-1)?.[0] as {
      version_trash: { trash_retention_days: number };
    };
    expect(last.version_trash.trash_retention_days).toBe(7);
  });

  it("保留密度是**只读**说明（没有输入框）", () => {
    renderPage();
    expect(screen.getByText(/24 小时内全留/)).toBeTruthy();
    // 只读：这一行里没有任何输入控件
    const row = screen.getByText("保留密度").closest(".setrow") as HTMLElement;
    expect(row.querySelector("input")).toBeNull();
  });
});

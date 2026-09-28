// @vitest-environment jsdom
/**
 * 轻提示的「快速跳转」动作（2026-09-28 用户要求：快捷输入发布后要有浮动提示 + 跳转按钮）。
 *
 * 这条与 `DESIGN.md` §6.6「轻提示不承载需要用户行动的信息」的**界定**（写在 `ui/Toast.tsx` 顶部）：
 * 跳转是**便利入口**，内容已经存好了，错过提示不丢东西；带动作的提示停留 6s（够点），
 * 不带动作的仍是 2.8s；点了动作立即收掉这一条。
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastHost, pushToast } from "../src/app/ui/Toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("轻提示的动作按钮", () => {
  it("不带动作：只有文字，没有按钮", () => {
    render(<ToastHost />);
    act(() => pushToast("已同步", "success"));
    expect(screen.getByText("已同步")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("带动作：渲染按钮，点击后执行回调并立即收掉这一条", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ToastHost />);

    act(() => pushToast("已记录", "success", { label: "去 Memo", onClick }));
    const button = screen.getByRole("button", { name: "去 Memo" });
    await user.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
    // 点完不该还留着同一条提示（否则同一件事看起来像做了两次）
    expect(screen.queryByText("已记录")).toBeNull();
  });

  it("带动作的提示停留更久（2.8s 还在，6s 后消失）", () => {
    vi.useFakeTimers();
    render(<ToastHost />);

    act(() => pushToast("带动作的这一条", "success", { label: "打开这一篇", onClick: vi.fn() }));

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText("带动作的这一条")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3_500);
    });
    expect(screen.queryByText("带动作的这一条")).toBeNull();
  });

  it("不带动作的仍是 2.8s 自动消失（没有为了动作把节奏改掉）", () => {
    vi.useFakeTimers();
    render(<ToastHost />);

    // 用**独有的文案**：`items` 是模块级状态，跨用例仍在（前一条用的是真定时器，还没到点）
    act(() => pushToast("只在这一条用例里出现", "success"));
    act(() => {
      vi.advanceTimersByTime(2_900);
    });
    expect(screen.queryByText("只在这一条用例里出现")).toBeNull();
  });
});

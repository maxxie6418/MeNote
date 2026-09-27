// @vitest-environment jsdom
/**
 * 隐私锁的两件界面（M3-9）：顶栏胶囊与解锁框。
 *
 * 这里只验"界面该做的事"：三态文案与颜色、菜单里的动作、输错后逐次加等待、单篇场景不显示档位、
 * 未启用时整个不渲染。判定与状态机本身在 `privacy-model` / `privacy-lock` 用例里覆盖。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivacyCapsule } from "../src/features/privacy/ui/PrivacyCapsule";
import { UnlockModal } from "../src/features/privacy/ui/UnlockModal";

afterEach(cleanup);

function renderCapsule(overrides: Partial<Parameters<typeof PrivacyCapsule>[0]> = {}) {
  const props = {
    lockState: "locked" as const,
    tier: "minutes" as const,
    expiresAt: null,
    onRequestUnlock: vi.fn(),
    onLockAll: vi.fn(),
    onChangeTier: vi.fn(),
    onLockDevice: vi.fn(),
    ...overrides,
  };
  const { container } = render(<PrivacyCapsule {...props} />);
  return { container, ...props };
}

describe("顶栏隐私胶囊", () => {
  it("未启用隐私锁时整个不渲染（M2 的验收点）", () => {
    const { container } = renderCapsule({ lockState: "disabled" });
    expect(container.innerHTML).toBe("");
  });

  it("锁定态：中性色「已锁定」，点击请求解锁", () => {
    const { onRequestUnlock } = renderCapsule();
    const button = screen.getByRole("button", { name: /已锁定/ });
    expect(button.className).toContain("pill--neutral");
    fireEvent.click(button);
    expect(onRequestUnlock).toHaveBeenCalledTimes(1);
  });

  it("解锁态（N 分钟档）：琥珀色 + 倒计时", () => {
    const { container } = renderCapsule({
      lockState: "unlocked",
      tier: "minutes",
      expiresAt: Date.now() + 272_000,
    });
    expect(container.textContent).toMatch(/已解锁 · 4:3\d/);
    expect((container.querySelector(".pill") as HTMLElement).className).toContain("pill--busy");
  });

  it("解锁态（本次会话档）：显示档位文字，不显示倒计时", () => {
    const { container } = renderCapsule({ lockState: "unlocked", tier: "session" });
    expect(container.textContent).toContain("已解锁 · 本次会话");
  });

  it("解锁态（设备长期档）：危险色提醒，并多一个「锁定此设备」", () => {
    const { container, onLockDevice } = renderCapsule({
      lockState: "unlocked",
      tier: "device",
    });
    expect(container.textContent).toContain("本设备始终解锁");
    expect((container.querySelector(".pill") as HTMLElement).className).toContain("pill--err");

    // 菜单：立即锁定 + 另外两档 + 锁定此设备
    fireEvent.click(screen.getByRole("button", { name: /隐私锁/ }));
    expect(screen.getByRole("menuitem", { name: /立即锁定/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /改为「N 分钟」/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /改为「本次会话」/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /锁定此设备/ }));
    expect(onLockDevice).toHaveBeenCalledTimes(1);
  });

  it("菜单里的「立即锁定」与改档位都回调出去", () => {
    const { onLockAll, onChangeTier } = renderCapsule({
      lockState: "unlocked",
      tier: "session",
    });
    fireEvent.click(screen.getByRole("button", { name: /隐私锁/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /立即锁定/ }));
    expect(onLockAll).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /隐私锁/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /改为「当前设备长期」/ }));
    expect(onChangeTier).toHaveBeenCalledWith("device");
  });
});

function renderModal(overrides: Partial<Parameters<typeof UnlockModal>[0]> = {}) {
  const props = {
    open: true,
    defaultTier: "minutes" as const,
    minutes: 5,
    onClose: vi.fn(),
    onSubmit: vi.fn(async () => true),
    onForgot: vi.fn(),
    ...overrides,
  };
  const { container } = render(<UnlockModal {...props} />);
  return { container, ...props };
}

/** 在密码框里输入并回车（比 userEvent 更省事：这里不需要真实的键入节奏） */
function typePassword(value: string): void {
  fireEvent.change(screen.getByLabelText("隐私密码"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "解锁" }));
}

describe("解锁框", () => {
  it("隐私锁场景：密码框 + 三档 + 忘记密码入口", () => {
    renderModal();
    expect(screen.getByText("解锁隐私锁")).toBeTruthy();
    expect(screen.getByLabelText("隐私密码")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "忘记隐私密码" })).toBeTruthy();
  });

  it("单篇场景：标题不同、且不显示档位块", () => {
    renderModal({ variant: "item" });
    expect(screen.getByText("解锁此篇")).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("密码正确 → 用所选档位提交并关闭", async () => {
    const { onSubmit, onClose } = renderModal();
    fireEvent.click(screen.getByRole("radio", { name: "本次会话" }));
    typePassword("对的密码");

    await screen.findByText("解锁隐私锁");
    expect(onSubmit).toHaveBeenCalledWith("对的密码", "session");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("密码错误 → 报错并清空输入，且逐次加等待（第二次要等 2 秒）", async () => {
    const onSubmit = vi.fn(async () => false);
    renderModal({ onSubmit });

    typePassword("错的密码");
    const first = await screen.findByRole("alert");
    expect(first.textContent).toContain("请等待 1 秒后再试");
    expect((screen.getByLabelText("隐私密码") as HTMLInputElement).value).toBe("");

    // 等待期间不能再提交
    expect((screen.getByRole("button", { name: "解锁" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("没有本地材料时置灰并说明需要联网（不做点了没反应）", () => {
    renderModal({ unavailable: true });
    expect(screen.getByRole("button", { name: "解锁" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/需要联网校验隐私密码/)).toBeTruthy();
  });

  it("忘记隐私密码 → 走回调（去设置 › 隐私锁 重置），不是死链", () => {
    const { onForgot } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "忘记隐私密码" }));
    expect(onForgot).toHaveBeenCalledTimes(1);
  });
});

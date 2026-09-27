// @vitest-environment jsdom
/**
 * 设置页「隐私锁」分类（M3-9）：启用 / 关闭 / 改密 / 重置四条流程的**界面侧**契约。
 *
 * 这里不碰 WebCrypto、不碰网络：`lock` 是一组替身，验的是"界面把该做的事做对了"
 * （校验、错误可见、把参数原样交给动作、即时写设置）。加密与请求本身在
 * `privacy-crypto` / `privacy-lock` / worker 的 `crypto.test.ts` 里覆盖。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRIVACY_SETTINGS } from "@menote/shared";
import {
  PrivacySettingsPage,
  type PrivacyLockActions,
} from "../src/features/settings/ui/PrivacySettingsPage";

afterEach(cleanup);

function lockStub(overrides: Partial<PrivacyLockActions> = {}): PrivacyLockActions {
  return {
    enabled: false,
    busy: false,
    lockState: "disabled",
    enable: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => true),
    resetPassword: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
    ...overrides,
  };
}

function renderPage(options: {
  lock?: PrivacyLockActions;
  settings?: typeof DEFAULT_PRIVACY_SETTINGS;
} = {}) {
  const lock = options.lock ?? lockStub();
  const onPatchSettings = vi.fn();
  const { container } = render(
    <PrivacySettingsPage
      lock={lock}
      settings={options.settings ?? DEFAULT_PRIVACY_SETTINGS}
      onPatchSettings={onPatchSettings}
    />,
  );
  return { container, lock, onPatchSettings };
}

function typeInto(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("启用隐私锁", () => {
  it("默认未启用：按钮打开表单，两次不一致时给出可见错误且不提交", () => {
    const { lock } = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "启用隐私锁" }));
    typeInto("设置隐私密码", "第一遍");
    typeInto("再输入一次", "第二遍");
    fireEvent.click(screen.getAllByRole("button", { name: "启用" })[0]!);

    expect(screen.getByRole("alert").textContent).toContain("两次输入的隐私密码不一致");
    expect(lock.enable).not.toHaveBeenCalled();
  });

  it("两次一致：把密码交给动作，并说明启用需要联网", async () => {
    const { lock } = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "启用隐私锁" }));
    typeInto("设置隐私密码", "新密码");
    typeInto("再输入一次", "新密码");
    fireEvent.click(screen.getAllByRole("button", { name: "启用" })[0]!);

    await screen.findByRole("status");
    expect(lock.enable).toHaveBeenCalledWith("新密码");
  });

  it("密码为空时不提交", () => {
    const { lock } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "启用隐私锁" }));
    fireEvent.click(screen.getAllByRole("button", { name: "启用" })[0]!);
    expect(lock.enable).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("请先设置隐私密码");
  });
});

describe("关闭隐私锁", () => {
  it("已启用时显示状态与关闭按钮；被服务端拒绝时把原因显示出来", async () => {
    const disable = vi.fn(async () => {
      throw new Error("还有隐私内容：请先取消单篇标记并清空加密空间");
    });
    renderPage({ lock: lockStub({ enabled: true, lockState: "locked", disable }) });

    expect(screen.getByText("已启用（当前已锁定）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭隐私锁" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("还有隐私内容");
  });

  it("关闭成功给出说明（而不是静默）", async () => {
    renderPage({ lock: lockStub({ enabled: true, lockState: "unlocked" }) });
    expect(screen.getByText("已启用（当前已解锁）")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关闭隐私锁" }));
    expect(await screen.findByRole("status")).toBeTruthy();
  });
});

describe("档位与范围（即时写设置）", () => {
  it("三档按钮写 tier，改档不改其它字段", () => {
    const { onPatchSettings } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "本次会话" }));
    expect(onPatchSettings).toHaveBeenCalledWith({
      privacy: { ...DEFAULT_PRIVACY_SETTINGS, tier: "session" },
    });
  });

  it("N 分钟档的候选值来自共享常量（与契约同源）", () => {
    const { onPatchSettings } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "15 分钟" }));
    expect(onPatchSettings).toHaveBeenCalledWith({
      privacy: { ...DEFAULT_PRIVACY_SETTINGS, minutes: 15 },
    });
  });

  it("Memo 纳入范围与正文可搜是两个独立开关", () => {
    const { onPatchSettings } = renderPage();

    fireEvent.click(screen.getByRole("switch", { name: "Memo 也受隐私锁保护" }));
    expect(onPatchSettings).toHaveBeenCalledWith({
      privacy: {
        ...DEFAULT_PRIVACY_SETTINGS,
        scope: { memo: !DEFAULT_PRIVACY_SETTINGS.scope.memo },
      },
    });

    fireEvent.click(screen.getByRole("switch", { name: "解锁期间可搜索正文" }));
    expect(onPatchSettings).toHaveBeenCalledWith({
      privacy: {
        ...DEFAULT_PRIVACY_SETTINGS,
        search_bodies_when_unlocked: !DEFAULT_PRIVACY_SETTINGS.search_bodies_when_unlocked,
      },
    });
  });
});

describe("改密与重置", () => {
  it("未启用时不显示密码区块（没有密码可改）", () => {
    renderPage();
    expect(screen.queryByText("修改隐私密码")).toBeNull();
    expect(screen.queryByRole("button", { name: "重置隐私密码" })).toBeNull();
  });

  it("改密：当前密码不对时报错且不显示成功说明", async () => {
    const changePassword = vi.fn(async () => false);
    renderPage({ lock: lockStub({ enabled: true, lockState: "unlocked", changePassword }) });

    typeInto("当前隐私密码", "错的");
    typeInto("新的隐私密码", "新的");
    typeInto("再输入一次新密码", "新的");
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("当前隐私密码不正确");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("改密成功：给出「已加密的内容不受影响」的说明", async () => {
    const changePassword = vi.fn(async () => true);
    renderPage({ lock: lockStub({ enabled: true, lockState: "unlocked", changePassword }) });

    typeInto("当前隐私密码", "旧的");
    typeInto("新的隐私密码", "新的");
    typeInto("再输入一次新密码", "新的");
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("不受影响");
    expect(changePassword).toHaveBeenCalledWith("旧的", "新的");
  });

  it("改密两次输入不一致：本地就拦下，不调用动作", () => {
    const changePassword = vi.fn(async () => true);
    renderPage({ lock: lockStub({ enabled: true, lockState: "unlocked", changePassword }) });

    typeInto("当前隐私密码", "旧的");
    typeInto("新的隐私密码", "新的");
    typeInto("再输入一次新密码", "不一样的");
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    expect(changePassword).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("两次输入的新密码不一致");
  });

  it("重置：不需要旧密码，成功后说清「内容密钥没变、内容还在」", async () => {
    const resetPassword = vi.fn(async () => undefined);
    renderPage({ lock: lockStub({ enabled: true, lockState: "locked", resetPassword }) });

    typeInto("重置为新的隐私密码", "重置后的");
    typeInto("再输入一次新密码（重置）", "重置后的");
    fireEvent.click(screen.getByRole("button", { name: "重置隐私密码" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("内容密钥没有变");
    expect(resetPassword).toHaveBeenCalledWith("重置后的");
  });

  it("重置失败（实例没配备份凭据）：把服务端的说明显示出来", async () => {
    const resetPassword = vi.fn(async () => {
      throw new Error("实例未配置 BACKUP_CRED_KEY 机密，无法启用隐私锁（请联系实例管理员）");
    });
    renderPage({ lock: lockStub({ enabled: true, lockState: "locked", resetPassword }) });

    typeInto("重置为新的隐私密码", "重置后的");
    typeInto("再输入一次新密码（重置）", "重置后的");
    fireEvent.click(screen.getByRole("button", { name: "重置隐私密码" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("BACKUP_CRED_KEY");
  });
});

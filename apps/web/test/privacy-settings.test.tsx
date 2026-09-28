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
import { assertLabelledControls } from "./helpers/a11y";
import { assertSinglePrimaryAction } from "./helpers/design";

afterEach(cleanup);

function lockStub(overrides: Partial<PrivacyLockActions> = {}): PrivacyLockActions {
  return {
    enabled: false,
    busy: false,
    lockState: "disabled",
    lockAll: vi.fn(),
    enable: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => true),
    resetPassword: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** 已启用的常用形态（六卡齐全时用它） */
function enabledLock(overrides: Partial<PrivacyLockActions> = {}): PrivacyLockActions {
  return lockStub({ enabled: true, lockState: "unlocked", ...overrides });
}

function renderPage(options: {
  lock?: PrivacyLockActions;
  settings?: typeof DEFAULT_PRIVACY_SETTINGS;
  /** 离线：四个联网入口应置灰并可见说明 */
  offline?: boolean;
} = {}) {
  const lock = options.lock ?? lockStub();
  const onPatchSettings = vi.fn();
  const { container, rerender } = render(
    <PrivacySettingsPage
      lock={lock}
      settings={options.settings ?? DEFAULT_PRIVACY_SETTINGS}
      onPatchSettings={onPatchSettings}
      offline={options.offline}
    />,
  );
  // 读屏底线（渲染层断言，见 helpers/a11y.ts）：设置页控件最多，也最容易漏名字
  assertLabelledControls(container, { buttons: 1 });
  assertSinglePrimaryAction(container);
  return { container, lock, onPatchSettings, rerender };
}

/** 卡片顺序（M3 界面稿 §四：**顺序即操作顺序**） */
function cardNames(container: HTMLElement): Array<string | null> {
  return [...container.querySelectorAll(".setcard")].map((card) =>
    card.getAttribute("aria-label"),
  );
}

function typeInto(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("启用隐私锁", () => {
  /**
   * 回归（2026-09-27 发现并修）：启用表展开后，卡片里的「启用隐私锁」与表单里的「启用」
   * **同时是实心主色按钮**，违反 `DESIGN.md` §5.1【禁止】同一区域两个并列主色按钮。
   * 修法：表单展开时收起那个入口（表单自带「取消」，用户不会没有退路）。
   */
  it("表单展开时**只有一个主色按钮**（入口收起，主操作是「启用」）", () => {
    const { container } = renderPage();

    // 收起态：仅「启用隐私锁」一个主色按钮
    expect(container.querySelectorAll(".btn--primary")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "启用隐私锁" }));

    const primaries = [...container.querySelectorAll(".btn--primary")];
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.textContent).toContain("启用");
    // 入口确实收起了（不是靠禁用装样子）
    expect(screen.queryByRole("button", { name: "启用隐私锁" })).toBeNull();
    // 表单仍能取消
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();
  });

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
    // 破坏性操作要二次确认（DESIGN.md §6.5）：入口之后还有一步
    fireEvent.click(screen.getByRole("button", { name: "确认关闭" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("还有隐私内容");
  });

  it("关闭成功给出说明（而不是静默）", async () => {
    renderPage({ lock: lockStub({ enabled: true, lockState: "unlocked" }) });
    expect(screen.getByText("已启用（当前已解锁）")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关闭隐私锁" }));
    // 破坏性操作要二次确认（DESIGN.md §6.5）：入口之后还有一步
    fireEvent.click(screen.getByRole("button", { name: "确认关闭" }));
    expect(await screen.findByRole("status")).toBeTruthy();
  });
});

describe("档位与范围（即时写设置）", () => {
  it("三档按钮写 tier，改档不改其它字段", () => {
    const { onPatchSettings } = renderPage({ lock: enabledLock() });
    fireEvent.click(screen.getByRole("button", { name: "本次会话" }));
    expect(onPatchSettings).toHaveBeenCalledWith({
      privacy: { ...DEFAULT_PRIVACY_SETTINGS, tier: "session" },
    });
  });

  it("N 分钟档的候选值来自共享常量（与契约同源）", () => {
    const { onPatchSettings } = renderPage({ lock: enabledLock() });
    fireEvent.click(screen.getByRole("button", { name: "15 分钟" }));
    expect(onPatchSettings).toHaveBeenCalledWith({
      privacy: { ...DEFAULT_PRIVACY_SETTINGS, minutes: 15 },
    });
  });

  it("Memo 纳入范围与正文可搜是两个独立开关", () => {
    const { onPatchSettings } = renderPage({ lock: enabledLock() });

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
  it("未启用时**只显示状态卡**（没有密码、档位、范围、搜索、关闭可说）", () => {
    const { container } = renderPage();
    expect(cardNames(container)).toEqual(["隐私锁状态"]);
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
    // 破坏性操作要二次确认（DESIGN.md §6.5）：入口之后还有一步
    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));

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
    // 破坏性操作要二次确认（DESIGN.md §6.5）：入口之后还有一步
    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("BACKUP_CRED_KEY");
  });
});

describe("六卡结构（M3 界面稿 §四：顺序即操作顺序）", () => {
  it("已启用时六张卡齐全且顺序固定", () => {
    const { container } = renderPage({ lock: enabledLock() });

    expect(cardNames(container)).toEqual([
      "隐私锁状态",
      "隐私密码",
      "解锁档位",
      "隐私范围",
      "隐私与搜索",
      "关闭隐私锁",
    ]);
  });

  it("「立即锁定」在状态卡里；已锁定时禁用并说明原因", () => {
    const lockAll = vi.fn();
    const { rerender } = renderPage({ lock: enabledLock({ lockAll }) });

    fireEvent.click(screen.getByRole("button", { name: "立即锁定" }));
    expect(lockAll).toHaveBeenCalledTimes(1);

    // 已锁定时再点没有意义 → 禁用，且原因在 title 里说清（DESIGN.md §6.1）
    rerender(
      <PrivacySettingsPage
        lock={enabledLock({ lockState: "locked" })}
        settings={DEFAULT_PRIVACY_SETTINGS}
        onPatchSettings={vi.fn()}
      />,
    );
    const again = screen.getByRole("button", { name: "立即锁定" }) as HTMLButtonElement;
    expect(again.disabled).toBe(true);
    expect(again.title).toContain("已经是锁定状态");
  });

  it("隐私范围：加密空间是**只读行**（始终在范围内）+ 一行预留扩展位", () => {
    renderPage({ lock: enabledLock() });

    const vault = screen.getByRole("switch", {
      name: "加密空间始终在隐私范围内",
    }) as HTMLButtonElement;
    expect(vault.disabled).toBe(true);
    expect(vault.getAttribute("aria-checked")).toBe("true");
    // 禁用原因写在可见文案里（不靠悬停）
    expect(screen.getByText("始终在隐私范围内，不可关闭")).toBeTruthy();
    expect(screen.getByText(/预留扩展位/)).toBeTruthy();
  });

  it("搜索独立成卡：正文可搜不再是范围卡里的一行", () => {
    const { container } = renderPage({ lock: enabledLock() });
    const scope = container.querySelector('.setcard[aria-label="隐私范围"]');
    const search = container.querySelector('.setcard[aria-label="隐私与搜索"]');

    expect(scope?.textContent).not.toContain("解锁期间可搜索正文");
    expect(search?.textContent).toContain("解锁期间可搜索正文");
  });

  it("说明文字的分工：口径进 InfoHint，破坏性后果仍平铺可见", () => {
    const { container } = renderPage({ lock: enabledLock() });

    // 口径（"内容密钥不变"）收进 ⓘ，不占版面
    expect(screen.getByRole("button", { name: "隐私密码说明" })).toBeTruthy();
    // 而破坏性后果与前置条件必须看得见（DESIGN.md §5.4-2）
    expect(
      screen.getByText("加密空间与单篇加密会先被清空；还有隐私内容时服务端会拒绝并说明原因。"),
    ).toBeTruthy();
    expect(screen.getByText(/重置需要实例配置好备份凭据/)).toBeTruthy();
    expect(container.querySelectorAll(".infohint").length).toBeGreaterThan(0);
  });
});

describe("离线（用既有的同步状态判定）", () => {
  it("未启用 + 离线：启用入口置灰并说明需要联网", () => {
    renderPage({ offline: true });

    const enable = screen.getByRole("button", { name: "启用隐私锁" }) as HTMLButtonElement;
    expect(enable.disabled).toBe(true);
    expect(enable.title).toContain("需要联网");
    // 前置条件**平铺可见**（入口已置灰，不能只靠 title 说明原因）
    expect(screen.getByText(/离线：启用需要联网/)).toBeTruthy();
  });

  it("已启用 + 离线：修改 / 重置 / 关闭三个联网入口都置灰并说明；档位与范围仍可改", () => {
    const { onPatchSettings } = renderPage({
      lock: enabledLock({ lockState: "unlocked" }),
      offline: true,
    });

    for (const label of ["修改密码", "重置隐私密码", "关闭隐私锁"]) {
      const button = screen.getByRole("button", { name: label }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.title).toContain("需要联网");
    }
    // 离线依然能改的本地偏好：档位 / 范围 / 搜索
    fireEvent.click(screen.getByRole("button", { name: "本次会话" }));
    expect(onPatchSettings).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: "Memo 也受隐私锁保护" }));
    expect(onPatchSettings).toHaveBeenCalledTimes(2);
    // 可见的离线说明（前置条件不能只靠 title）
    expect(screen.getByText(/离线：修改与重置都需要联网/)).toBeTruthy();
  });
});

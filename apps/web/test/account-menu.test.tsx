// @vitest-environment jsdom
/**
 * 账户快捷菜单（M2-7 / M18-03 验收点）：
 * - 结构：账户头 → 可配置功能项 → 定底「设置」「退出登录」（后两项不进配置清单）；
 * - 显示哪些功能项由设置决定，**改设置即时生效**（同一份数据驱动）；
 * - 主题是一排三档，且**切完不收起菜单**；
 * - 未实现的功能（立即锁定 M3 等）禁用并说明原因。
 */
import { DEFAULT_USER_SETTINGS, QUICK_MENU_FEATURES } from "@menote/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountQuickMenu } from "../src/app/topbar/AccountQuickMenu";

afterEach(cleanup);

function renderMenu(overrides: Partial<Parameters<typeof AccountQuickMenu>[0]> = {}) {
  const onOpenSettings = vi.fn();
  const onLogout = vi.fn();
  const onThemeMode = vi.fn();
  const onFocusSearch = vi.fn();
  render(
    <AccountQuickMenu
      user={{ username: "maxxie", role: "owner" }}
      settings={DEFAULT_USER_SETTINGS}
      themeMode="light"
      onThemeMode={onThemeMode}
      onFocusSearch={onFocusSearch}
      onOpenSettings={onOpenSettings}
      onLogout={onLogout}
      {...overrides}
    />,
  );
  return { onOpenSettings, onLogout, onThemeMode, onFocusSearch };
}

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "账户与设置" }));
  return { user, menu: screen.getByRole("menu", { name: "账户与设置" }) };
}

describe("账户快捷菜单", () => {
  it("账户头显示用户名、角色与实例；定底是「设置」与「退出登录」", async () => {
    renderMenu();
    const { menu } = await openMenu();

    expect(within(menu).getByText("maxxie")).toBeTruthy();
    expect(within(menu).getByText(/owner/)).toBeTruthy();
    expect(within(menu).getByText(/本地实例/)).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "设置" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "退出登录" })).toBeTruthy();
  });

  it("默认只显示主题切换与立即锁定；搜索不在菜单里", async () => {
    renderMenu();
    const { menu } = await openMenu();

    // 主题是一排三档（不是菜单项）
    const themeRow = within(menu).getByRole("group", { name: "主题" });
    expect(within(themeRow).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "浅色",
      "深色",
      "跟随系统",
    ]);

    expect(within(menu).getByRole("menuitem", { name: "立即锁定" })).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: "搜索" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "回收站" })).toBeNull();
  });

  it("设置里启用搜索后菜单立刻出现，点击把焦点送到搜索框", async () => {
    const { onFocusSearch } = renderMenu({
      settings: { ...DEFAULT_USER_SETTINGS, quick_menu: ["theme", "lock", "search"] },
    });
    const { user, menu } = await openMenu();

    await user.click(within(menu).getByRole("menuitem", { name: "搜索" }));
    expect(onFocusSearch).toHaveBeenCalledTimes(1);
  });

  it("主题切换**不收起菜单**（便于连续比色）", async () => {
    const { onThemeMode } = renderMenu();
    const { user, menu } = await openMenu();

    await user.click(within(menu).getByRole("button", { name: "深色" }));
    expect(onThemeMode).toHaveBeenCalledWith("dark");
    expect(screen.getByRole("menu", { name: "账户与设置" })).toBeTruthy();
  });

  it("未实现的功能禁用并说明里程碑（立即锁定 M3）", async () => {
    renderMenu();
    const { menu } = await openMenu();

    const lock = within(menu).getByRole("menuitem", { name: "立即锁定" }) as HTMLButtonElement;
    expect(lock.disabled).toBe(true);
    expect(lock.title).toContain("M3");
  });

  it("「设置」与「退出登录」都走回调", async () => {
    const { onOpenSettings, onLogout } = renderMenu();
    const { user, menu } = await openMenu();

    await user.click(within(menu).getByRole("menuitem", { name: "设置" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    const { user: user2, menu: menu2 } = await openMenu();
    await user2.click(within(menu2).getByRole("menuitem", { name: "退出登录" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("快捷菜单候选清单始终是 5 个（设置页与菜单同一份数据）", () => {
    expect(QUICK_MENU_FEATURES.map((feature) => feature.id)).toEqual([
      "theme",
      "lock",
      "search",
      "trash",
      "backup",
    ]);
  });
});

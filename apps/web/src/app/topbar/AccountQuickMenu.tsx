/**
 * 账户快捷菜单（components.md §五 `AccountEntry` + `AccountQuickMenu`；功能拆解 M18-03、M02-01）。
 *
 * 结构（自上而下）：**账户头**（头像 + 角色 + 实例）→ 分隔线 → **可配置的功能项** → 分隔线 →
 * 定底的「设置」「退出登录」（**不在配置清单里**）。
 *
 * 三条行为：
 * 1. 显示哪些功能项由 设置 › 通用 › 快捷菜单 决定（`quick_menu` 数组），**即时生效**——
 *    菜单与设置页读的是同一份数据；
 * 2. 菜单里的**主题切换是一排三档**，且切完**不收起菜单**（便于连续比色）；
 * 3. 未实现的功能（立即锁定 M3 / 回收站 M4 / 立即备份 M5）照常显示但**禁用并说明原因**，
 *    不做"点了没反应"。
 */
import type { QuickMenuFeature, UserSettings } from "@menote/shared";
import { QUICK_MENU_FEATURES } from "@menote/shared";
import { Avatar } from "../ui/Controls";
import { DropdownMenu, type MenuItemSpec } from "../ui/Menu";
import type { ThemeMode } from "../theme/useTheme";
import type { TopbarUser } from "./Topbar";

const THEME_ROW: ReadonlyArray<{ id: ThemeMode; label: string }> = [
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
  { id: "system", label: "跟随系统" },
];

export interface AccountQuickMenuProps {
  user: TopbarUser;
  settings: UserSettings;
  themeMode: ThemeMode;
  onThemeMode: (mode: ThemeMode) => void;
  /** 「搜索」项：把焦点送到顶栏搜索框 */
  onFocusSearch: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export function AccountQuickMenu({
  user,
  settings,
  themeMode,
  onThemeMode,
  onFocusSearch,
  onOpenSettings,
  onLogout,
}: AccountQuickMenuProps) {
  const enabled = QUICK_MENU_FEATURES.filter((feature) =>
    settings.quick_menu.includes(feature.id),
  );

  /** 除主题外的功能项（主题走上面那一排三档的 `blocks`） */
  const items: MenuItemSpec[] = enabled
    .filter((feature) => feature.id !== "theme")
    .map((feature) => featureItem(feature.id, feature.pendingStep, onFocusSearch));

  // 定底两项：设置与退出登录（不进配置清单）
  items.push(
    { id: "settings", label: "设置", icon: "settings", onSelect: onOpenSettings },
    { id: "logout", label: "退出登录", icon: "logout", onSelect: onLogout },
  );

  return (
    <DropdownMenu
      label="账户与设置"
      align="right"
      trigger={<Avatar username={user.username} size={24} />}
      header={
        <div className="acct">
          <Avatar username={user.username} size={28} />
          <div className="acct__meta">
            <span className="acct__name">{user.username}</span>
            <span className="acct__sub">
              {user.role === "owner" ? "owner" : "成员"} · 本地实例
            </span>
          </div>
        </div>
      }
      blocks={
        settings.quick_menu.includes("theme") ? (
          <div className="menu__theme" role="group" aria-label="主题">
            {THEME_ROW.map((option) => (
              <button
                key={option.id}
                type="button"
                className="menu__theme-item"
                aria-pressed={themeMode === option.id}
                onClick={() => onThemeMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null
      }
      items={items}
    />
  );
}

/** 把功能 id 映射成菜单项；未实现的禁用并说明里程碑 */
function featureItem(
  id: QuickMenuFeature,
  pendingStep: string | null,
  onFocusSearch: () => void,
): MenuItemSpec {
  if (id === "search") {
    return { id, label: "搜索", icon: "search", onSelect: onFocusSearch };
  }
  if (id === "lock") {
    return {
      id,
      label: "立即锁定",
      icon: "lock",
      disabled: true,
      title: "隐私锁将在 M3 启用",
      onSelect: () => undefined,
    };
  }
  if (id === "trash") {
    return {
      id,
      label: "回收站",
      icon: "folder",
      disabled: true,
      title: "回收站将在 M4 提供",
      onSelect: () => undefined,
    };
  }
  return {
    id,
    label: "立即备份",
    icon: "cloud-ok",
    disabled: true,
    title: `立即备份将在 ${pendingStep ?? "后续里程碑"} 提供`,
    onSelect: () => undefined,
  };
}

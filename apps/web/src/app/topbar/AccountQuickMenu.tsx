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
 * 3. 未实现的功能照常显示但**禁用并说明原因**（现在只剩「立即备份」，等 M5）。
 *
 * 【2026-09-28 修复】此前「立即锁定」与「回收站」**硬编码禁用**并写着"将在 M3/M4 提供"——
 * 而 M3、M4 早已交付：菜单里点了没反应、设置页又写着"将在 M4 生效"，同一件事两处口径都是错的。
 * 现在两项都接线（锁定走隐私锁组装层、回收站走路由），只有真正未交付的「立即备份」保持禁用。
 */
import type { QuickMenuFeature, UserSettings } from "@menote/shared";
import { QUICK_MENU_FEATURES } from "@menote/shared";
import { APP_VERSION } from "../about";
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
  /** 「立即锁定」项（M3 已交付）：锁上全部已解锁内容 */
  onLock: () => void;
  /** 「回收站」项（M4 已交付）：去回收站页 */
  onOpenTrash: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

/** 功能项要用的动作：集中成一份，免得每加一项就多一个位置参数 */
interface FeatureActions {
  onFocusSearch: () => void;
  onLock: () => void;
  onOpenTrash: () => void;
}

export function AccountQuickMenu({
  user,
  settings,
  themeMode,
  onThemeMode,
  onFocusSearch,
  onLock,
  onOpenTrash,
  onOpenSettings,
  onLogout,
}: AccountQuickMenuProps) {
  const enabled = QUICK_MENU_FEATURES.filter((feature) =>
    settings.quick_menu.includes(feature.id),
  );

  /** 除主题外的功能项（主题走上面那一排三档的 `blocks`） */
  const items: MenuItemSpec[] = enabled
    .filter((feature) => feature.id !== "theme")
    .map((feature) =>
      featureItem(feature.id, feature.pendingStep, { onFocusSearch, onLock, onOpenTrash }),
    );

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
            <span className="acct__sub">MeNote v{APP_VERSION}</span>
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

/** 把功能 id 映射成菜单项；**只有真正未交付的**才禁用并说明里程碑 */
function featureItem(
  id: QuickMenuFeature,
  pendingStep: string | null,
  actions: FeatureActions,
): MenuItemSpec {
  if (id === "search") {
    return { id, label: "搜索", icon: "search", onSelect: actions.onFocusSearch };
  }
  if (id === "lock") {
    // M3 已交付：锁上全部已解锁内容
    return { id, label: "立即锁定", icon: "lock", onSelect: actions.onLock };
  }
  if (id === "trash") {
    // M4 已交付：去回收站页
    return { id, label: "回收站", icon: "folder", onSelect: actions.onOpenTrash };
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

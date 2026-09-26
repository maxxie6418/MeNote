/**
 * 顶栏：全宽、固定高、**6 块且顺序不可变**（DESIGN.md §2.5-1）：
 * 品牌 · 面包屑 · 搜索框 · 同步胶囊 · 隐私锁胶囊 · 账户与设置。
 *
 * M1 的取舍（见 `docs/modules/Menote-M1-界面稿-v1.md`）：
 * - 搜索框**保留占位**（位置固定，避免 M2 再动顶栏结构），禁用并说明原因；
 * - 隐私锁胶囊**不渲染**（未启用隐私锁时整个不显示，拆解 M02-05）。
 */
import type { ReactNode } from "react";
import { Avatar, Pill } from "../ui/Controls";
import { Icon } from "../ui/Icon";
import { DropdownMenu } from "../ui/Menu";
import type { SyncIndicator } from "../useSyncStatus";

export interface TopbarUser {
  username: string;
  role: "owner" | "member";
}

export interface TopbarProps {
  user: TopbarUser;
  breadcrumb: ReactNode;
  sync: SyncIndicator;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export function Topbar({ user, breadcrumb, sync, onOpenSettings, onLogout }: TopbarProps) {
  return (
    <header className="topbar">
      {/* ① 品牌 */}
      <div className="topbar__brand">
        <span className="brandmark" aria-hidden="true" />
        <span>Menote</span>
      </div>

      {/* ② 面包屑 */}
      <nav className="topbar__crumb" aria-label="当前位置">
        {breadcrumb}
      </nav>

      {/* ③ 搜索框（M1 占位） */}
      <div className="topbar__search">
        <div className="searchbox">
          <Icon name="search" size={13} />
          <input
            type="search"
            value=""
            readOnly
            disabled
            aria-label="搜索"
            placeholder="搜索（M2 提供）"
            title="搜索功能将在 M2 提供"
          />
        </div>
      </div>

      <div className="topbar__actions">
        {/* ④ 同步胶囊 */}
        <Pill tone={sync.tone} icon={sync.icon} title={sync.title}>
          {sync.label}
        </Pill>

        {/* ⑤ 隐私锁胶囊：未启用隐私锁时不显示（M1 恒不显示） */}

        {/* ⑥ 账户与设置 */}
        <DropdownMenu
          label="账户与设置"
          align="right"
          header={
            <>
              <Avatar username={user.username} size={26} />
              <span>
                {user.username}
                {user.role === "owner" ? " · owner" : ""}
              </span>
            </>
          }
          trigger={<Avatar username={user.username} />}
          items={[
            { id: "settings", label: "设置", icon: "settings", onSelect: onOpenSettings },
            { id: "logout", label: "退出登录", icon: "logout", onSelect: onLogout },
          ]}
        />
      </div>
    </header>
  );
}

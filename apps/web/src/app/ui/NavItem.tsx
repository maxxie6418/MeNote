/**
 * 导航行（components.md §六 `NavItem`）。
 *
 * 三处复用：功能栏的 `NavList`（最近编辑 / 收藏）、笔记本组头、设置页的分类导航。
 * 活动态用 `aria-current`（不是自定义 class），既有样式与"语义不靠颜色"的规则都靠它。
 */
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export interface NavItemProps {
  label: string;
  icon?: IconName;
  /** 右侧计数（如"全部笔记 12"）；不传则不渲染 */
  count?: number;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  /** 禁用时**必须**说明原因（DESIGN.md §6.1） */
  title?: string;
  className?: string;
  children?: ReactNode;
}

export function NavItem({
  label,
  icon,
  count,
  active = false,
  onClick,
  disabled = false,
  title,
  className,
}: NavItemProps) {
  return (
    <button
      type="button"
      className={["nav-item", className].filter(Boolean).join(" ")}
      aria-current={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      <span className="nav-item__label">{label}</span>
      {typeof count === "number" ? <span className="nav-item__count">{count}</span> : null}
    </button>
  );
}

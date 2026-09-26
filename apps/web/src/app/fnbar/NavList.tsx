/**
 * 功能栏导航（components.md §六 `NavList`；原型 `#fnNav`）。
 *
 * 只有两项：最近编辑 / 收藏。两者与笔记本视图**同构**（列表 + 正文双栏），
 * 且**都不含 Memo**（Q8）——Memo 是独立视图，不在条目列表里出现。
 * 加密空间不在这里：它贴底固定，见 `VaultNode`。
 */
import { NavItem } from "../ui/NavItem";
import type { NotesView } from "../../features/notes/views";

export interface NavListProps {
  view: NotesView;
  onViewChange: (view: NotesView) => void;
}

export function NavList({ view, onViewChange }: NavListProps) {
  return (
    <nav className="nav" aria-label="导航">
      <NavItem
        label="最近编辑"
        icon="refresh"
        active={view.kind === "recent"}
        onClick={() => onViewChange({ kind: "recent" })}
      />
      <NavItem
        label="收藏"
        icon="star"
        active={view.kind === "starred"}
        onClick={() => onViewChange({ kind: "starred" })}
      />
    </nav>
  );
}

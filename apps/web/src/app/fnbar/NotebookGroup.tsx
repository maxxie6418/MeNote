/**
 * 笔记本分组（components.md §六 `NotebookGroup`；原型 `.group > .nb-head + ul.tree`）。
 *
 * M2 的边界：文件夹树（`FolderTree` / `FolderNode`）、`+` 菜单（新建文件夹 / 新建表格）、
 * 移动与重命名都在 **M2-3**。这里只落组头：笔记本入口（计数）+ `+` 按钮（禁用并说明原因），
 * 组头本身就是"全部笔记（根目录）"这个视图的入口——M2 的条目都落根目录。
 */
import { IconButton } from "../ui/Controls";
import { NavItem } from "../ui/NavItem";
import type { NotesView } from "../../features/notes/views";

export interface NotebookGroupProps {
  view: NotesView;
  onViewChange: (view: NotesView) => void;
  count: number;
  /** 文件夹树（M2-3 接入）；暂为空 */
  children?: React.ReactNode;
}

export function NotebookGroup({ view, onViewChange, count, children }: NotebookGroupProps) {
  return (
    <div className="fnbar__group">
      <div className="nb-head">
        <NavItem
          label="笔记本"
          icon="folder"
          count={count}
          active={view.kind === "notebook"}
          onClick={() => onViewChange({ kind: "notebook" })}
        />
        <IconButton
          label="新建文件夹 / 表格将在 M2-3 提供"
          icon="plus"
          size={13}
          disabled
        />
      </div>
      {children}
    </div>
  );
}

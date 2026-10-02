/**
 * 笔记本分组的 `+` 菜单（components.md §六 `NbAddButton`；功能拆解 M2-3，v0.6.16 加两项）。
 *
 * 三项目：**新建文件夹**（M2-3）、**新建表格**（M4 交付表格编辑器，但入口一直挂着"M5 提供"的
 * 过期理由且 `TableColumnManager` 的 `mode="create"` 从无调用方——v0.6.16 接线）、
 * **导入笔记**（v0.6.16：多选 `.md`，各建一条）。
 *
 * 无障碍名如实列出三项（触发器只有一颗 `+`，名字得说清它管什么）。
 *
 * 放在 `features/notes/`：功能栏只是容器，由 `App` 作为插槽传进去。
 */
import { Icon } from "../../../app/ui/Icon";
import { DropdownMenu } from "../../../app/ui/Menu";

export interface NbAddButtonProps {
  onCreateFolder: () => void;
  /** 新建表格：先弹列定义面板，定义完才建条目（`TableColumnManager` 的 `mode="create"`） */
  onCreateTable: () => void;
  /** 导入笔记：唤起系统文件选择器（可多选 `.md`） */
  onImportNotes: () => void;
}

export function NbAddButton({ onCreateFolder, onCreateTable, onImportNotes }: NbAddButtonProps) {
  return (
    <DropdownMenu
      label="新建文件夹 / 表格 / 导入笔记"
      showChevron={false}
      trigger={<Icon name="plus" size={13} />}
      items={[
        { id: "folder", label: "新建文件夹", icon: "folder", onSelect: onCreateFolder },
        { id: "table", label: "新建表格", icon: "table", onSelect: onCreateTable },
        { id: "import", label: "导入笔记", icon: "import", onSelect: onImportNotes },
      ]}
    />
  );
}

/**
 * 笔记本分组的 `+` 菜单（components.md §六 `NbAddButton`；功能拆解 M2-3）。
 *
 * 两项目：**新建文件夹**（M2-3 可用）、**新建表格**（M2 只占位 → 禁用并说明原因，
 * DESIGN.md §6.1 不给"点了没反应"的空按钮）。
 *
 * 放在 `features/notes/`：功能栏只是容器，由 `App` 作为插槽传进去。
 */
import { Icon } from "../../../app/ui/Icon";
import { DropdownMenu } from "../../../app/ui/Menu";

export interface NbAddButtonProps {
  onCreateFolder: () => void;
}

export function NbAddButton({ onCreateFolder }: NbAddButtonProps) {
  return (
    <DropdownMenu
      label="新建文件夹 / 表格"
      showChevron={false}
      trigger={<Icon name="plus" size={13} />}
      items={[
        { id: "folder", label: "新建文件夹", icon: "folder", onSelect: onCreateFolder },
        {
          id: "table",
          label: "新建表格",
          icon: "table",
          disabled: true,
          title: "表格将在 M5 提供",
          onSelect: () => undefined,
        },
      ]}
    />
  );
}

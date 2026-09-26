/**
 * 笔记本树（components.md §六 `FolderTree` / `FolderNode`；需求 §4.5 两层限制）。
 *
 * 两条硬约束：
 * 1. **最多两层**——第 2 层文件夹**不提供"新建子文件夹"入口**（不是禁用，而是该位置永远没有
 *    合法动作，所以根本不出现）；
 * 2. 节点上带条目计数，一眼看出每个文件夹里有多少条。
 *
 * 放在 `features/notes/`（不是 `app/fnbar/`）：功能栏只是容器，由 `App` 把本组件作为插槽传进去，
 * 这样 `app/` 不反向依赖具体 feature（架构 §2.3.3 的依赖方向）。
 */
import type { LocalFolder } from "../../../data/db";
import { Icon } from "../../../app/ui/Icon";

export interface FolderTreeProps {
  folders: readonly LocalFolder[];
  /** 当前选中的文件夹（null = 根目录） */
  selectedId: string | null;
  onSelect: (folderId: string) => void;
  /** 每个文件夹直接包含的条目数 */
  counts: Readonly<Record<string, number>>;
}

export function FolderTree({ folders, selectedId, onSelect, counts }: FolderTreeProps) {
  const roots = folders.filter((folder) => folder.parent_id === null);
  const childrenOf = (parentId: string): LocalFolder[] =>
    folders
      .filter((folder) => folder.parent_id === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

  return (
    <ul className="tree">
      {roots.map((folder) => (
        <li key={folder.id}>
          <FolderNode
            folder={folder}
            active={selectedId === folder.id}
            count={counts[folder.id] ?? 0}
            onSelect={onSelect}
          />
          <div className="tree__children">
            {childrenOf(folder.id).map((child) => (
              <FolderNode
                key={child.id}
                folder={child}
                active={selectedId === child.id}
                count={counts[child.id] ?? 0}
                onSelect={onSelect}
              />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

interface FolderNodeProps {
  folder: LocalFolder;
  active: boolean;
  count: number;
  onSelect: (folderId: string) => void;
}

function FolderNode({ folder, active, count, onSelect }: FolderNodeProps) {
  return (
    <button
      type="button"
      className="tree-row"
      aria-current={active}
      onClick={() => onSelect(folder.id)}
    >
      <Icon name="folder" size={13} />
      <span className="nav-item__label">{folder.name}</span>
      {folder.pending ? <span className="nav-item__count">待上传</span> : null}
      <span className="nav-item__count">{count}</span>
    </button>
  );
}

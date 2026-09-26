/**
 * 笔记本面板（功能栏里的笔记本分组；components.md 的 `NotebookGroup` + `FolderTree` +
 * `NbAddButton` 三个名字在这里组合成一块，由 `App` 作为插槽交给 `FnBar`）。
 *
 * 为什么整块放在 features 而不是 app：功能栏是通用容器（app 层），而"文件夹"是 notes 这个
 * feature 的数据；`app/` 不反向依赖 feature（架构 §2.3.3 的依赖方向）。
 *
 * 三点行为约定：
 * 1. **两层限制**：第 2 层文件夹不出现"新建子文件夹"入口（`canCreateChildFolder`）；点击 `+`
 *    时若当前选中的是第 2 层文件夹，则在其父层创建（不会产生第 3 层）。
 * 2. **命名内联**：新建时不弹窗，直接在树顶插一行输入框——Enter 确认、Esc 取消，
 *    空名字或取消则不创建（不做"先建后改名"的空文件夹）。
 * 3. 计数带在节点上，`待上传` 标记直接来自本地 pending 状态。
 */
import { useState } from "react";
import type { LocalFolder } from "../../../data/db";
import { NavItem } from "../../../app/ui/NavItem";
import { FolderTree } from "./FolderTree";
import { NbAddButton } from "./NbAddButton";
import { canCreateChildFolder, type NotesView } from "../views";

export interface NotebookPanelProps {
  view: NotesView;
  onViewChange: (view: NotesView) => void;
  folders: readonly LocalFolder[];
  counts: Readonly<Record<string, number>>;
  onCreateFolder: (name: string, parentId: string | null) => Promise<void>;
}

export function NotebookPanel({
  view,
  onViewChange,
  folders,
  counts,
  onCreateFolder,
}: NotebookPanelProps) {
  const [creatingIn, setCreatingIn] = useState<{ parentId: string | null } | null>(null);
  const [draftName, setDraftName] = useState("");

  const selectedFolderId = view.kind === "notebook" ? (view.folderId ?? null) : null;
  const totalCount = Object.values(counts).reduce((sum, value) => sum + value, 0);

  /** 新建位置：选中的是第 1 层 → 建在它下面（第 2 层）；选中的是第 2 层 → 建在它的父层 */
  function beginCreate(): void {
    const selected = folders.find((folder) => folder.id === selectedFolderId) ?? null;
    if (selected && !canCreateChildFolder(selected)) {
      setCreatingIn({ parentId: selected.parent_id });
      setDraftName("");
      return;
    }
    setCreatingIn({ parentId: selected?.id ?? null });
    setDraftName("");
  }

  async function confirmCreate(): Promise<void> {
    const name = draftName.trim();
    const parentId = creatingIn?.parentId ?? null;
    setCreatingIn(null);
    setDraftName("");
    if (name === "") return;
    await onCreateFolder(name, parentId);
  }

  return (
    <div className="fnbar__group">
      <div className="nb-head">
        <NavItem
          label="笔记本"
          icon="folder"
          count={totalCount}
          active={view.kind === "notebook" && selectedFolderId === null}
          onClick={() => onViewChange({ kind: "notebook", folderId: null })}
        />
        <NbAddButton onCreateFolder={beginCreate} />
      </div>

      {creatingIn ? (
        <div className="tree__new">
          <input
            className="tree__input"
            aria-label="新文件夹名称"
            value={draftName}
            autoFocus
            placeholder="文件夹名称"
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void confirmCreate();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setCreatingIn(null);
                setDraftName("");
              }
            }}
            onBlur={() => {
              void confirmCreate();
            }}
          />
        </div>
      ) : null}

      <FolderTree
        folders={folders}
        selectedId={selectedFolderId}
        counts={counts}
        onSelect={(folderId) => onViewChange({ kind: "notebook", folderId })}
      />
    </div>
  );
}

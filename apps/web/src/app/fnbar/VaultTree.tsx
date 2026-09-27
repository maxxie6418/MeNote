/**
 * 空间内文件夹树（M3-6；挂在加密空间节点下方，与笔记本分组同一套 `FolderTree`）。
 *
 * 与笔记本的差别只有两点：
 * 1. 只显示**空间内**的子夹（空间根自己不出现在树里，它就是空间本身）；
 * 2. 新建出来的文件夹带 `in_enc_space` 标记（`createVaultFolder` 负责），
 *    于是它天然只在空间里可见。
 *
 * 两层限制与"非法入口不出现"的规则完全照搬笔记本：第 2 层不提供"新建子文件夹"。
 */
import { useState } from "react";
import type { LocalFolder } from "../../data/db";
import { FolderTree } from "../../features/notes/ui/FolderTree";
import { FolderRenameModal } from "../../features/notes/ui/FolderRenameModal";
import { canCreateChildFolder } from "../../features/notes/folders";

export interface VaultTreeProps {
  folders: readonly LocalFolder[];
  counts: Readonly<Record<string, number>>;
  /** 当前选中的空间内文件夹（`null` = 空间根） */
  selectedId: string | null;
  onSelect: (folderId: string | null) => void;
  onCreateFolder: (name: string, parentId: string | null) => Promise<void>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
}

export function VaultTree({
  folders,
  counts,
  selectedId,
  onSelect,
  onCreateFolder,
  onRenameFolder,
}: VaultTreeProps) {
  const [creatingIn, setCreatingIn] = useState<{ parentId: string | null } | null>(null);
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState<LocalFolder | null>(null);

  async function confirmCreate(): Promise<void> {
    const trimmed = draftName.trim();
    const parentId = creatingIn?.parentId ?? null;
    setCreatingIn(null);
    setDraftName("");
    if (trimmed === "") return;
    await onCreateFolder(trimmed, parentId);
  }

  /** 新建位置：与笔记本同规则（选中第 1 层 → 建在它下面；第 2 层没有入口） */
  function beginCreate(parent: LocalFolder | null): void {
    if (parent && !canCreateChildFolder(parent)) {
      setCreatingIn({ parentId: parent.parent_id });
    } else {
      setCreatingIn({ parentId: parent?.id ?? null });
    }
    setDraftName("");
  }

  return (
    <div className="fnbar__group">
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
            onBlur={() => void confirmCreate()}
          />
        </div>
      ) : null}

      <FolderTree
        folders={folders}
        selectedId={selectedId}
        counts={counts}
        onSelect={onSelect}
        onRename={(folder) => setRenaming(folder)}
        onMove={() => undefined}
        onCreateChild={(folder) => beginCreate(folder)}
      />

      <button type="button" className="link" onClick={() => beginCreate(null)}>
        新建空间内文件夹
      </button>

      {renaming ? (
        <FolderRenameModal
          key={renaming.id}
          folder={renaming}
          onClose={() => setRenaming(null)}
          onRename={onRenameFolder}
        />
      ) : null}
    </div>
  );
}

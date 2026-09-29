/**
 * 空间内文件夹树（M3-6 建；**2026-09-29 从功能栏搬进加密空间视图**）。
 *
 * 为什么搬：用户 2026-09-29 要求"加密空间不需要在功能栏显示文件夹树"——功能栏那条贴底节点
 * 从此只作**入口**；而空间内的文件夹（切到某一层 / 新建 / 重命名）总得有个地方，
 * 就落在**加密空间视图的列表列**里，渲染在列表的滚动区内（不新增第二个滚动容器，`DESIGN.md` §2.7）。
 *
 * 与笔记本树的差别只有两点：
 * 1. 只显示**空间内**的子夹（空间根自己不出现在树里，它就是空间本身）；
 * 2. 新建出来的文件夹带 `in_enc_space` 标记（`createVaultFolder` 负责），
 *    于是它天然只在空间里可见。
 *
 * 两层限制与"非法入口不出现"的规则完全照搬笔记本：第 2 层不提供"新建子文件夹"。
 * 文件落在 `features/privacy/`（而不是 `app/fnbar/`）：它现在属于空间自己的那一屏。
 */
import { useState } from "react";
import type { LocalFolder } from "../../../data/db";
import { FolderTree } from "../../notes/ui/FolderTree";
import { FolderRenameModal } from "../../notes/ui/FolderRenameModal";
import { canCreateChildFolder } from "../../notes/folders";

export interface VaultTreeProps {
  /** 空间根 id：空间内**第 1 层**文件夹的 `parent_id` 就是它（`FolderTree` 靠它认根） */
  rootId: string;
  folders: readonly LocalFolder[];
  counts: Readonly<Record<string, number>>;
  /** 当前选中的空间内文件夹（`null` = 空间根） */
  selectedId: string | null;
  onSelect: (folderId: string | null) => void;
  onCreateFolder: (name: string, parentId: string | null) => Promise<void>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
}

export function VaultTree({
  rootId,
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
    <div className="vaulttree">
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
        rootId={rootId}
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

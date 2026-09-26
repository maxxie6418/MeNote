/**
 * 笔记本面板（功能栏里的笔记本分组；components.md 的 `NotebookGroup` + `FolderTree` +
 * `NbAddButton` 三个名字在这里组合成一块，由 `App` 作为插槽交给 `FnBar`）。
 *
 * 为什么整块放在 features 而不是 app：功能栏是通用容器（app 层），而"文件夹"是 notes 这个
 * feature 的数据；`app/` 不反向依赖 feature（架构 §2.3.3 的依赖方向）。
 *
 * 四个交互：
 * 1. **新建**：`+` 菜单 → 树顶插一行输入框，Enter 确认 / Esc 取消 / 空名不创建；
 *    选中第 2 层时新夹建在**它的父层**，因此界面上不可能产生第 3 层。
 * 2. **重命名**：弹窗输入（走 `meta_rev`，多设备并发改名以后写为准、不生成冲突副本 —— Q12）。
 * 3. **移动到…**：弹窗列出候选目标，**非法目标置灰并写明原因**（移到自己子夹、会超过两层、
 *    下面还有子文件夹），与服务端校验口径一致。
 * 4. 计数与 `待上传` 标记直接来自本地状态。
 */
import { useState } from "react";
import type { LocalFolder } from "../../../data/db";
import { Button } from "../../../app/ui/Controls";
import { Icon } from "../../../app/ui/Icon";
import { Modal } from "../../../app/ui/Modal";
import { NavItem } from "../../../app/ui/NavItem";
import { FolderTree } from "./FolderTree";
import { NbAddButton } from "./NbAddButton";
import { canCreateChildFolder, folderMoveTargets, type MoveTarget } from "../folders";
import type { NotesView } from "../views";

export interface NotebookPanelProps {
  view: NotesView;
  onViewChange: (view: NotesView) => void;
  folders: readonly LocalFolder[];
  counts: Readonly<Record<string, number>>;
  onCreateFolder: (name: string, parentId: string | null) => Promise<void>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onMoveFolder: (folderId: string, parentId: string | null) => Promise<void>;
}

export function NotebookPanel({
  view,
  onViewChange,
  folders,
  counts,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
}: NotebookPanelProps) {
  const [creatingIn, setCreatingIn] = useState<{ parentId: string | null } | null>(null);
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState<{ folder: LocalFolder; name: string } | null>(null);
  const [moving, setMoving] = useState<{ folder: LocalFolder; targets: MoveTarget[] } | null>(null);

  const selectedFolderId = view.kind === "notebook" ? (view.folderId ?? null) : null;
  const totalCount = Object.values(counts).reduce((sum, value) => sum + value, 0);

  /** 新建位置：选中的是第 1 层 → 建在它下面（第 2 层）；选中的是第 2 层 → 建在它的父层 */
  function beginCreate(parent: LocalFolder | null): void {
    if (parent && !canCreateChildFolder(parent)) {
      setCreatingIn({ parentId: parent.parent_id });
    } else {
      setCreatingIn({ parentId: parent?.id ?? null });
    }
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
        <NbAddButton
          onCreateFolder={() =>
            beginCreate(folders.find((folder) => folder.id === selectedFolderId) ?? null)
          }
        />
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
        onRename={(folder) => setRenaming({ folder, name: folder.name })}
        onMove={(folder) => setMoving({ folder, targets: folderMoveTargets(folders, folder.id) })}
        onCreateChild={(folder) => beginCreate(folder)}
      />

      <Modal
        open={renaming !== null}
        title="重命名文件夹"
        onClose={() => setRenaming(null)}
        footer={
          <>
            <Button size="sm" onClick={() => setRenaming(null)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={(renaming?.name.trim() ?? "") === ""}
              title={(renaming?.name.trim() ?? "") === "" ? "名称不能为空" : undefined}
              onClick={() => {
                const target = renaming;
                setRenaming(null);
                if (target) void onRenameFolder(target.folder.id, target.name.trim());
              }}
            >
              保存
            </Button>
          </>
        }
      >
        <input
          className="field__input"
          aria-label="文件夹名称"
          value={renaming?.name ?? ""}
          onChange={(event) =>
            setRenaming((previous) =>
              previous ? { ...previous, name: event.target.value } : previous,
            )
          }
        />
      </Modal>

      <Modal
        open={moving !== null}
        title="移动文件夹"
        desc={moving ? `把「${moving.folder.name}」移到：` : undefined}
        onClose={() => setMoving(null)}
      >
        <div className="target-list">
          {(moving?.targets ?? []).map((target) => (
            <button
              key={target.parentId ?? "root"}
              type="button"
              className="target-list__item"
              disabled={!target.allowed}
              title={target.allowed ? undefined : target.reason}
              onClick={() => {
                setMoving(null);
                if (moving) void onMoveFolder(moving.folder.id, target.parentId);
              }}
            >
              <Icon name={target.parentId ? "folder" : "home"} size={13} />
              {target.name}
              {target.allowed ? null : <span className="nav-item__count">{target.reason}</span>}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

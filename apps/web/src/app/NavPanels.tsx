/**
 * 功能栏两个插槽的组装（M3-6 从 `App.tsx` 抽出，为入口文件的行数预算让位）：
 * 笔记本分组与加密空间节点。
 *
 * 为什么用普通函数返回节点、而不是 hook：两块都不需要自己的状态
 * （`NotebookPanel` / `VaultTree` 各自持有），这里只是"把 workspace 与隐私锁的数据接成 props"。
 * 写成 `use*` 会让"它是不是 hook"变得含糊，反而更容易被误用。
 *
 * `App` 仍然负责决定**行为**（切视图、开解锁框、提示），这里只做装配。
 */
import type { ReactNode } from "react";
import type { NotesWorkspace } from "../features/notes/useNotesWorkspace";
import { NotebookPanel } from "../features/notes/ui/NotebookPanel";
import { isScopeGateOpen, type PrivacyGate } from "@menote/shared";
import { isInVault } from "../features/privacy/vault";
import type { VaultNodeProps } from "./fnbar/VaultNode";
import type { NotesView } from "../features/notes/views";

export interface NavPanelsInput {
  workspace: NotesWorkspace;
  gate: PrivacyGate;
  /** 隐私锁是否已启用（未启用时空间节点置灰） */
  enabled: boolean;
  /** 切笔记视图（会顺带退出浏览三段） */
  onSelectView: (view: NotesView) => void;
  /** 打开解锁框 */
  onUnlock: () => void;
  /** 空间还没同步下来时的提示 */
  onVaultMissing: () => void;
  /** 切到某个空间内文件夹（`null` = 空间根） */
  onOpenVaultFolder: (folderId: string | null) => void;
}

/** 空间视图里当前选中的子夹（空间根算 `null`） */
export function selectedVaultFolderId(
  workspace: NotesWorkspace,
): string | null {
  if (workspace.view.kind !== "notebook") return null;
  const folderId = workspace.view.folderId ?? null;
  if (!folderId || folderId === workspace.vault.id) return null;
  return isInVault(workspace.folders, folderId) ? folderId : null;
}

export function navPanels(input: NavPanelsInput): {
  notebookPanel: ReactNode;
  vault: VaultNodeProps;
} {
  const { workspace, gate, enabled, onSelectView, onUnlock } = input;

  const notebookPanel = (
    <NotebookPanel
      view={workspace.view}
      onViewChange={onSelectView}
      folders={workspace.notebookFolders}
      counts={workspace.notebookCounts}
      onCreateFolder={workspace.createFolder}
      onRenameFolder={workspace.renameFolder}
      onMoveFolder={workspace.moveFolder}
    />
  );

  const vault: VaultNodeProps = {
    enabled,
    locked: !isScopeGateOpen(gate),
    count: workspace.vault.count,
    onUnlock,
    onOpen: () => {
      if (workspace.vault.id) input.onOpenVaultFolder(workspace.vault.id);
      else input.onVaultMissing();
    },
    tree: {
      folders: workspace.vault.folders,
      counts: workspace.folderCounts,
      selectedId: selectedVaultFolderId(workspace),
      onSelect: input.onOpenVaultFolder,
      onCreateFolder: workspace.createVaultFolder,
      onRenameFolder: workspace.renameFolder,
    },
  };

  return { notebookPanel, vault };
}

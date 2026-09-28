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
import type { LocalFolder } from "../data/db";
import { isInVault } from "../features/privacy/vault";
import type { VaultNodeProps } from "./fnbar/VaultNode";
import type { FnBarProps } from "./fnbar/FnBar";
import type { ToastAction } from "./ui/Toast";
import type { NotesView } from "../features/notes/views";

export interface NavPanelsInput {
  workspace: NotesWorkspace;
  gate: PrivacyGate;
  /** 隐私锁是否已启用（未启用时空间节点显示"未启用 · 去启用"） */
  enabled: boolean;
  /** 切笔记视图（会顺带退出浏览三段） */
  onSelectView: (view: NotesView) => void;
  /** 打开解锁框 */
  onUnlock: () => void;
  /** 未启用时点空间节点：去「设置 › 隐私锁」启用（设计 §9.2-② 的"引导启用"） */
  onEnableVault: () => void;
  /** 删除文件夹（M4-12）：连带内容一起进回收站 */
  onDeleteFolder: (folder: LocalFolder) => Promise<void>;
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

export interface FnBarWiringInput {
  workspace: NotesWorkspace;
  view: FnBarProps["view"];
  browseView: FnBarProps["browseView"];
  tags: FnBarProps["tags"];
  showHome: boolean;
  composerMode: FnBarProps["composerMode"];
  notebookPanel: ReactNode;
  vault: VaultNodeProps;
  /** 去笔记区干活（从设置/回收站这类独立页回来）——所有"改笔记区状态"的动作都先走它 */
  goNotes: () => void;
  onViewChange: (view: NotesView) => void;
  /** `null` = 回到笔记双栏（分栏浏览的首页 / Memo / 待办让位） */
  onBrowseChange: (next: FnBarProps["browseView"] | null) => void;
  onComposerModeChange: FnBarProps["onComposerModeChange"];
  toast: (message: string, tone: "success" | "warn" | "error", action?: ToastAction) => void;
}

/**
 * 功能栏的 props 组装（M4 QA 修复时从 `App.tsx` 抽出：那里已经顶到 500 行的预算）。
 *
 * 抽出来的另一个实际好处：**"从独立页回到笔记区"这条规则只在这里出现一次**——
 * 新建、发布、切视图、切分栏浏览，四个动作都要先把路由拉回去，写在四处迟早漏一处。
 * 返回类型直接用 `FnBarProps`，所以字段名与 FnBar 的约定永远一致。
 */
export function fnbarWiring(input: FnBarWiringInput): FnBarProps {
  const { workspace, goNotes, toast } = input;
  /*
    「笔记」档的落点提示：与 `createNote` 的判定**同一口径**——只有「笔记本」视图有笔记本上下文，
    最近编辑 / 收藏 / 标签落根目录。这里只负责显示，写入路径在 `useNoteCreation`。
  */
  const noteFolderId = input.view.kind === "notebook" ? (input.view.folderId ?? null) : null;
  const noteTargetLabel = noteFolderId
    ? (workspace.folders.find((folder) => folder.id === noteFolderId)?.name ?? "根目录")
    : "根目录";

  /**
   * 切分栏浏览（首页 / Memo / 待办）：`null` = 回到笔记双栏。
   * 三个发布动作都要先走它——**快捷输入发布后要能看到结果**（新建笔记进编辑界面、
   * Memo 去 Memo、待办去待办），不能让人停在原来的屏上猜"刚才那条去哪了"。
   */
  const showBrowse = (next: FnBarProps["browseView"] | null): void => {
    goNotes();
    input.onBrowseChange(next);
  };

  return {
    onNewNote: () => {
      // 新建后**直接进它的编辑界面**：先让分栏浏览让位，否则停在首页/待办上根本看不到编辑器
      showBrowse(null);
      void workspace.createNote();
    },
    onPublishNote: (title, body) => {
      showBrowse(null);
      // 轻提示带"打开这一篇"（便利入口，不是必须动作——内容已经存好了，见 `ui/Toast.tsx` 的界定）
      void workspace.createNote({ title, body }).then((id) => {
        toast("已新建笔记", "success", {
          label: "打开这一篇",
          onClick: () => {
            showBrowse(null);
            void workspace.open(id);
          },
        });
      });
    },
    onPublishMemo: (text, options) => {
      goNotes();
      // 乐观发布：条目先落本地并标"待上传"，由 outbox 后台上传
      void workspace.publishMemo(text, options);
      toast("已记录", "success", {
        label: "去 Memo",
        onClick: () => showBrowse("memo"),
      });
    },
    onPublishTask: (text, options) => {
      goNotes();
      void workspace.publishMemo(text, { asTask: true, ...options });
      toast("已加入待办", "success", {
        label: "去待办",
        onClick: () => showBrowse("task"),
      });
    },
    view: input.view,
    onViewChange: input.onViewChange,
    tags: input.tags,
    browseView: input.browseView,
    onBrowseChange: (next) => showBrowse(next ?? null),
    showHome: input.showHome,
    composerMode: input.composerMode,
    onComposerModeChange: input.onComposerModeChange,
    noteTargetLabel,
    notebookPanel: input.notebookPanel,
    vault: input.vault,
  };
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
      vault={{
        enabled,
        locked: !isScopeGateOpen(gate),
        isInVault: (folder) => isInVault(workspace.folders, folder.id),
        // 两层限制：只有第 1 层、且**没有子文件夹**（否则移进去会超过两层）才允许整夹移入
        canMoveIn: (folder) =>
          folder.depth === 1 && !workspace.folders.some((row) => row.parent_id === folder.id),
        moveInReason: "只有第 1 层、且没有子文件夹的文件夹能整夹移入（移入后仍守两层限制）",
        onMoveIn: (folder, onProgress) => workspace.moveFolderToVault(folder.id, { onProgress }),
        onMoveOut: (folder, onProgress) =>
          workspace.moveFolderOutOfVault(folder.id, { onProgress }),
      }}
      onDeleteFolder={input.onDeleteFolder}
    />
  );

  const vault: VaultNodeProps = {
    enabled,
    locked: !isScopeGateOpen(gate),
    count: workspace.vault.count,
    onUnlock,
    onEnable: input.onEnableVault,
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

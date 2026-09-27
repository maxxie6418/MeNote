/**
 * 笔记视图（列表 + 正文双栏）在组合根里的接线（M3-7 从 `App.tsx` 抽出，为入口文件的行数预算让位）。
 *
 * 这里集中两件容易散掉的事：
 * 1. **正文区按条目 id 重挂载**（`key`）——否则切换条目会沿用上一篇的文本；
 * 2. **单篇加密的四个动作**（加密此篇 / 取消加密 / 锁上此篇 / 锁上全部单篇）与它们的可用性说明，
 *    都来自隐私锁组装层，界面只负责呈现原因（禁用必须带 `title`）。
 */
import type { PrivacyGate } from "@menote/shared";
import type { NotesWorkspace } from "../../features/notes/useNotesWorkspace";
import type { DocMode } from "../../features/notes/ui/NoteWorkspace";
import { NoteList } from "../../features/notes/ui/NoteList";
import { NoteWorkspace } from "../../features/notes/ui/NoteWorkspace";
import { TwoPane } from "./TwoPane";

export interface NotesPaneProps {
  workspace: NotesWorkspace;
  /** 默认编辑模式（来自设置） */
  editorMode: DocMode;
  encryption: {
    enabled: boolean;
    gate: PrivacyGate;
    unlockedCount: number;
    onRequestUnlock: () => void;
    onLockItem: (itemId: string) => void;
    onLockAllItems: () => void;
  };
  /** 单篇加密开关的落地（含成功/失败提示） */
  onToggleEncryption: (itemId: string, encrypted: boolean) => void;
  onToast: (message: string, tone: "success" | "error") => void;
}

export function NotesPane({
  workspace,
  editorMode,
  encryption,
  onToggleEncryption,
  onToast,
}: NotesPaneProps) {
  const selected = workspace.selected;

  return (
    <TwoPane
      list={
        <NoteList
          items={workspace.items}
          title={workspace.viewTitle}
          selectedId={workspace.selectedId}
          loading={workspace.loading}
          summaries={workspace.summaries}
          folders={workspace.folders}
          onSelect={(id) => {
            void workspace.open(id);
          }}
          onNewNote={() => {
            void workspace.createNote();
          }}
          onMove={(id, folderId) => {
            void workspace.moveItemToFolder(id, folderId);
          }}
          onTogglePinned={(id) => {
            void workspace.togglePinned(id);
          }}
          onToggleStarred={(id) => {
            void workspace.toggleStarred(id);
          }}
        />
      }
      doc={
        /* key 用条目 id：切换条目必须重挂载正文区，否则新条目会沿用上一篇的文本 */
        <NoteWorkspace
          key={workspace.selectedId ?? "none"}
          item={selected}
          initialBody={workspace.initialBody}
          snapshot={workspace.snapshot}
          initialMode={editorMode}
          remoteChanged={workspace.remoteChanged}
          conflict={workspace.conflictCopy}
          onOpenConflictCopy={() => {
            void workspace.openConflictCopy();
          }}
          onResolveConflict={(keep) => {
            void workspace.resolveConflict(keep).then(() => {
              onToast(keep === "mine" ? "已保留你的版本" : "已保留服务端版本", "success");
            });
          }}
          onReload={() => {
            void workspace.reloadSelected();
          }}
          onInput={workspace.input}
          onTitleChange={(title) => {
            void workspace.changeTitle(title);
          }}
          encryption={{
            enabled: encryption.enabled,
            encrypted: selected?.enc_self === 1,
            unlocked: selected != null && encryption.gate.unlockedItems.has(selected.id),
            unlockedCount: encryption.unlockedCount,
            onUnlock: encryption.onRequestUnlock,
            onLock: () => {
              if (workspace.selectedId) encryption.onLockItem(workspace.selectedId);
            },
            onToggle: (next) => {
              if (!workspace.selectedId) return;
              if (next && !encryption.enabled) return;
              onToggleEncryption(workspace.selectedId, next);
            },
            onLockAll: encryption.onLockAllItems,
          }}
        />
      }
    />
  );
}

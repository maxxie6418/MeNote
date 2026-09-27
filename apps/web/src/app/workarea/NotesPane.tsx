/**
 * 笔记视图（列表 + 正文双栏）在组合根里的接线（M3-7 从 `App.tsx` 抽出，为入口文件的行数预算让位）。
 *
 * 这里集中两件容易散掉的事：
 * 1. **正文区按条目 id 重挂载**（`key`）——否则切换条目会沿用上一篇的文本；
 * 2. **单篇加密的四个动作**（加密此篇 / 取消加密 / 锁上此篇 / 锁上全部单篇）与它们的可用性说明，
 *    都来自隐私锁组装层，界面只负责呈现原因（禁用必须带 `title`）。
 */
import type { PrivacyGate } from "@menote/shared";
import { useState } from "react";
import { Button } from "../ui/Controls";
import { Modal } from "../ui/Modal";
import { moveToTrash, undoTrash } from "../../features/trash/useTrash";
import { restoreNotice } from "../../features/trash/model";
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
  /** 提示条：破坏性操作成功后用警告态（`DESIGN.md` §6.6） */
  onToast: (message: string, tone: "success" | "warn" | "error") => void;
  /** 加密空间的移入/移出（M3-8）；锁定时内部层级为空，只能入根 */
  vault: {
    enabled: boolean;
    locked: boolean;
    id: string | null;
    folders: ReadonlyArray<{ id: string; name: string }>;
    onMoveIn: (itemId: string, folderId: string | null) => void;
    onMoveOut: (itemId: string) => void;
  };
  /** 状态栏里的隐私锁那一句（M3-10，设计 §9.2-④） */
  privacyLine?: {
    text: string;
    expiresAt: number | null;
    onLock?: () => void;
    lockLabel?: string;
  } | null;
}

export function NotesPane({
  workspace,
  editorMode,
  encryption,
  privacyLine,
  onToggleEncryption,
  onToast,
  vault,
}: NotesPaneProps) {
  const selected = workspace.selected;
  /** 待确认删除的条目 id（确认框在下方渲染；列表行只报事件） */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  /** 删除后的可撤销提示（面板提示，不是轻提示——见 NoteList 的注释） */
  const [undoNotice, setUndoNotice] = useState<{
    message: string;
    actionLabel: string;
    onAction: () => void;
  } | null>(null);
  const pendingTitle =
    workspace.allItems.find((item) => item.id === pendingDelete)?.title ??
    workspace.selected?.title ??
    "这条内容";

  return (
    <>
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
          vault={vault}
          unlockedItemIds={encryption.gate.unlockedItems}
          onDelete={(id) => setPendingDelete(id)}
          notice={undoNotice}
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
          privacyLine={privacyLine}
          onDelete={() => setPendingDelete(workspace.selectedId)}
        />
      }
      />

      {/* 删除确认（M4-12）：写明去向、保留期与可恢复性；破坏性操作必须二次确认（DESIGN.md §6.5） */}
      <Modal
        open={pendingDelete !== null}
        title="删除"
        desc={`「${pendingTitle}」将移入回收站，保留 30 天，可在回收站恢复。`}
        onClose={() => setPendingDelete(null)}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                const id = pendingDelete;
                setPendingDelete(null);
                if (!id) return;
                void moveToTrash(id)
                  .then(async () => {
                    await workspace.refresh();
                    onToast(`「${pendingTitle}」已移入回收站，30 天内可恢复`, "warn");
                    // 「撤销」放进面板提示（轻提示不承载需要用户行动的信息，DESIGN.md §6.6）
                    setUndoNotice({
                      message: `「${pendingTitle}」已移入回收站`,
                      actionLabel: "撤销",
                      onAction: () => {
                        setUndoNotice(null);
                        void undoTrash(id)
                          .then(async (result) => {
                            await workspace.refresh();
                            onToast(restoreNotice(result.folderId === null), "success");
                          })
                          .catch((error: unknown) => {
                            onToast(
                              error instanceof Error ? error.message : "撤销失败，请在回收站里恢复",
                              "error",
                            );
                          });
                      },
                    });
                  })
                  .catch((error: unknown) => {
                    onToast(error instanceof Error ? error.message : "删除失败，请稍后重试", "error");
                  });
              }}
            >
              移入回收站
            </Button>
          </>
        }
      >
        <p>删除后这一篇会从列表里消失；在回收站里可以在 30 天内恢复。</p>
      </Modal>
    </>
  );
}

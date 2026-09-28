/**
 * 笔记视图（列表 + 正文双栏）在组合根里的接线（M3-7 从 `App.tsx` 抽出，为入口文件的行数预算让位）。
 *
 * 这里集中两件容易散掉的事：
 * 1. **正文区按条目 id 重挂载**（`key`）——否则切换条目会沿用上一篇的文本；
 * 2. **单篇加密的四个动作**（加密此篇 / 取消加密 / 锁上此篇 / 锁上全部单篇）与它们的可用性说明，
 *    都来自隐私锁组装层，界面只负责呈现原因（禁用必须带 `title`）。
 */
import type { PrivacyGate } from "@menote/shared";
import { useCallback, useMemo, useState } from "react";
import { Button } from "../ui/Controls";
import { Modal } from "../ui/Modal";
import { moveToTrash, undoTrash } from "../../features/trash/useTrash";
import { restoreNotice } from "../../features/trash/model";
import type { NotesWorkspace } from "../../features/notes/useNotesWorkspace";
import type { DocMode } from "../../features/notes/ui/NoteWorkspace";
import { NoteList } from "../../features/notes/ui/NoteList";
import { groupNotesByFolder } from "../../features/notes/groups";
import { NoteWorkspace } from "../../features/notes/ui/NoteWorkspace";
import { VersionHistoryPanel } from "../../features/versions/ui/VersionHistoryPanel";
import { useVersions } from "../../features/versions/useVersions";
import { useAttachments } from "../../features/attachments/useAttachments";
import { LEFTOVER_HINT } from "../../features/attachments/model";
import type { EditorHandle } from "../editor/Editor";
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
  /** 版本历史面板（M4-11）：打开时占满主操作区（界面稿 §4.1：弹窗宽度装不下并排 diff） */
  const [versionsOpen, setVersionsOpen] = useState(false);
  const versions = useVersions((notice) => onToast(notice.message, notice.tone));
  /** 编辑器句柄（M4-10：附件占位与最终片段都要改正文） */
  const [editorHandle, setEditorHandle] = useState<EditorHandle | null>(null);
  const attachments = useAttachments({
    itemId: workspace.selectedId,
    handle: editorHandle,
    notify: (message, tone) => onToast(message, tone),
  });
  const pendingTitle =
    workspace.allItems.find((item) => item.id === pendingDelete)?.title ??
    workspace.selected?.title ??
    "这条内容";

  /** 当前选中的笔记本（`null` = 全部笔记 / 非笔记本视图）；分组与"隐藏顶层组头"都用它 */
  const selectedNotebookId =
    workspace.view.kind === "notebook" ? (workspace.view.folderId ?? null) : null;

  /*
    按文件夹分组（B2 批）：只在「笔记本」视图算（最近编辑 / 收藏 / 标签 / 搜索保持扁平——
    那几个视图没有笔记本上下文）。**必须 `useMemo`**：`groups` 的身份进 `NoteList` 的 props
    浅比较，每次渲染新建数组就等于把整张列表的 `memo` 废掉（2026-09-27 性能修复盯的就是这个）。
  */
  const noteGroups = useMemo(() => {
    if (workspace.view.kind !== "notebook") return undefined;
    const rootFolderId = workspace.view.folderId ?? null;
    return groupNotesByFolder(
      workspace.items,
      workspace.folders,
      rootFolderId ? { rootFolderId } : {},
    );
  }, [workspace.view, workspace.items, workspace.folders]);

  /*
    传给列表的动作**必须身份稳定**：`NotesPane` 每次渲染都重跑（编辑器每敲一个字都会经
    `workspace` 换身份走到这里），内联箭头会让 `NoteRow` 的 `memo` 全部失效 ——
    2000 篇的库里，那就等于**每次交互一条 130–230ms 的主线程长任务**（2026-09-27 实测）。

    先把要用的动作从 `workspace` 里取出来（它们是 `useNotesWorkspace` 做过身份稳定化的），
    再 `useCallback` 包一层：依赖里只写这些函数本身，而**不能写 `workspace`**（它每次渲染换身份）。
  */
  const { createNote, moveItemToFolder, open, togglePinned, toggleStarred } = workspace;

  const handleSelect = useCallback(
    (id: string) => {
      void open(id);
    },
    [open],
  );
  const handleNewNote = useCallback(() => {
    void createNote();
  }, [createNote]);
  const handleMove = useCallback(
    (id: string, folderId: string | null) => {
      void moveItemToFolder(id, folderId);
    },
    [moveItemToFolder],
  );
  const handleTogglePinned = useCallback(
    (id: string) => {
      void togglePinned(id);
    },
    [togglePinned],
  );
  const handleToggleStarred = useCallback(
    (id: string) => {
      void toggleStarred(id);
    },
    [toggleStarred],
  );
  const handleDelete = useCallback((id: string) => setPendingDelete(id), []);

  /** 加密空间那一组 props 同样是行的 `memo` 比较项，整体 memo 成稳定引用 */
  const vaultForRows = useMemo(
    () => ({
      enabled: vault.enabled,
      locked: vault.locked,
      id: vault.id,
      folders: vault.folders,
      onMoveIn: vault.onMoveIn,
      onMoveOut: vault.onMoveOut,
    }),
    [vault.enabled, vault.folders, vault.id, vault.locked, vault.onMoveIn, vault.onMoveOut],
  );

  return (
    <>
      {versionsOpen && selected ? (
        <VersionHistoryPanel
          itemTitle={selected.title ?? "（无标题）"}
          rows={versions.rows}
          loading={versions.loading}
          bodyLoading={versions.bodyLoading}
          bodies={versions.bodies}
          currentBody={workspace.initialBody}
          busy={versions.busy}
          onClose={() => {
            setVersionsOpen(false);
            versions.reset();
          }}
          onOpenVersion={(versionId) => void versions.openVersion(versionId)}
          onSeal={(label) => void versions.seal(label)}
          onToggleKeep={(versionId, keep) => void versions.toggleKeep(versionId, keep)}
          onRestore={(versionId) =>
            void versions.restore(versionId).then(() => {
              // 恢复改了正文与派生列：正文区要重新读一次（设计 §4.4 第 2 步）
              void workspace.reloadSelected();
            })
          }
        />
      ) : (
      <TwoPane
      list={
        <NoteList
          items={workspace.items}
          title={workspace.viewTitle}
          path={workspace.viewPath}
          groups={noteGroups}
          hideGroupRootHeader={selectedNotebookId !== null}
          selectedId={workspace.selectedId}
          loading={workspace.loading}
          summaries={workspace.summaries}
          folders={workspace.folders}
          onSelect={handleSelect}
          onNewNote={handleNewNote}
          onMove={handleMove}
          onTogglePinned={handleTogglePinned}
          onToggleStarred={handleToggleStarred}
          vault={vaultForRows}
          unlockedItemIds={encryption.gate.unlockedItems}
          onDelete={handleDelete}
          notice={undoNotice}
        />
      }
      doc={
        workspace.docLoading ? (
          /*
            **正文还没到：只给占位，不挂正文区**（B 步：把"选中"与"读正文"解耦）。
            - 点下去的那一帧，列表行高亮已经在 `open()` 的同步阶段落好了——用户先看到"点到了"；
            - 不把上一篇的正文与标题留在屏上：那会让人以为"点了没反应"，甚至对着旧内容敲字
              （旧编辑器此刻会被卸载，它的自动保存定时器也停了）。
            文案沿用正文区既有的占位口径（`docpane__center`，与编辑器的 Suspense 兜底同一处）。
          */
          <div className="docpane">
            <div className="docpane__center">正在打开…</div>
          </div>
        ) : (
          /*
            key 用 **条目 id + 正文代数**：切换条目必须重挂载（否则新条目会沿用上一篇的文本）；
            同一篇"按最新内容重新载入"时 id 不变、`docEpoch` 会 +1，同样重挂一次，
            从而真的拿到新正文（此前 id 不变就不重挂，编辑器里还是旧内容）。
          */
          <NoteWorkspace
            key={`${workspace.selectedId ?? "none"}:${workspace.docEpoch}`}
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
          attachments={
            attachments.statusLabel === ""
              ? null
              : {
                  label: attachments.statusLabel,
                  tone: attachments.statusTone ?? "busy",
                  // 只有**实时队列**里的失败能就地重试（文件还在手上）；
                  // 上次留下的未完成项要重新选文件，所以给的是说明而不是一个点了没用的按钮
                  onRetry:
                    attachments.failedCount > 0 ? () => void attachments.retry() : undefined,
                  hint:
                    attachments.failedCount === 0 && attachments.leftoverCount > 0
                      ? LEFTOVER_HINT
                      : undefined,
                }
          }
          onFiles={(files) => void attachments.add(files)}
          attachmentsMeta={attachments.known}
          onEditorReady={setEditorHandle}
          onDelete={() => setPendingDelete(workspace.selectedId)}
          onOpenVersions={() => {
            if (!workspace.selectedId) return;
            setVersionsOpen(true);
            void versions.open(workspace.selectedId);
          }}
          // 锁定态下版本入口整体不可用（设计 §4.5：不做"列表可见、内容打码"的中间态）
          versionsDisabledReason={
            selected?.enc_self === 1 && !encryption.gate.unlockedItems.has(selected.id)
              ? "先解锁这一篇，才能看版本历史"
              : undefined
          }
          /*
            「降级为普通笔记」（M4-9）：**需要联网**（直连 API，不走 outbox），
            失败（离线 / 服务端拒绝）要给可见提示，别让按钮点了没反应。
          */
          onDegrade={() => {
            const id = workspace.selectedId;
            if (!id) return;
            void workspace
              .degradeToNote(id)
              .then(() => onToast("已降级为普通笔记；原文已封存为一个版本", "success"))
              .catch((error: unknown) => {
                onToast(error instanceof Error ? error.message : "降级失败，请稍后重试", "error");
              });
          }}
        />
        )
      }
      />
      )}

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

/**
 * 正文区（结构见 `docs/modules/Menote-M1-界面稿-v1.md` §五）。
 *
 * 编辑器与 Markdown 渲染都走**动态 import**（架构 §14.1：编辑器与渲染各自独立分包，不进首屏）。
 * 切换条目由 `key={item.id}` 重新挂载编辑器；切换编辑/预览模式**不重建文档**（架构 §3.3）。
 */
import { Suspense, lazy, useRef, useState } from "react";
import { EmptyDocPanel } from "../../../app/workarea/EmptyDocPanel";
import { Button } from "../../../app/ui/Controls";
import { Modal } from "../../../app/ui/Modal";
import { DropdownMenu, type MenuItemSpec } from "../../../app/ui/Menu";
import { LockedDocPanel } from "../../privacy/ui/LockedDocPanel";
import type { LocalItem } from "../../../data/db";
import type { NoteEditorSnapshot } from "../model";
import { DocStatusBar } from "./DocStatusBar";
import { TitleInput } from "./TitleInput";
import { TableDegradeNotice } from "../../tables/ui/TableDegradeNotice";
import { useTableDoc } from "../../tables/useTableDoc";
import { renderTableDocument } from "@menote/mdcore";
import type { EditorHandle } from "../../../app/editor/Editor";

const Editor = lazy(async () => {
  const mod = await import("../../../app/editor/Editor");
  return { default: mod.Editor };
});

/** 表格界面按需加载（与编辑器同一理由：不进首屏；表格只有表格条目才用得上） */
const TableEditor = lazy(async () => {
  const mod = await import("../../tables/ui/TableEditor");
  return { default: mod.TableEditor };
});

const MarkdownPreview = lazy(async () => {
  const mod = await import("../../../app/editor/MarkdownPreview");
  return { default: mod.MarkdownPreview };
});

export type DocMode = "split" | "edit" | "preview";

const MODE_LABEL: Record<DocMode, string> = {
  split: "分屏",
  edit: "仅编辑",
  preview: "仅预览",
};

export interface NoteWorkspaceProps {
  item: LocalItem | null;
  initialBody: string;
  snapshot: NoteEditorSnapshot | null;
  /** 打开条目时的模式；来自 设置 › 编辑器 › 默认编辑模式（M2-7），之后可手动切换 */
  initialMode?: DocMode;
  /** 这条被别的标签页改过（M2-9）：显示事前提示，避免"以为没冲突" */
  remoteChanged?: boolean;
  /** 这条有冲突副本（M2-9 对比 UI）：显示处理入口 */
  conflict?: { copyId: string; copyTitle: string } | null;
  onOpenConflictCopy?: () => void;
  onResolveConflict?: (keep: "mine" | "server") => void;
  /** 放弃本地改动、按最新内容重新载入 */
  onReload?: () => void;
  onInput: (text: string) => void;
  onTitleChange: (title: string) => void;
  /**
   * 单篇加密（M3-7）。`enabled` = 隐私锁已启用（没启用就不提供加密入口，并说明原因）；
   * `encrypted` = 这一篇已加密；`unlocked` = 本次浏览器会话里已解密。
   * 锁定时正文区换成 `LockedDocPanel`，编辑器**根本不挂载**。
   */
  encryption?: {
    enabled: boolean;
    encrypted: boolean;
    unlocked: boolean;
    /** 本次已解密的单篇数量（用于「锁上全部单篇」是否可用） */
    unlockedCount: number;
    onUnlock: () => void;
    onLock: () => void;
    onToggle: (encrypted: boolean) => void;
    onLockAll: () => void;
  };
  /**
   * 状态栏里的隐私锁档位行（M3-10，设计 §9.2-④）：如"加密空间 · 已解锁 · 本次会话"。
   * `expiresAt` 供"即将自动锁定"提示用（`minutes` 档才有）。
   */
  privacyLine?: {
    text: string;
    expiresAt: number | null;
    onLock?: () => void;
    lockLabel?: string;
  } | null;
  /**
   * 删除（M4-12）：**只报事件**，二次确认由外层做（同一套确认还要给列表行用）。
   * 编辑器内**没有独立删除入口**——收在「更多」菜单里，保持正文头"只有模式切换 + 更多菜单"的不变量。
   */
  onDelete?: () => void;
  /**
   * 打开版本历史（M4-11；界面稿 §四）。**锁定态下入口整体不可用**（设计 §4.5）：
   * "列表可见、内容打码"的中间态明确不做。
   */
  onOpenVersions?: () => void;
  /**
   * 「降级为普通笔记」（M4-9）：**单向** `table → note`，服务端会先封存一个版本再改类型。
   * 组件只负责弹确认框与报事件，**不碰网络**——接线在 `NotesPane`（→ 工作区 `degradeToNote`）。
   */
  onDegrade?: () => void;
  /** 版本历史入口为什么不可用（锁定态时给原因，`DESIGN.md` §6.1） */
  versionsDisabledReason?: string;
  /**
   * 附件上传状态（M4-10；界面稿 §7.2）：状态栏只**显示**，上传流程在 `features/attachments`。
   */
  attachments?: {
    label: string;
    tone: "busy" | "warn";
    onRetry?: () => void;
    /** 补充说明（如"上次没传完，重新选一次文件即可续传"），走 `title` 不占状态栏宽度 */
    hint?: string;
  } | null;
  /** 粘贴/拖入文件（M4-10；界面稿 §7.1）：编辑器把文件交出来，上传由调用方负责 */
  onFiles?: (files: File[]) => void;
  /** 这一篇已知的附件（`sha256 -> { size, hasThumb }`）：预览补大小、标"不可用"用 */
  attachmentsMeta?: Record<string, { size: number; hasThumb: boolean }>;
  /** 编辑器句柄（附件占位替换要用它改正文） */
  onEditorReady?: (handle: EditorHandle) => void;
}

export function NoteWorkspace({
  item,
  initialBody,
  snapshot,
  initialMode,
  remoteChanged = false,
  conflict = null,
  onOpenConflictCopy,
  onResolveConflict,
  onReload,
  onInput,
  onTitleChange,
  encryption,
  privacyLine,
  onDelete,
  onOpenVersions,
  onDegrade,
  versionsDisabledReason,
  attachments,
  onFiles,
  attachmentsMeta,
  onEditorReady,
}: NoteWorkspaceProps) {
  const [mode, setMode] = useState<DocMode>(initialMode ?? "split");
  /** 「添加附件」代点的隐藏文件输入（M4-10） */
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** 表格条目的两种形态由它决定：能解析走表格界面，解析失败走自动降级（界面稿 §2.10） */
  const isTable = item?.type === "table";
  const table = useTableDoc(initialBody);
  /** 主动降级的确认框（要改 `items.type`，属 API 变更 → 待拍板，见下面 Modal 的说明） */
  const [degradeOpen, setDegradeOpen] = useState(false);
  // 打开条目时的初始正文；之后由 handleInput 持续跟上编辑器的最新内容
  const [previewSource, setPreviewSource] = useState(initialBody);

  if (!item) {
    return (
      <div className="docpane">
        <EmptyDocPanel />
      </div>
    );
  }

  /** 加密且本次未解密：正文区换占位，编辑器不挂载 */
  const bodyLocked = encryption?.encrypted === true && !encryption.unlocked;

  function handleInput(text: string): void {
    setPreviewSource(text);
    onInput(text);
  }

  return (
    <div className="docpane">
      {conflict ? (
        <div className="banner banner--warn" role="status">
          <span>
            这条笔记有冲突副本（{conflict.copyTitle}）：另一处也改过同一篇，你的版本已另存。保留哪一份？
          </span>
          {onOpenConflictCopy ? (
            <button type="button" className="btn btn--sm" onClick={onOpenConflictCopy}>
              查看副本
            </button>
          ) : null}
          {onResolveConflict ? (
            <>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => onResolveConflict("mine")}
                title="把副本的内容写回这条（副本仍作为普通笔记保留）"
              >
                保留我的版本
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => onResolveConflict("server")}
                title="保留当前这条的内容（副本仍作为普通笔记保留）"
              >
                保留服务端版本
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {remoteChanged ? (
        <div className="banner banner--warn" role="status">
          <span>
            这条笔记在另一个标签页被修改过。现在保存会生成一份冲突副本，不会覆盖别处的改动。
          </span>
          {onReload ? (
            <button type="button" className="btn btn--sm" onClick={onReload}>
              按最新内容重新载入
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="docpane__head">
        {/*
          标题走 `TitleInput`（本地即时回显 + 防抖提交）：此前它直接受控在"本地库那份标题"上，
          每个键都触发一次全量 refresh，异步回灌会把刚敲的字按回去（808 条实测丢 9/10 个字）。
          `key` 用条目 id：切换条目时换一个输入框实例，不把上一篇的本地文案带过去。
        */}
        <TitleInput
          key={item.id}
          className="docpane__title-input"
          value={item.title ?? ""}
          onCommit={onTitleChange}
        />

        {/*
          添加附件（M4-10；界面稿 §7.1 的"选择文件"入口）：
          真实的 `<input type="file">` 藏起来由按钮代点——这是唯一能唤起系统文件选择器、
          又能在移动端沿用系统选择器（含拍照）的做法。

          **表格条目不显示它**：附件的占位与落库都要插进 Markdown 正文（`EditorHandle.insert`），
          表格没有这个句柄——文件会照传上去，但**没有任何引用指向它**，30 天后按孤儿清掉
          （界面稿 §3 的表格正文头也只列了标题 + 锁标识 + 更多菜单，没有添加附件）。
        */}
        {onFiles && !isTable ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="visually-hidden"
              aria-label="选择附件"
              tabIndex={-1}
              disabled={bodyLocked}
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                // 同一个文件连选两次也要能触发（不清空 value 时第二次不触发 change）
                event.target.value = "";
                if (files.length > 0) onFiles(files);
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={bodyLocked}
              title={bodyLocked ? "解锁后才能添加附件" : undefined}
              onClick={() => fileInputRef.current?.click()}
            >
              添加附件
            </Button>
          </>
        ) : null}

        {/*
          模式切换只对 Markdown 正文有意义：表格有自己的"表格 / 图册"档位（界面稿 §3 的正文头
          也只列了标题 + 锁标识 + 更多菜单，**没有模式切换**）。对表格显示它，就是一个点了没反应的控件。
        */}
        {isTable ? null : (
          <div className="segmented" role="group" aria-label="编辑模式" style={{ flex: "none" }}>
            {(Object.keys(MODE_LABEL) as DocMode[]).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className="segmented__item"
                aria-pressed={mode === candidate}
                disabled={bodyLocked}
                title={bodyLocked ? "解锁后才能查看或编辑正文" : undefined}
                onClick={() => setMode(candidate)}
              >
                {MODE_LABEL[candidate]}
              </button>
            ))}
          </div>
        )}

        {encryption ? (
          <DropdownMenu
            label="更多"
            align="right"
            trigger={
              <span className="pill" title="加密与锁定">
                更多
              </span>
            }
            items={[
              {
                id: "encrypt",
                label: "加密此篇",
                icon: "lock",
                disabled: !encryption.enabled || encryption.encrypted,
                title: !encryption.enabled
                  ? "先在「设置 › 隐私锁」启用隐私锁"
                  : encryption.encrypted
                    ? "这一篇已经加密"
                    : undefined,
                onSelect: () => encryption.onToggle(true),
              },
              {
                id: "decrypt",
                label: "取消加密",
                icon: "lock",
                disabled: !encryption.encrypted || !encryption.unlocked,
                title: !encryption.encrypted
                  ? "这一篇没有加密"
                  : !encryption.unlocked
                    ? "先解锁这一篇，才能取消加密"
                    : undefined,
                onSelect: () => encryption.onToggle(false),
              },
              {
                id: "lock-item",
                label: "锁上此篇",
                icon: "lock",
                disabled: !encryption.encrypted || !encryption.unlocked,
                title: encryption.unlocked ? undefined : "这一篇当前是锁着的",
                onSelect: () => encryption.onLock(),
              },
              {
                id: "lock-all",
                label: "锁上全部单篇",
                icon: "lock",
                disabled: encryption.unlockedCount === 0,
                title: encryption.unlockedCount === 0 ? "当前没有已解密的单篇" : undefined,
                onSelect: () => encryption.onLockAll(),
              },
              // 版本历史（M4-11）：锁定态整体不可用，并说明原因
              ...(onOpenVersions
                ? ([
                    {
                      id: "versions",
                      label: "版本历史",
                      icon: "clock" as const,
                      disabled: versionsDisabledReason !== undefined,
                      title: versionsDisabledReason,
                      onSelect: onOpenVersions,
                    },
                  ] satisfies MenuItemSpec[])
                : []),
              // 删除（M4-12）：破坏性操作 → 危险色；二次确认由工作区外层做
              // （同一套确认逻辑还要给列表行用，不在这里各写一份）
              ...(onDelete
                ? ([
                    {
                      id: "delete",
                      label: "删除",
                      icon: "logout" as const,
                      danger: true,
                      onSelect: onDelete,
                    },
                  ] satisfies MenuItemSpec[])
                : []),
            ]}
          />
        ) : null}
      </div>

      <div className="docpane__body">
        {bodyLocked && encryption ? (
          <LockedDocPanel onUnlock={encryption.onUnlock} />
        ) : isTable && table.state.kind === "table" ? (
          /*
            表格（M4-9 接线）：`type = 'table'` 且结构能解析 → **表格界面**（工具栏 / 网格 / 图册 /
            大小条都在 `TableEditor` 里），不走 CodeMirror——结构化对象是唯一真源。
          */
          <Suspense fallback={<div className="docpane__center">表格加载中…</div>}>
            <TableEditor
              doc={table.state.doc}
              onDocChange={(next) => {
                table.commit(next);
                handleInput(renderTableDocument(next));
              }}
              onRequestDegrade={() => setDegradeOpen(true)}
            />
          </Suspense>
        ) : (
          <>
            {/*
              自动降级（界面稿 §2.10）：**不静默改数据**——只把危险态提示条摆在正文区顶部，
              下面照常按普通笔记打开（正文一字未改），并给出「查看原文」「下载当前内容」两条出路。
            */}
            {isTable ? (
              <TableDegradeNotice
                onViewSource={() => setMode("edit")}
                onDownload={() => {
                  const blob = new Blob([table.current()], { type: "text/markdown;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = `${item.title ?? "表格原文"}.md`;
                  anchor.click();
                  URL.revokeObjectURL(url);
                }}
              />
            ) : null}

            <Suspense fallback={<div className="docpane__center">编辑器加载中…</div>}>
            {mode === "split" ? (
            <div className="doc-split">
              <div className="doc-split__pane">
                {/*
                  用 `previewSource`（实时文本）而不是 `initialBody`（打开时的快照）：
                  切模式会让编辑器重新挂载，用快照初始化会把中间敲的内容显示回旧版本，
                  用户再敲一个字就把旧内容写进草稿（M1-11 QA 实测）。
                */}
                <Editor
                  key={item.id}
                  initialValue={previewSource}
                  onChange={handleInput}
                  onReady={onEditorReady}
                  onFiles={onFiles}
                  ariaLabel="正文"
                />
              </div>
              <div className="doc-split__pane">
                <MarkdownPreview source={previewSource} attachments={attachmentsMeta} />
              </div>
            </div>
          ) : mode === "edit" ? (
            <div className="doc-split__pane">
              <Editor
                key={item.id}
                initialValue={previewSource}
                onChange={handleInput}
                onReady={onEditorReady}
                onFiles={onFiles}
                ariaLabel="正文"
              />
            </div>
          ) : (
            <div className="doc-split__pane">
              <MarkdownPreview source={previewSource} attachments={attachmentsMeta} />
            </div>
          )}
          </Suspense>
          </>
        )}
      </div>

      {/* 主动降级的确认框（界面稿 §2.10：三段必须写全，且**不承诺可转回**） */}
      <Modal
        open={degradeOpen}
        title="降级为普通笔记"
        onClose={() => setDegradeOpen(false)}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDegradeOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setDegradeOpen(false);
                onDegrade?.();
              }}
            >
              降级
            </Button>
          </>
        }
      >
        <p>本表格的结构与列定义将被移除，内容按纯 Markdown 打开。</p>
        <p>降级前会先自动封存一个版本，可在版本历史里找回原文。</p>
        <p>
          **不提供反向转回表格**（避免解析失败带来的数据风险）。这一步需要在服务端把条目类型从
          「表格」改为「笔记」，属接口变更，**M4 暂未开放**——已记入待办。
        </p>
      </Modal>

      {snapshot && !bodyLocked ? (
        <DocStatusBar
          snapshot={snapshot}
          encryption={
            encryption
              ? { encrypted: encryption.encrypted, unlocked: encryption.unlocked }
              : undefined
          }
          privacyLine={privacyLine}
          attachments={attachments}
        />
      ) : null}
      {bodyLocked ? (
        <div className="doc-status" role="status">
          <span className="pill pill--err">已加密</span>
        </div>
      ) : null}
    </div>
  );
}

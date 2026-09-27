/**
 * 正文区（结构见 `docs/modules/Menote-M1-界面稿-v1.md` §五）。
 *
 * 编辑器与 Markdown 渲染都走**动态 import**（架构 §14.1：编辑器与渲染各自独立分包，不进首屏）。
 * 切换条目由 `key={item.id}` 重新挂载编辑器；切换编辑/预览模式**不重建文档**（架构 §3.3）。
 */
import { Suspense, lazy, useState } from "react";
import { EmptyDocPanel } from "../../../app/workarea/EmptyDocPanel";
import { DropdownMenu } from "../../../app/ui/Menu";
import { LockedDocPanel } from "../../privacy/ui/LockedDocPanel";
import type { LocalItem } from "../../../data/db";
import type { NoteEditorSnapshot } from "../model";
import { DocStatusBar } from "./DocStatusBar";

const Editor = lazy(async () => {
  const mod = await import("../../../app/editor/Editor");
  return { default: mod.Editor };
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
}: NoteWorkspaceProps) {
  const [mode, setMode] = useState<DocMode>(initialMode ?? "split");
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
        <input
          className="docpane__title-input"
          aria-label="标题"
          value={item.title ?? ""}
          onChange={(event) => onTitleChange(event.target.value)}
        />
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
            ]}
          />
        ) : null}
      </div>

      <div className="docpane__body">
        {bodyLocked && encryption ? (
          <LockedDocPanel onUnlock={encryption.onUnlock} />
        ) : (
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
                  ariaLabel="正文"
                />
              </div>
              <div className="doc-split__pane">
                <MarkdownPreview source={previewSource} />
              </div>
            </div>
          ) : mode === "edit" ? (
            <div className="doc-split__pane">
              <Editor
                key={item.id}
                initialValue={previewSource}
                onChange={handleInput}
                ariaLabel="正文"
              />
            </div>
          ) : (
            <div className="doc-split__pane">
              <MarkdownPreview source={previewSource} />
            </div>
          )}
          </Suspense>
        )}
      </div>

      {snapshot && !bodyLocked ? (
        <DocStatusBar
          snapshot={snapshot}
          encryption={
            encryption
              ? { encrypted: encryption.encrypted, unlocked: encryption.unlocked }
              : undefined
          }
          privacyLine={privacyLine}
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

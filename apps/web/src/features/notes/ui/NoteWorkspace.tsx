/**
 * 正文区（结构见 `docs/modules/Menote-M1-界面稿-v1.md` §五）。
 *
 * 编辑器与 Markdown 渲染都走**动态 import**（架构 §14.1：编辑器与渲染各自独立分包，不进首屏）。
 * 切换条目由 `key={item.id}` 重新挂载编辑器；切换编辑/预览模式**不重建文档**（架构 §3.3）。
 */
import { Suspense, lazy, useState } from "react";
import { EmptyState } from "../../../app/ui/Controls";
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
  onInput: (text: string) => void;
  onTitleChange: (title: string) => void;
}

export function NoteWorkspace({
  item,
  initialBody,
  snapshot,
  onInput,
  onTitleChange,
}: NoteWorkspaceProps) {
  const [mode, setMode] = useState<DocMode>("split");
  const [previewSource, setPreviewSource] = useState(initialBody);

  if (!item) {
    return (
      <div className="docpane">
        <div className="docpane__center">
          <EmptyState
            title="还没有打开任何笔记"
            hint="从左侧选一篇，或者用功能栏顶部的「新建笔记」开始写。"
          />
        </div>
      </div>
    );
  }

  function handleInput(text: string): void {
    setPreviewSource(text);
    onInput(text);
  }

  return (
    <div className="docpane">
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
              onClick={() => setMode(candidate)}
            >
              {MODE_LABEL[candidate]}
            </button>
          ))}
        </div>
      </div>

      <div className="docpane__body">
        <Suspense fallback={<div className="docpane__center">编辑器加载中…</div>}>
          {mode === "split" ? (
            <div className="doc-split">
              <div className="doc-split__pane">
                <Editor
                  key={item.id}
                  initialValue={initialBody}
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
                initialValue={initialBody}
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
      </div>

      {snapshot ? <DocStatusBar snapshot={snapshot} /> : null}
    </div>
  );
}

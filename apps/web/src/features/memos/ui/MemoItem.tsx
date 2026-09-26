/**
 * 时间轴上的一条 Memo（components.md §七 `MemoItem`；需求 §8.4、§8.2）。
 *
 * 显示：渲染后的正文、标签、时间、清单小图标（清单 Memo）、置顶/待上传标记。
 * 交互：原位展开编辑（Q19：`Ctrl+Enter` 保存、`Esc` 取消）与置顶（Q9）；
 * **不提供收藏**（Q8：收藏视图不含 Memo）。
 * 编辑时只呈现**正文内容**：YAML front matter 由数据层维护，不让用户碰到。
 */
import { lazy, Suspense, useState } from "react";
import type { LocalItem } from "../../../data/db";
import { Icon } from "../../../app/ui/Icon";
import { Chip } from "../../../app/ui/Chip";
import { DropdownMenu } from "../../../app/ui/Menu";
import { timeLabelInZone } from "../model";

const MarkdownPreview = lazy(async () => {
  const mod = await import("../../../app/editor/MarkdownPreview");
  return { default: mod.MarkdownPreview };
});

export interface MemoItemProps {
  memo: LocalItem;
  /** 已剥掉 front matter 的正文 */
  content: string;
  onSave: (itemId: string, text: string) => void;
  onTogglePinned: (itemId: string) => void;
  onSelectTag: (tag: string) => void;
  timeZone?: string;
}

export function MemoItem({ memo, content, onSave, onTogglePinned, onSelectTag, timeZone }: MemoItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);

  function beginEdit(): void {
    setDraft(content);
    setEditing(true);
  }

  function save(): void {
    setEditing(false);
    if (draft !== content) onSave(memo.id, draft);
  }

  return (
    <article className="memo" data-memo-id={memo.id}>
      <header className="memo__head">
        <time className="memo__time" dateTime={new Date(memo.memo_at ?? 0).toISOString()}>
          {timeLabelInZone(memo.memo_at ?? 0, timeZone)}
        </time>
        {memo.is_task === 1 ? (
          <span className="memo__flag" title="这是一条清单 Memo">
            <Icon name="check-square" size={13} />
            清单
          </span>
        ) : null}
        {memo.pinned === 1 ? (
          <span className="memo__flag" title="已置顶">
            置顶
          </span>
        ) : null}
        {memo.pending ? <span className="memo__flag">待上传</span> : null}

        <div className="memo__menu">
          <DropdownMenu
            label="Memo 的更多操作"
            showChevron={false}
            trigger={<Icon name="chevron-down" size={13} />}
            items={[
              { id: "edit", label: "编辑", icon: "note", onSelect: beginEdit },
              {
                id: "pin",
                label: memo.pinned === 1 ? "取消置顶" : "置顶",
                icon: "star",
                onSelect: () => onTogglePinned(memo.id),
              },
            ]}
          />
        </div>
      </header>

      {editing ? (
        <div className="memo__edit">
          <textarea
            className="memo__input"
            aria-label="编辑 Memo"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                save();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
              }
            }}
          />
          <div className="memo__editfoot">
            <span className="memo__hint">Ctrl+Enter 保存 · Esc 取消</span>
            <button
              type="button"
              className="memo__cancel"
              onClick={() => setEditing(false)}
            >
              取消
            </button>
            <button type="button" className="btn btn--primary btn--sm" onClick={save}>
              保存
            </button>
          </div>
        </div>
      ) : (
        <div className="memo__body markdown-body">
          <Suspense fallback={<p>{content}</p>}>
            <MarkdownPreview source={content} />
          </Suspense>
        </div>
      )}

      {memo.tags.length > 0 ? (
        <div className="memo__tags">
          {memo.tags.map((tag) => (
            <Chip
              key={tag}
              variant="tag"
              title={`按 #${tag} 筛选`}
              onClick={() => onSelectTag(tag)}
            >
              # {tag}
            </Chip>
          ))}
        </div>
      ) : null}
    </article>
  );
}

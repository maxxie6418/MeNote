/**
 * 时间轴上的一条 Memo（components.md §七 `MemoItem`；需求 §8.4、§8.2）。
 *
 * 显示：渲染后的正文、标签、时间、清单小图标（清单 Memo）、置顶/待上传标记。
 * 交互：原位展开编辑（Q19：`Ctrl+Enter` 保存、`Esc` 取消）与置顶（Q9）；
 * **不提供收藏**（Q8：收藏视图不含 Memo）。
 * 编辑时只呈现**正文内容**：YAML front matter 由数据层维护，不让用户碰到。
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { registerEditingSession } from "../../../app/shortcuts/shortcuts";
import type { LocalItem, MemoContent } from "../../../data/db";
import { Icon } from "../../../app/ui/Icon";
import { Chip } from "../../../app/ui/Chip";
import { DropdownMenu } from "../../../app/ui/Menu";

const MarkdownPreview = lazy(async () => {
  const mod = await import("../../../app/editor/MarkdownPreview");
  return { default: mod.MarkdownPreview };
});

export interface MemoItemProps {
  memo: LocalItem;
  /** 已剥掉 front matter 的正文 + 已转笔记关联 */
  entry: MemoContent;
  onSave: (itemId: string, text: string) => void;
  onTogglePinned: (itemId: string) => void;
  onConvert: (itemId: string) => void;
  /** 删除（M4-12）：只报事件，二次确认由面板做 */
  onDelete?: (itemId: string) => void;
  onOpenConverted: (noteId: string) => void;
  onSelectTag: (tag: string) => void;
}

export function MemoItem({
  memo,
  entry,
  onSave,
  onTogglePinned,
  onConvert,
  onDelete,
  onOpenConverted,
  onSelectTag,
}: MemoItemProps) {
  const content = entry.content;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const draftRef = useRef(draft);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  function beginEdit(): void {
    draftRef.current = content;
    setDraft(content);
    setEditing(true);
  }

  /** 写入本地并入队，不收起编辑。`Ctrl/Cmd+S` 走这里，人还在改。 */
  function persist(): void {
    if (draftRef.current !== content) onSaveRef.current(memo.id, draftRef.current);
  }

  function save(): void {
    setEditing(false);
    persist();
  }

  useEffect(() => {
    if (!editing) return undefined;
    return registerEditingSession({
      id: `memo:${memo.id}`,
      isActive: () => true,
      flush: () => {
        if (draftRef.current !== content) onSaveRef.current(memo.id, draftRef.current);
      },
    });
  }, [content, editing, memo.id]);

  return (
    <article className="memo" data-memo-id={memo.id}>
      <header className="memo__head">
        {/* 时刻移到时间轴的左栏（原型 `.tl__time`）——卡片里不再重复显示，避免同一信息出现两次 */}
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
            trigger={<Icon name="more" size={13} />}
            items={[
              { id: "edit", label: "编辑", icon: "note", onSelect: beginEdit },
              {
                id: "pin",
                label: memo.pinned === 1 ? "取消置顶" : "置顶",
                icon: "star",
                onSelect: () => onTogglePinned(memo.id),
              },
              // 已转过就不再提供入口：一篇 Memo 只转一次（Q10 单向）
              ...(entry.convertedTo === null
                ? [
                    {
                      id: "convert",
                      label: "转为笔记",
                      icon: "note" as const,
                      onSelect: () => onConvert(memo.id),
                    },
                  ]
                : []),
              // 删除（M4-12）：破坏性操作 → 危险色；二次确认由面板做（同一个面板能看到计数与撤销位）
              ...(onDelete
                ? [
                    {
                      id: "delete",
                      label: "删除",
                      icon: "logout" as const,
                      danger: true,
                      onSelect: () => onDelete(memo.id),
                    },
                  ]
                : []),
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
            onChange={(event) => {
              draftRef.current = event.target.value;
              setDraft(event.target.value);
            }}
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
            <span className="memo__hint">Ctrl+S 保存并同步 · Ctrl+Enter 收起 · Esc 取消</span>
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
        <div className="memo__body">
          <Suspense fallback={<p>{content}</p>}>
            <MarkdownPreview source={content} />
          </Suspense>
        </div>
      )}

      {entry.convertedTo !== null ? (
        <div className="memo__converted">
          <button
            type="button"
            className="memo__link"
            onClick={() => onOpenConverted(entry.convertedTo as string)}
          >
            已转为笔记 · 打开
          </button>
        </div>
      ) : null}

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

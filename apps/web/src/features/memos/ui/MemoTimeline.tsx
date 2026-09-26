/**
 * Memo 时间轴（components.md §七 `MemoTimeline`；需求 §8.4）。
 *
 * 按天分组（天边界按设置时区，见 `../model`），组内按时间倒序；置顶的 Memo 在时间轴最上方（Q9）。
 * 图片瀑布流是另一个视图，按计划依赖 M4 的图片管线，不在 M2。
 */
import type { LocalItem, MemoContent } from "../../../data/db";
import { groupMemosByDay } from "../model";
import { MemoItem } from "./MemoItem";

export interface MemoTimelineProps {
  memos: readonly LocalItem[];
  /** 已剥掉 front matter 的正文 + 已转笔记关联 */
  contents: Readonly<Record<string, MemoContent>>;
  onSave: (itemId: string, text: string) => void;
  onTogglePinned: (itemId: string) => void;
  onConvert: (itemId: string) => void;
  onOpenConverted: (noteId: string) => void;
  onSelectTag: (tag: string) => void;
  timeZone?: string;
}

export function MemoTimeline({
  memos,
  contents,
  onSave,
  onTogglePinned,
  onConvert,
  onOpenConverted,
  onSelectTag,
  timeZone,
}: MemoTimelineProps) {
  const days = groupMemosByDay(memos, timeZone);

  if (days.length === 0) {
    return (
      <div className="memo-empty">
        <p className="memo-empty__title">还没有 Memo</p>
        <p className="memo-empty__hint">
          用功能栏的录入框随手记一条：记完按 Ctrl+Enter 就会出现在这里。
        </p>
      </div>
    );
  }

  return (
    <div className="timeline">
      {days.map((day) => (
        <section key={day.dayKey} className="timeline__day" aria-label={day.dayLabel}>
          <h3 className="timeline__date">{day.dayLabel}</h3>
          {day.memos.map((memo) => (
            <MemoItem
              key={memo.id}
              memo={memo}
              entry={contents[memo.id] ?? { content: "", convertedTo: null }}
              onSave={onSave}
              onTogglePinned={onTogglePinned}
              onConvert={onConvert}
              onOpenConverted={onOpenConverted}
              onSelectTag={onSelectTag}
              timeZone={timeZone}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

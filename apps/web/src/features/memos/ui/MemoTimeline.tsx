/**
 * Memo 时间轴（components.md §七 `MemoTimeline`；需求 §8.4）。
 *
 * 按天分组（天边界按设置时区，见 `../model`），组内按时间倒序；置顶的 Memo 在时间轴最上方（Q9）。
 * 图片瀑布流是另一个视图，按计划依赖 M4 的图片管线，不在 M2。
 */
import type { LocalItem, MemoContent } from "../../../data/db";
import { dayPartsInZone, groupMemosByDay, timeLabelInZone } from "../model";
import { MemoItem } from "./MemoItem";
import { Button } from "../../../app/ui/Controls";
import { Icon } from "../../../app/ui/Icon";

export interface MemoTimelineProps {
  memos: readonly LocalItem[];
  /** 已剥掉 front matter 的正文 + 已转笔记关联 */
  contents: Readonly<Record<string, MemoContent>>;
  onSave: (itemId: string, text: string) => void;
  onTogglePinned: (itemId: string) => void;
  onConvert: (itemId: string) => void;
  /** 删除（M4-12）：只报事件，二次确认由面板做（同一个面板能放撤销提示） */
  onDelete?: (itemId: string) => void;
  onOpenConverted: (noteId: string) => void;
  onSelectTag: (tag: string) => void;
  /** 空状态里的「切到录入框」出口（原型 `.empty` 有主按钮；面板已有这个回调） */
  onAdd?: () => void;
  /** 刚被「随机漫步 / 那年今日 / 图册」定位到的那一条：加一处可见的着落点（原型 `.is-walked`） */
  walkedId?: string | null;
  timeZone?: string;
}

export function MemoTimeline({
  memos,
  contents,
  onSave,
  onTogglePinned,
  onConvert,
  onDelete,
  onOpenConverted,
  onSelectTag,
  onAdd,
  walkedId = null,
  timeZone,
}: MemoTimelineProps) {
  const days = groupMemosByDay(memos, timeZone);

  if (days.length === 0) {
    return (
      <div className="memo-empty">
        {/* 空状态图标块（原型 `.empty__ico`）：图标不单独表意，旁边就是标题 */}
        <span className="empty-ico">
          <Icon name="note" size={20} />
        </span>
        <p className="memo-empty__title">还没有 Memo</p>
        <p className="memo-empty__hint">
          用功能栏的录入框随手记一条：记完按 Ctrl+Enter 就会出现在这里。
        </p>
        {/* 空状态必须给出口（DESIGN.md §5.4-3） */}
        {onAdd ? (
          <Button size="sm" variant="secondary" onClick={onAdd}>
            <Icon name="clock" size={13} />
            切到录入框
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    /*
      时间轴按原型（`deliverables/pages-redesign-2026-09-27/index.html` 的 `.tl__*`）：
      **两列**（左栏 88px + 32px 列间距）——日期行放「日期 / 星期」，条目行放「时刻」，
      主干上有节点（日期=主色实心点、条目=空心点，悬停转主色）。
      行结构：`.timeline__row` 是 grid，节点/圆点用绝对定位落在主干上（`left: 104px` = 88 + 32/2）。
    */
    <div className="timeline">
      {days.map((day) => {
        // 同一天的 Memo 在用户时区里同属一天，用第一条的时刻取「日期 / 星期」
        const parts = dayPartsInZone(day.memos[0]?.memo_at ?? 0, timeZone);
        return (
          <section key={day.dayKey} className="timeline__day" aria-label={day.dayLabel}>
            <div className="timeline__row">
              <div className="timeline__gutter">
                <span className="timeline__date">{parts.date}</span>
                <span className="timeline__wd">{parts.weekday}</span>
              </div>
              <span className="timeline__node" aria-hidden="true" />
            </div>
            {day.memos.map((memo) => (
              <article
                key={memo.id}
                /*
                  `is-walked`：被「随机漫步 / 那年今日 / 图册」定位到时给一处可见的着落点
                  （原型同名类：整块主色浅底 + 圆点转主色）。2 秒后由面板摘掉。
                */
                className={
                  memo.id === walkedId
                    ? "timeline__row timeline__item is-walked"
                    : "timeline__row timeline__item"
                }
              >
                <div className="timeline__gutter">
                  <time className="timeline__time" dateTime={new Date(memo.memo_at ?? 0).toISOString()}>
                    {timeLabelInZone(memo.memo_at ?? 0, timeZone)}
                  </time>
                </div>
                <span className="timeline__dot" aria-hidden="true" />
                <div className="timeline__content">
                  <MemoItem
                    memo={memo}
                    entry={contents[memo.id] ?? { content: "", convertedTo: null }}
                    onSave={onSave}
                    onTogglePinned={onTogglePinned}
                    onConvert={onConvert}
                    onDelete={onDelete}
                    onOpenConverted={onOpenConverted}
                    onSelectTag={onSelectTag}
                  />
                </div>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

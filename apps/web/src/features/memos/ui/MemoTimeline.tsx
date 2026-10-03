/**
 * Memo 时间轴（components.md §七 `MemoTimeline`；需求 §8.4）。
 *
 * 结构：**置顶块（Q9）+ 按天分组的日期块**。
 * - 置顶块：置顶的 Memo 抽出来单独一块放最上方，**每条自带日期**（它没有日期标题行），
 *   也**不再出现在自己的日期分组里**；
 * - 日期块：天与天内都严格按 `memo_at` 倒序，天序单调（分块逻辑见 `../model`）。
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
  /** 空状态里的「添加」出口（原型 `.empty` 有主按钮）：打开添加内容窗口（`AddEntryDialog`） */
  onAdd?: () => void;
  /** 刚被「随机漫步 / 那年今日 / 图册」定位到的那一条：加一处可见的着落点（原型 `.is-walked`） */
  walkedId?: string | null;
  timeZone?: string;
}

/** 两种行都要转给 `MemoItem` 的东西（置顶块与日期块共用一份，不写两遍） */
type MemoRowProps = Pick<
  MemoTimelineProps,
  "contents" | "onSave" | "onTogglePinned" | "onConvert" | "onDelete" | "onOpenConverted" | "onSelectTag"
> & {
  memo: LocalItem;
  timeZone?: string;
  walked: boolean;
  /** 置顶块没有日期标题行，左栏得自己补一行日期（日期块里由标题行承担） */
  showDate: boolean;
};

function MemoRow({ memo, contents, timeZone, walked, showDate, ...handlers }: MemoRowProps) {
  const at = memo.memo_at ?? 0;
  return (
    <article
      /*
        `is-walked`：被「随机漫步 / 那年今日 / 图册」定位到时给一处可见的着落点
        （原型同名类：整块主色浅底 + 圆点转主色）。2 秒后由面板摘掉。
      */
      className={walked ? "timeline__row timeline__item is-walked" : "timeline__row timeline__item"}
    >
      <div className="timeline__gutter">
        <time className="timeline__time" dateTime={new Date(at).toISOString()}>
          {timeLabelInZone(at, timeZone)}
        </time>
        {showDate ? (
          /*
            复用 `.timeline__wd`：它就是左栏**第二行那个「小号 + muted」的槽位**。
            不能用 `.timeline__date`——那是大号 600 主字色，挂在每一条上会压过卡片本身。
          */
          <span className="timeline__wd">{dayPartsInZone(at, timeZone).date}</span>
        ) : null}
      </div>
      <span className="timeline__dot" aria-hidden="true" />
      <div className="timeline__content">
        <MemoItem
          memo={memo}
          entry={contents[memo.id] ?? { content: "", convertedTo: null }}
          {...handlers}
        />
      </div>
    </article>
  );
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
  const { pinned, days } = groupMemosByDay(memos, timeZone);
  const shared = {
    contents,
    onSave,
    onTogglePinned,
    onConvert,
    onDelete,
    onOpenConverted,
    onSelectTag,
  };

  if (pinned.length === 0 && days.length === 0) {
    return (
      <div className="memo-empty">
        {/* 空状态图标块（原型 `.empty__ico`）：图标不单独表意，旁边就是标题 */}
        <span className="empty-ico">
          <Icon name="note" size={20} />
        </span>
        <p className="memo-empty__title">还没有 Memo</p>
        <p className="memo-empty__hint">
          点「添加 Memo」记一条，按天分组出现在这里。
        </p>
        {/* 空状态必须给出口（DESIGN.md §5.4-3）；这里开的是添加窗口，不是跳左侧录入框 */}
        {onAdd ? (
          <Button size="sm" variant="secondary" onClick={onAdd}>
            <Icon name="plus" size={13} />
            添加 Memo
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

      置顶块复用同一套 `.timeline__day` / `.timeline__row`（因此样式与日期块完全一致），
      标题行写「置顶」、每条左栏补一行日期——旧实现把置顶当成行内插队，会把它所在的那一整组
      连同日期标题顶到最前，日期从此不单调（见 `../model` 的 `sortMemos`）。
    */
    <div className="timeline">
      {pinned.length > 0 ? (
        <section className="timeline__day" aria-label="置顶的 Memo">
          <div className="timeline__row">
            <div className="timeline__gutter">
              <span className="timeline__date">置顶</span>
            </div>
            <span className="timeline__node" aria-hidden="true" />
          </div>
          {pinned.map((memo) => (
            <MemoRow
              key={memo.id}
              {...shared}
              memo={memo}
              timeZone={timeZone}
              walked={memo.id === walkedId}
              showDate
            />
          ))}
        </section>
      ) : null}

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
              <MemoRow
                key={memo.id}
                {...shared}
                memo={memo}
                timeZone={timeZone}
                walked={memo.id === walkedId}
                showDate={false}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

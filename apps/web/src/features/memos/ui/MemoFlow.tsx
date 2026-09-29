/**
 * Memo 瀑布流图册（原型 `[data-memo-view-pane="flow"]`，`index.html` L1413-1534 + CSS L550-585）。
 *
 * 三条口径：
 * 1. **只展示，不在这里编辑**：点卡片 → 切回时间轴并定位那一条（编辑仍在时间轴原位编辑）。
 * 2. **只画有图且已上传的 Memo**：图片元数据由 `useMemoImages` 喂进来（`status = uploaded`），
 *    正文里引用了但对象还没上传完的，这里不会出现（否则是一排破图）。
 * 3. **瓦片比例由宽高算**，宽高缺失取 `1/1`（原型是硬编码类名，我们按数据算；缺数据给最稳的方档）。
 */
import { useMemo } from "react";
import type { LocalItem, MemoContent } from "../../../data/db";
import { attachmentUrl } from "../../attachments/model";
import { Button } from "../../../app/ui/Controls";
import { Icon } from "../../../app/ui/Icon";
import { dayLabelInZone, memoPreview, timeLabelInZone } from "../model";
import type { MemoImageRef } from "../useMemoImages";

export interface MemoFlowProps {
  memos: readonly LocalItem[];
  contents: Readonly<Record<string, MemoContent>>;
  /** `itemId → 图片`（只含已上传的图片附件；缺省时退化为空态） */
  images?: ReadonlyMap<string, MemoImageRef[]>;
  /** 点卡片：切回时间轴并定位 */
  onOpen: (itemId: string) => void;
  /**
   * 空态出口：**切回时间轴**（不是添加）。
   * 瀑布流只画带图的 Memo，文本 Memo 发布后不出现——在这里添加会"加了看不见"，
   * 所以这一屏的出口是回到时间轴，到那里再添加（用户 2026-09-29 的"明确反馈"要求）。
   */
  onBackToTimeline?: () => void;
  timeZone?: string;
}

/** 宽高比 → 原型的四档类名（2/3、4/5、1/1、16/10） */
function ratioClass(image: MemoImageRef): string {
  if (!image.width || !image.height) return "wf__img--sq";
  const ratio = image.width / image.height;
  if (ratio <= 0.72) return "wf__img--portrait";
  if (ratio <= 0.9) return "wf__img--tall";
  if (ratio <= 1.25) return "wf__img--sq";
  return "wf__img--wide";
}

export function MemoFlow({
  memos,
  contents,
  images,
  onOpen,
  onBackToTimeline,
  timeZone,
}: MemoFlowProps) {
  const tiles = useMemo(() => {
    const out: Array<{ memo: LocalItem; image: MemoImageRef; caption: string }> = [];
    for (const memo of memos) {
      const first = images?.get(memo.id)?.[0];
      if (!first) continue;
      out.push({
        memo,
        image: first,
        caption: memoPreview(contents[memo.id]?.content ?? ""),
      });
    }
    return out;
  }, [contents, images, memos]);

  if (tiles.length === 0) {
    return (
      <div className="memo-empty">
        <span className="empty-ico">
          <Icon name="image" size={20} />
        </span>
        <p className="memo-empty__title">还没有带图的 Memo</p>
        <p className="memo-empty__hint">
          瀑布流只显示带图的 Memo。切回时间轴看全部，也能在那里添加。
        </p>
        {/* 空状态必须给出口（DESIGN.md §5.4-3）：这一屏加了看不见，故出口是切回时间轴 */}
        {onBackToTimeline ? (
          <Button size="sm" variant="secondary" onClick={onBackToTimeline}>
            <Icon name="list" size={13} />
            切回时间轴
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flow">
      {tiles.map(({ memo, image, caption }) => {
        const at = memo.memo_at ?? memo.updated_at;
        return (
          <article key={memo.id} className="wf">
            <button
              type="button"
              className="wf__open"
              onClick={() => onOpen(memo.id)}
              title="切回时间轴并定位到这一条"
            >
              <img
                className={`wf__img ${ratioClass(image)}`}
                src={attachmentUrl(image.sha256, { thumb: image.hasThumb })}
                alt={caption === "" ? "Memo 里的图片" : caption}
                loading="lazy"
                decoding="async"
              />
              <span className="wf__meta">
                <time className="wf__date">
                  {dayLabelInZone(at, timeZone)} {timeLabelInZone(at, timeZone)}
                </time>
                <span className="wf__cap">{caption === "" ? "（这一条没有正文）" : caption}</span>
              </span>
            </button>
          </article>
        );
      })}
    </div>
  );
}

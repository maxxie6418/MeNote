/**
 * 侧栏第二组：**入口**（原型里的「随机漫步 · 那年今日」，`index.html` L1150-1170）。
 *
 * 两块都是"跳过去看看"的入口，不做筛选：
 * - **随机漫步**：从**当前筛选后**的那一批里随机挑一条（"你正看的这一批"里抽，才有"漫步"的感觉）；
 * - **那年今日**：看**全部** Memo（它是一条历史线索，不该被"今天""某个标签"这类筛选影响）。
 *   没有往年记录时**整块不渲染**——不给一个点进去什么都没有的空壳。
 */
import { onThisDay, pickRandomMemo } from "../model";
import { Icon } from "../../../app/ui/Icon";
import type { MemoSidebarContext } from "./registry";

export function RandomBlock({ ctx }: { ctx: MemoSidebarContext }) {
  function walk(): void {
    const picked = pickRandomMemo(ctx.visible);
    if (picked) ctx.onLocate(picked.id);
  }

  return (
    <div className="subblk">
      <button
        type="button"
        className="subact subact--solo"
        onClick={walk}
        title="从当前筛选的 Memo 里随机挑一条跳过去"
      >
        <Icon name="bolt" size={13} />
        <span className="subact__l">随机漫步</span>
        <Icon name="chevron-right" size={13} className="ic subact__go" />
      </button>
    </div>
  );
}

/** `2025-09-26` → `2025年9月26日` */
function dayLabelOf(dayKey: string): string {
  const [year, month, day] = dayKey.split("-");
  return `${Number(year)}年${Number(month)}月${Number(day)}日`;
}

export function OnThisDayBlock({ ctx }: { ctx: MemoSidebarContext }) {
  const found = onThisDay(ctx.all, ctx.now, ctx.timeZone);
  if (found === null) return null;

  const preview = ctx.previewOf(found.itemId);

  return (
    <section className="subblk" aria-label="那年今日">
      <h2 className="subblk__t">那年今日</h2>
      <button
        type="button"
        className="otd"
        onClick={() => ctx.onLocate(found.itemId)}
        title="按「月-日」挑历史上离今天最近的一天，不限年份"
      >
        <span className="otd__hd">
          <span className="otd__d">{dayLabelOf(found.dayKey)}</span>
          <span className="otd__n">{found.count} 条</span>
        </span>
        <span className="otd__x">{preview === "" ? "（这一条没有正文）" : preview}</span>
      </button>
    </section>
  );
}

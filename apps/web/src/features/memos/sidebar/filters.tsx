/**
 * 侧栏第三组：**筛选**（原型里的「日期 · 标签」，`index.html` L1171-1192）。
 *
 * **日期口径**：沿用现有的 `MEMO_RANGES`（全部 / 今天 / **近 7 天** / **近 30 天**），
 * **没有**改成型原型写的「本周 / 本月」。理由：那两个是**行为变更**（"本周"从周一起算，
 * 和"近 7 天"不是一回事），会改变用户看到的结果，而现有用例与既有习惯都按近 7 / 近 30 天；
 * 要改是一行的事，但属于产品口径变更，不该由界面还原顺手做掉（已在交付报告里标出）。
 *
 * **标签计数**用全部 Memo（与标签云、文件夹计数同一个口径：统计一律计入）。
 */
import { SegmentedControl } from "../../../app/ui/SegmentedControl";
import { collectMemoTags, MEMO_RANGES, type MemoRange } from "../model";
import type { MemoSidebarContext } from "./registry";

export function DateBlock({ ctx }: { ctx: MemoSidebarContext }) {
  return (
    <section className="subblk" aria-label="日期">
      <h2 className="subblk__t">日期</h2>
      <SegmentedControl
        ariaLabel="日期范围"
        size="compact"
        value={ctx.filter.range}
        onChange={(range) => ctx.onFilterChange({ ...ctx.filter, range: range as MemoRange })}
        options={MEMO_RANGES.map((item) => ({ value: item.value, label: item.label }))}
      />
    </section>
  );
}

export function TagsBlock({ ctx }: { ctx: MemoSidebarContext }) {
  const tags = collectMemoTags(ctx.all);

  return (
    <section className="subblk" aria-label="标签">
      <h2 className="subblk__t">标签</h2>
      <nav className="sublist">
        <button
          type="button"
          className="subitem"
          aria-pressed={ctx.filter.tag === null}
          onClick={() => ctx.onFilterChange({ ...ctx.filter, tag: null })}
        >
          全部
          <span className="n">{ctx.all.length}</span>
        </button>
        {tags.map((entry) => {
          const active = ctx.filter.tag === entry.tag;
          return (
            <button
              key={entry.tag}
              type="button"
              className="subitem"
              aria-pressed={active}
              title={`${entry.count} 条`}
              onClick={() =>
                ctx.onFilterChange({ ...ctx.filter, tag: active ? null : entry.tag })
              }
            >
              # {entry.tag}
              <span className="n">{entry.count}</span>
            </button>
          );
        })}
      </nav>
    </section>
  );
}

/**
 * 侧栏第一组：**概况**（原型里的「概述 · 热力图」，`index.html` L1120-1149）。
 *
 * 两块都只看**全部** Memo（不随筛选变化）：它们是"我一共记了多少"的口径，
 * 跟着筛选变会让数字像个会跳的装饰（与"计数一律计入"的既有口径一致）。
 */
import { heatmap12w, summarizeMemos } from "../model";
import type { MemoSidebarContext } from "./registry";

export function StatsBlock({ ctx }: { ctx: MemoSidebarContext }) {
  const summary = summarizeMemos(ctx.all, ctx.now, ctx.timeZone);
  const cells = [
    { value: summary.total, label: "总条数" },
    { value: summary.thisMonth, label: "本月新增" },
    { value: summary.activeDays, label: "记录天数" },
  ];

  return (
    <section className="subblk" aria-label="概述">
      <h2 className="subblk__t">概述</h2>
      <div className="stat3">
        {cells.map((cell) => (
          <div key={cell.label} className="stat3__cell">
            <b className="stat3__n">{cell.value}</b>
            <span className="stat3__l">{cell.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function HeatmapBlock({ ctx }: { ctx: MemoSidebarContext }) {
  const map = heatmap12w(ctx.all, ctx.now, ctx.timeZone);

  return (
    <section className="subblk" aria-label="热力图">
      <h2 className="subblk__t">热力图</h2>
      <p className="heat__sum">{map.label}</p>
      {/*
        密度图是纯视觉的，读屏只念一句总结（`role="img"` + `aria-label`）：
        84 个格子逐个念没有意义，而"共 N 条"已经由上面的 `.heat__sum` 给出。
      */}
      <div
        className="heat"
        role="img"
        aria-label={`近 12 周记录密度：每周一列、7 天一行，共 ${map.total} 条`}
      >
        {map.cells.map((cell) => (
          <i key={cell.dayKey} className={cell.level === 0 ? "hm" : `hm hm--${cell.level}`} />
        ))}
      </div>
      <div className="heat__lg" aria-hidden="true">
        <span>少</span>
        <i className="hm hm--1" />
        <i className="hm hm--2" />
        <i className="hm hm--3" />
        <i className="hm hm--4" />
        <span>多</span>
      </div>
    </section>
  );
}

/**
 * 条目统计**数字带**（M7 首页重做；原型 `homeStats`「一条三数字带」）。
 *
 * 【M7 2026-10-03】由原先的**三块统计卡**收成一条横排的数字带，收进概括预览甲板的右栏上段——
 * 三块等分时统计和待办抢注意力，而统计回答的是"我总共有多少"，是回顾性的，不该占那么大。
 *
 * **数字与口径一个字没动**：统计**始终按全量**，计入加密空间内条目与单篇加密条目，
 * **不因锁定/解锁改变**——它回答的是"我总共有多少东西"（《隐私锁设计》§9.2 的既有口径）。
 * 受门禁影响的只有 Memo 的**内容预览**，而这里的 Memo 数字也是统计（仍然照数）。
 */
import type { HomeStats } from "../model";
import { InfoHint } from "../../../app/ui/InfoHint";

export interface StatBandProps {
  stats: HomeStats;
  memoLocked: boolean;
}

export function StatBand({ stats, memoLocked }: StatBandProps) {
  return (
    <section className="home-band home-band--stats" aria-label="条目统计">
      <h2 className="home-band__t">
        条目统计
        <InfoHint label="统计口径">
          统计**始终按全量**：计入加密空间内条目与单篇加密条目，锁定也不减。
          它回答的是"我总共有多少"，不受门禁影响。
        </InfoHint>
      </h2>
      <div className="home-band__row">
        <div className="home-stat">
          <b className="home-stat__n">{stats.notes}</b>
          <span className="home-stat__l">笔记</span>
        </div>
        <div className="home-stat">
          <b className="home-stat__n">{stats.tables}</b>
          <span className="home-stat__l">表格</span>
        </div>
        <div className="home-stat">
          <b className="home-stat__n">{stats.memos}</b>
          <span className="home-stat__l">Memo</span>
        </div>
        {memoLocked ? <span className="home-band__note">数字不区分锁定状态</span> : null}
      </div>
    </section>
  );
}

/**
 * 条目统计卡（components.md §三 `StatCards`；需求 §7.4）。
 *
 * **统计始终按全量口径**：计入加密空间内条目与单篇加密条目，**不因锁定/解锁改变**——
 * 它回答的是"我总共有多少东西"。受门禁影响的只有 Memo 的**内容预览**，而这张卡里的 Memo 数字
 * 也是统计（仍然照数），所以锁定时同样显示数字，只把来源说明写清楚。
 */
import { HomeCard } from "./HomePanel";
import type { HomeStats } from "../model";

export interface StatCardsProps {
  stats: HomeStats;
  /** M2 恒 false；M3 接门禁后传真实状态（这里只影响提示文案，不影响数字口径） */
  memoLocked?: boolean;
}

export function StatCards({ stats, memoLocked = false }: StatCardsProps) {
  return (
    <HomeCard title="条目统计" icon="info" note="本地计算">
      <div className="home-stats">
        <div className="home-stat">
          <div className="home-stat__n">{stats.notes}</div>
          <div className="home-stat__l">笔记</div>
        </div>
        <div className="home-stat">
          <div className="home-stat__n">{stats.tables}</div>
          <div className="home-stat__l">表格</div>
        </div>
        <div className="home-stat">
          <div className="home-stat__n">{stats.memos}</div>
          <div className="home-stat__l">Memo</div>
        </div>
      </div>
      <p className="hint-line">
        统计由本地元数据计算，不发额外网络请求；始终计入加密空间与单篇加密的条目，不区分锁定状态。
        {memoLocked ? "（Memo 内容当前处于锁定状态，数字口径不变）" : ""}
      </p>
    </HomeCard>
  );
}

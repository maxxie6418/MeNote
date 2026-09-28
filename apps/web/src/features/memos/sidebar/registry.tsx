/**
 * Memo 侧栏的**模块注册表**（B3 批；用户 2026-09-28 拍板"要可插拔、以后能配隐藏与位置"）。
 *
 * 分工：
 * - **清单**（有哪些模块、默认顺序）在 `@menote/shared` 的 `MEMO_SIDEBAR_MODULES`——唯一真源；
 * - **顺序与隐藏**由 `orderedSidebarModules(settings.memo_view.sidebar)` 算；
 * - **长什么样**在这里注册。`MemoPanel` **不认识任何具体模块**，只按下发下来的 id 查这张表渲染。
 *
 * 加一块模块 = ①`MEMO_SIDEBAR_MODULES` 加一个 id ②这里加一项。漏了②会因为 `Record<>` 的类型
 * 直接编译不过（不会等到界面上少一块才发现）。
 */
import type { ReactNode } from "react";
import type { MemoSidebarModuleId } from "@menote/shared";
import type { LocalItem } from "../../../data/db";
import type { MemoFilter } from "../model";
import { HeatmapBlock, StatsBlock } from "./overview";
import { OnThisDayBlock, RandomBlock } from "./entries";
import { DateBlock, TagsBlock } from "./filters";

/** 每个模块能拿到的东西（模块自己不碰数据访问，全由面板喂进来） */
export interface MemoSidebarContext {
  /** 全部 Memo（已过隐私门禁）：概述与热力图看它——计数口径是"一律计入" */
  all: readonly LocalItem[];
  /** 当前筛选后的 Memo：随机漫步用它（"从你正看的这一批里随机挑"） */
  visible: readonly LocalItem[];
  now: number;
  timeZone?: string;
  filter: MemoFilter;
  onFilterChange: (next: MemoFilter) => void;
  /** 定位并高亮某一条（随机漫步 / 那年今日 / 图册点卡都用它） */
  onLocate: (itemId: string) => void;
  /** 摘要文案（面板从已剥 front matter 的正文里取首行） */
  previewOf: (itemId: string) => string;
}

export interface MemoSidebarModule {
  id: MemoSidebarModuleId;
  render: (ctx: MemoSidebarContext) => ReactNode;
}

export const MEMO_SIDEBAR_REGISTRY: Record<MemoSidebarModuleId, MemoSidebarModule> = {
  stats: { id: "stats", render: (ctx) => <StatsBlock ctx={ctx} /> },
  heatmap: { id: "heatmap", render: (ctx) => <HeatmapBlock ctx={ctx} /> },
  random: { id: "random", render: (ctx) => <RandomBlock ctx={ctx} /> },
  onThisDay: { id: "onThisDay", render: (ctx) => <OnThisDayBlock ctx={ctx} /> },
  date: { id: "date", render: (ctx) => <DateBlock ctx={ctx} /> },
  tags: { id: "tags", render: (ctx) => <TagsBlock ctx={ctx} /> },
};

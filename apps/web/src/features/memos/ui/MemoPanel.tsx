/**
 * Memo 视图（components.md §七 `MemoPanel`；需求 §8.4、功能拆解 M06-10）。
 *
 * 结构（**B3 批 2026-09-28 按原型 `.page--memo` 重排**）：
 * ```
 * .memopanel
 *  ├─ .memopanel__head    标题 · 计数 · 说明 ⓘ · 视图切换（时间轴 / 瀑布流）· 添加 Memo
 *  └─ .memopanel__main
 *      ├─ aside.memopanel__side   页内二级侧栏：**按注册表渲染的模块**（顺序与隐藏由设置决定）
 *      └─ .memopanel__body        唯一滚动容器：时间轴 或 瀑布流图册
 * ```
 * 两处与原型一致的改动：**筛选（日期 / 标签）搬进侧栏**（不再占页头下方那条横带），
 * **视图切换在页头最右**。**不含"清单" tab**（待办是独立视图），也**不提供收藏**（Q8）。
 *
 * **面板不认识任何具体模块**：它只做"取顺序 → 查注册表 → 渲染"（见 `sidebar/registry.tsx`）。
 * 加一块模块不需要动这个文件。
 *
 * 状态都留在本组件内（筛选、视图、定位高亮只影响显示，不进数据库）；数据与写入由 `App` 传进来。
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import type { LocalItem, MemoContent } from "../../../data/db";
import {
  isMemoVisible,
  type MemoSidebarModuleId,
  type MemoSidebarSettings,
  type PrivacyGate,
} from "@menote/shared";
import { LockedPlaceholder } from "../../../app/ui/LockedPlaceholder";
import { Button } from "../../../app/ui/Controls";
import { InfoHint } from "../../../app/ui/InfoHint";
import { Modal } from "../../../app/ui/Modal";
import { Icon } from "../../../app/ui/Icon";
import { SegmentedControl } from "../../../app/ui/SegmentedControl";
import {
  EMPTY_FILTER,
  filterMemos,
  memoPreview,
  orderedSidebarModules,
  type MemoFilter,
  type MemoRange,
} from "../model";
import { MEMO_SIDEBAR_REGISTRY, type MemoSidebarContext } from "../sidebar/registry";
import type { MemoImageRef } from "../useMemoImages";
import { MemoFlow } from "./MemoFlow";
import { MemoTimeline } from "./MemoTimeline";

export type MemoViewMode = "timeline" | "flow";

const VIEW_OPTIONS = [
  { value: "timeline" as const, label: "时间轴", icon: "list" as const },
  { value: "flow" as const, label: "瀑布流", icon: "grid" as const },
];

/** 定位高亮的停留时长（原型 `.is-walked` 也是一闪而过） */
const WALKED_MS = 2_000;

export interface MemoPanelProps {
  memos: readonly LocalItem[];
  /** 已剥掉 front matter 的正文 + 已转笔记关联 */
  contents: Readonly<Record<string, MemoContent>>;
  /**
   * 隐私门禁（M3-5）：Memo 在范围内且锁定时**整体占位**（不显示内容、标签与图片）。
   * 判定走共享包的 `isMemoVisible`，界面不自己拼条件。
   */
  gate: PrivacyGate;
  /** 占位上的「解锁」出口（打开解锁框） */
  onUnlock: () => void;
  onSave: (itemId: string, text: string) => void;
  onTogglePinned: (itemId: string) => void;
  /** Memo 转笔记（Q10） */
  onConvert: (itemId: string) => void;
  /** 删除 Memo（M4-12）：只报事件；确认框在本面板里（同一处能显示"移入回收站"的后果） */
  onDelete?: (itemId: string) => void;
  /** 打开已转出的那篇笔记 */
  onOpenConverted: (noteId: string) => void;
  /** 「添加」按钮：把焦点送回功能栏的录入框（M07-01 入口二） */
  onAdd: () => void;
  timeZone?: string;
  /** 便于测试固定"现在" */
  now?: number;
  /**
   * 侧栏模块的顺序与隐藏（用户设置 `memo_view.sidebar`）。
   * 缺省 = 按 `MEMO_SIDEBAR_MODULES` 的默认顺序全部显示。
   */
  sidebar?: MemoSidebarSettings;
  /** 图册用的图片索引（由组合根从本地附件元数据读出后传进来；面板不碰数据访问） */
  images?: ReadonlyMap<string, MemoImageRef[]>;
}

export function MemoPanel({
  memos,
  contents,
  gate,
  onUnlock,
  onSave,
  onTogglePinned,
  onConvert,
  onDelete,
  onOpenConverted,
  onAdd,
  timeZone,
  now,
  sidebar,
  images,
}: MemoPanelProps) {
  const [tag, setTag] = useState<string | null>(null);
  const [range, setRange] = useState<MemoRange>(EMPTY_FILTER.range);
  const [view, setView] = useState<MemoViewMode>("timeline");
  /** 刚定位到的那一条（高亮 2 秒） */
  const [walkedId, setWalkedId] = useState<string | null>(null);
  /**
   * "现在"只在挂载时取一次（渲染期调 `Date.now()` 不纯，且会让每次渲染结果不稳定）。
   * 代价：跨零点时"今天"的范围要等下次进入视图才刷新——对个人笔记够用。
   */
  const [nowMs] = useState(() => now ?? Date.now());
  /** 待确认删除的 Memo（M4-12）：破坏性操作必须二次确认 */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const memoVisible = isMemoVisible(gate);
  const visible = filterMemos(memos, { tag, range }, nowMs, timeZone);
  const modules = orderedSidebarModules(sidebar) as MemoSidebarModuleId[];
  const filter: MemoFilter = { tag, range };

  /**
   * 定位到某一条（随机漫步 / 那年今日 / 图册点卡都用它）：
   * 1. **松开筛选**——目标很可能被"今天""某个标签"挡住，不松就是"跳过去什么都没发生"；
   * 2. 切回时间轴（图册里点卡也走这条路径）；
   * 3. 高亮 2 秒；滚到视线中央要等时间轴铺好，放在下面的 effect 里做。
   */
  const locate = useCallback((itemId: string) => {
    setTag(null);
    setRange("all");
    setView("timeline");
    setWalkedId(itemId);
  }, []);

  useEffect(() => {
    if (walkedId === null) return undefined;
    // 等这次提交把时间轴铺出来（同一个 tick 里 DOM 中还没有那一行）
    const scrollTimer = window.setTimeout(() => {
      const node = document.querySelector(`[data-memo-id="${walkedId}"]`);
      /*
        守卫 `typeof`：jsdom 没有实现 `scrollIntoView`，不判一下会在用例里抛异步错误
        （真正的浏览器里它一定在）。高亮本身不依赖它，所以滚动失败也不影响定位。
      */
      if (typeof node?.scrollIntoView === "function") node.scrollIntoView({ block: "center" });
    }, 0);
    const clearTimer = window.setTimeout(() => setWalkedId(null), WALKED_MS);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [walkedId]);

  if (!memoVisible) {
    // 锁定时整屏占位：**保留标题与计数**（计数属于统计口径，一律计入），
    // 但侧栏、筛选与时间轴一律不渲染（设计 §9.2）
    return (
      <section className="memopanel" aria-label="Memo">
        <header className="memopanel__head">
          <h2 className="memopanel__title">Memo</h2>
          <span className="listpane__count">{memos.length} 条</span>
        </header>
        <div className="memopanel__body scroll-thin">
          <LockedPlaceholder
            title="Memo 已锁定"
            hint="隐私锁已锁定，内容、标签与图片都不显示。解锁后即可查看。"
            onUnlock={onUnlock}
          />
        </div>
      </section>
    );
  }

  const ctx: MemoSidebarContext = {
    all: memos,
    visible,
    now: nowMs,
    timeZone,
    filter,
    onFilterChange: (next) => {
      setTag(next.tag);
      setRange(next.range);
    },
    onLocate: locate,
    previewOf: (itemId) => memoPreview(contents[itemId]?.content ?? ""),
  };

  return (
    <section className="memopanel" aria-label="Memo">
      <header className="memopanel__head">
        <h2 className="memopanel__title">Memo</h2>
        <span className="listpane__count">{visible.length} 条</span>
        <InfoHint label="Memo 说明">
          按天分组倒序；置顶的 Memo 排在最前。清单 Memo 也会出现在这里，带「清单」标记。
        </InfoHint>
        <span className="memopanel__spacer" />
        <SegmentedControl
          ariaLabel="视图"
          size="compact"
          value={view}
          onChange={(next) => setView(next as MemoViewMode)}
          options={VIEW_OPTIONS.map((item) => ({
            value: item.value,
            label: item.label,
            icon: item.icon,
          }))}
        />
        <Button size="sm" variant="secondary" onClick={onAdd} title="回到功能栏的录入框记一条">
          <Icon name="plus" size={13} />
          添加 Memo
        </Button>
      </header>

      <div className="memopanel__main">
        <aside className="memopanel__side scroll-thin" aria-label="Memo 的概述、入口与筛选">
          {/*
            按注册表渲染：这里**不出现任何模块的名字**——顺序与隐藏由设置算出来，
            长什么样由 `MEMO_SIDEBAR_REGISTRY` 决定。加一块模块不需要改这个文件。
          */}
          {modules.map((id) => (
            <Fragment key={id}>{MEMO_SIDEBAR_REGISTRY[id].render(ctx)}</Fragment>
          ))}
        </aside>

        <div className="memopanel__body scroll-thin">
          {view === "timeline" ? (
            <MemoTimeline
              memos={visible}
              contents={contents}
              onSave={onSave}
              onTogglePinned={onTogglePinned}
              onConvert={onConvert}
              onDelete={onDelete ? (itemId) => setPendingDelete(itemId) : undefined}
              onOpenConverted={onOpenConverted}
              onSelectTag={(next) => setTag(next)}
              onAdd={onAdd}
              walkedId={walkedId}
              timeZone={timeZone}
            />
          ) : (
            <MemoFlow
              memos={visible}
              contents={contents}
              images={images}
              onOpen={locate}
              onAdd={onAdd}
              timeZone={timeZone}
            />
          )}
        </div>
      </div>

      {/* 删除确认（M4-12）：写明去向与可恢复性；破坏性操作必须二次确认 */}
      <Modal
        open={pendingDelete !== null}
        title="删除 Memo"
        desc="这条 Memo 将移入回收站，保留 30 天，可在回收站恢复。"
        onClose={() => setPendingDelete(null)}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                const id = pendingDelete;
                setPendingDelete(null);
                if (id) onDelete?.(id);
              }}
            >
              移入回收站
            </Button>
          </>
        }
      >
        <p>删除后它不再出现在时间轴里；已转出的笔记不受影响。</p>
      </Modal>
    </section>
  );
}

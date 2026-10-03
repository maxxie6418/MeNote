/**
 * 首页面板（components.md §三 `HomePanel`；需求 §7.4、功能拆解 M05）。
 *
 * 三块：**概括预览**（甲板：一主两副）→ **快捷方式**（页内一条横排动作带）→ **快速导航**（三组）。
 * 数据全部由本地元数据算出来，**不发额外请求**（页头与各块标题旁都标了来源）。
 *
 * **【M7 首页重做 2026-10-03】结构按原型第 03 屏改成「一主两副」**：
 * 概括预览不再是三块等分，而是**今日待办作左侧焦点卡**（`flex: 1.15`）、**条目统计三数字带
 * 与最近动态收进右栏**（`flex: 1`）。为什么待办占大头：它是唯一有**时间压力**的内容，
 * 统计与动态是回顾性的。
 *
 * **这一轮只改「怎么摆」，不改「算什么」**：`homeStats` / `openTaskPreview` /
 * `recentPreview` / `topTags` 四个纯函数与它们的单测一个字没动。统计**始终按全量口径**
 * （不因锁定改变——《隐私锁设计》§9.2 的既有口径），只有 Memo 派生的**内容预览**在
 * 门禁锁定时占位。
 *
 * 「打开加密空间」原先是 M2 时期留下的 `disabled`（`title="加密空间将在 M3 启用"`），
 * 而 M3 早已落地，那颗入口**一直点不动**。本轮接上真动作 `onOpenVault`，三态由
 * `App` 分发（未启用 → 置灰并说明原因 / 锁定 → 开解锁弹窗 / 已解锁 → 进空间视图），
 * 口径与功能栏那个贴底节点一致，不发明第二套进入方式。
 */
import type { LocalItem } from "../../../data/db";
import { isMemoVisible, type PrivacyGate } from "@menote/shared";
import { Icon } from "../../../app/ui/Icon";
import { homeStats, openTaskPreview, recentPreview, topTags } from "../model";
import { QuickNav } from "./QuickNav";
import { RecentActivity } from "./RecentActivity";
import { ShortcutActions } from "./ShortcutActions";
import { StatBand } from "./StatBand";
import { TodayTasks } from "./TodayTasks";

export interface HomePanelProps {
  /** 未删除的笔记与表格（不含 Memo） */
  items: readonly LocalItem[];
  /** 未删除的 Memo */
  memos: readonly LocalItem[];
  folders: ReadonlyArray<{ id: string; name: string }>;
  /** 条目正文首行（待办预览的标题来源） */
  titles: Readonly<Record<string, string>>;
  /**
   * 隐私门禁（M3-5）。"已锁定"占位由它推出：`memoLocked = !isMemoVisible(gate)`。
   * **统计不区分锁定状态**（算的是"总共有多少"），只有 Memo 派生的预览会占位。
   */
  gate: PrivacyGate;
  onNewNote: () => void;
  onFocusComposer: (mode: "memo" | "task") => void;
  onFocusSearch: () => void;
  onOpenItem: (itemId: string) => void;
  onOpenView: (view: "recent" | "starred" | "memo" | "task" | "notebook") => void;
  onOpenFolder: (folderId: string) => void;
  onOpenTag: (tag: string) => void;
  /**
   * 「打开加密空间」（M7 新增）。三态由 `App` 判断：
   * 没启用 → 置灰并说明；锁定 → 开解锁弹窗；已解锁 → 进空间视图。
   */
  onOpenVault: () => void;
  /** 隐私锁还没启用时，把上面那颗入口置灰并把原因说清（DESIGN.md §6.1：禁用必须说明为何） */
  vaultEntry: { enabled: boolean; locked: boolean; reason: string | null };
}

export function HomePanel({
  items,
  memos,
  folders,
  titles,
  gate,
  onNewNote,
  onFocusComposer,
  onFocusSearch,
  onOpenItem,
  onOpenView,
  onOpenFolder,
  onOpenTag,
  onOpenVault,
  vaultEntry,
}: HomePanelProps) {
  const memoLocked = !isMemoVisible(gate);
  const stats = homeStats([...items, ...memos]);
  const tasks = openTaskPreview(memos, titles, gate);
  const recent = recentPreview(items, gate);
  const tags = topTags(items, 6);

  return (
    <section className="home" aria-label="首页">
      <header className="pane-head">
        <div>
          <h1>首页</h1>
          <div className="sub">概括预览 · 快捷方式 · 快速导航 · 全部由本地元数据计算</div>
        </div>
      </header>

      <div className="home__scroll">
        {/*
          甲板：一行两列。**全部弹性**（左 1.15 / 右 1），不写固定宽 + 绝对定位——
          窄窗口下两列能自然收缩，而不是重叠（移动端布局未定稿，但不留"仅桌面成立"的写法）。
        */}
        <div className="home-deck">
          <div className="home-deck__main">
            <TodayTasks
              tasks={tasks}
              memoLocked={memoLocked}
              onOpenItem={onOpenItem}
              onOpenTaskView={() => onOpenView("task")}
            />
          </div>
          <div className="home-deck__side">
            <StatBand stats={stats} memoLocked={memoLocked} />
            <RecentActivity
              entries={recent}
              memoCount={stats.memos}
              memoLocked={memoLocked}
              onOpenItem={onOpenItem}
            />
          </div>
        </div>

        <ShortcutActions
          onNewNote={onNewNote}
          onFocusComposer={onFocusComposer}
          onFocusSearch={onFocusSearch}
          onOpenVault={onOpenVault}
          vaultEntry={vaultEntry}
        />

        <QuickNav
          folders={folders}
          tags={tags}
          onOpenFolder={onOpenFolder}
          onOpenTag={onOpenTag}
          onOpenView={onOpenView}
          onOpenVault={onOpenVault}
          vaultEntry={vaultEntry}
        />
      </div>
    </section>
  );
}

/** 区块外壳：标题 + 右上角来源说明（"本地计算"/"来自清单 Memo"） */
export function HomeCard({
  title,
  icon,
  note,
  action,
  children,
}: {
  title: string;
  icon: "info" | "check-square" | "clock";
  note?: string;
  /** 标题右侧的弱操作（焦点卡的「打开待办视图」用它） */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="home-card">
      <div className="home-card__hd">
        <Icon name={icon} size={13} />
        <h3>{title}</h3>
        {note ? <span className="home-card__note">{note}</span> : null}
        {action ? <span className="home-card__act">{action}</span> : null}
      </div>
      <div className="home-card__bd">{children}</div>
    </div>
  );
}

/**
 * 首页面板（components.md §三 `HomePanel`；需求 §7.4、功能拆解 M05）。
 *
 * 三块：**概括预览**（条目统计 / 今日待办 / 最近动态）→ **快捷方式** → **快速导航**。
 * 数据全部由本地元数据算出来，**不发额外请求**（页头与卡片头部都标了来源）。
 *
 * 「已锁定」占位（Q7）：统计**不区分锁定状态**（它算的是"总共有多少"），只有**来自 Memo 的内容预览**
 * 在 `memoLocked` 时以占位代替。M2 没有门禁，所以这个开关恒为 false——留成 prop 是为了让 M3 接门禁时
 * 只改传参，界面逻辑已经在位、也已有用例覆盖两条分支。
 */
import type { LocalItem } from "../../../data/db";
import { Icon } from "../../../app/ui/Icon";
import { homeStats, openTaskPreview, recentPreview, topTags } from "../model";
import { QuickNav } from "./QuickNav";
import { RecentActivity } from "./RecentActivity";
import { ShortcutGrid } from "./ShortcutGrid";
import { StatCards } from "./StatCards";
import { TodayTasks } from "./TodayTasks";

export interface HomePanelProps {
  /** 未删除的笔记与表格（不含 Memo） */
  items: readonly LocalItem[];
  /** 未删除的 Memo */
  memos: readonly LocalItem[];
  folders: ReadonlyArray<{ id: string; name: string }>;
  /** 条目正文首行（待办预览的标题来源） */
  titles: Readonly<Record<string, string>>;
  /** Memo 门禁是否锁着（M2 恒 false；M3 接门禁后传真实状态） */
  memoLocked?: boolean;
  onNewNote: () => void;
  onFocusComposer: (mode: "memo" | "task") => void;
  onFocusSearch: () => void;
  onOpenItem: (itemId: string) => void;
  onOpenView: (view: "recent" | "starred" | "memo" | "task" | "notebook") => void;
  onOpenFolder: (folderId: string) => void;
  onOpenTag: (tag: string) => void;
}

export function HomePanel({
  items,
  memos,
  folders,
  titles,
  memoLocked = false,
  onNewNote,
  onFocusComposer,
  onFocusSearch,
  onOpenItem,
  onOpenView,
  onOpenFolder,
  onOpenTag,
}: HomePanelProps) {
  const stats = homeStats([...items, ...memos]);
  const tasks = openTaskPreview(memos, titles);
  const recent = recentPreview(items);
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
        <div className="home__grid">
          <StatCards stats={stats} memoLocked={memoLocked} />
          <TodayTasks tasks={tasks} memoLocked={memoLocked} onOpenItem={onOpenItem} />
          <RecentActivity
            entries={recent}
            memoCount={stats.memos}
            memoLocked={memoLocked}
            onOpenItem={onOpenItem}
          />
        </div>

        <ShortcutGrid
          onNewNote={onNewNote}
          onFocusComposer={onFocusComposer}
          onFocusSearch={onFocusSearch}
        />

        <QuickNav
          folders={folders}
          tags={tags}
          onOpenFolder={onOpenFolder}
          onOpenTag={onOpenTag}
          onOpenView={onOpenView}
        />
      </div>
    </section>
  );
}

/** 卡片外壳：标题 + 右上角来源说明（"本地计算"/"来自清单 Memo"） */
export function HomeCard({
  title,
  icon,
  note,
  children,
}: {
  title: string;
  icon: "info" | "check-square" | "clock";
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="home-card">
      <div className="home-card__hd">
        <Icon name={icon} size={13} />
        <h3>{title}</h3>
        {note ? <span className="home-card__note">{note}</span> : null}
      </div>
      <div className="home-card__bd">{children}</div>
    </div>
  );
}

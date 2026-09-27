/**
 * 待办视图（components.md §七 `TaskPanel`；需求 §9.4、功能拆解 M06-10）。
 *
 * 独立的浏览入口（在 Memo 之后）：顶部是视图切换（列表 / 看板）与筛选栏，下面是内容。
 * 清单条目**仍然出现在 Memo 时间轴**（不动数据模型）；待办视图**不受置顶影响**（Q9）。
 *
 * 「今天」在这里只取一次（渲染期调 `Date.now()` 不纯）；日期口径按设置时区算。
 */
import { useState } from "react";
import type { LocalItem } from "../../../data/db";
import { isMemoVisible, type PrivacyGate } from "@menote/shared";
import { LockedPlaceholder } from "../../../app/ui/LockedPlaceholder";
import { SegmentedControl } from "../../../app/ui/SegmentedControl";
import type { TaskStatus } from "@menote/mdcore";
import { countByStatus, EMPTY_TASK_FILTER, filterTasks, TASK_COLUMNS, type TaskFilter } from "../model";
import { TaskFilterBar } from "./TaskFilterBar";
import { TaskKanban } from "./TaskKanban";
import { TaskListView } from "./TaskListView";

export type TaskViewMode = "list" | "kanban";

const VIEW_MODES = [
  { value: "list" as const, label: "列表" },
  { value: "kanban" as const, label: "看板" },
];

export interface TaskPanelProps {
  tasks: readonly LocalItem[];
  /** 条目标题（正文首行），由调用方从 Memo 正文剥出来 */
  titles: Readonly<Record<string, string>>;
  /** 今天的 `YYYY-MM-DD`（按设置时区算好） */
  today: string;
  /**
   * 隐私门禁（M3-5）：待办是 Memo 派生的，Memo 锁定时**整屏占位**
   * （清单条目的内容也在 Memo 正文里，所以与 Memo 同生共死）。
   */
  gate: PrivacyGate;
  /** 占位上的「解锁」出口（打开解锁框） */
  onUnlock: () => void;
  onStatusChange: (itemId: string, status: TaskStatus) => void;
  onClearMarker: (itemId: string) => void;
}

export function TaskPanel({
  tasks,
  titles,
  today,
  gate,
  onUnlock,
  onStatusChange,
  onClearMarker,
}: TaskPanelProps) {
  const [mode, setMode] = useState<TaskViewMode>("list");
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_TASK_FILTER);

  const visible = filterTasks(tasks, filter, today);
  const counts = countByStatus(tasks);
  const total = TASK_COLUMNS.reduce((sum, column) => sum + counts[column.status], 0);

  if (!isMemoVisible(gate)) {
    // 锁定时整屏占位：保留标题与计数（统计口径不变），筛选与内容一律不渲染
    return (
      <section className="taskpanel" aria-label="待办">
        <header className="memopanel__head">
          <h2 className="memopanel__title">待办</h2>
          <span className="listpane__count">共 {total} 条</span>
        </header>
        <div className="taskpanel__body scroll-thin">
          <LockedPlaceholder
            title="待办已锁定"
            hint="待办来自 Memo 正文；隐私锁已锁定时不显示内容与状态。解锁后即可查看。"
            onUnlock={onUnlock}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="taskpanel" aria-label="待办">
      <header className="memopanel__head">
        <h2 className="memopanel__title">待办</h2>
        <span className="listpane__count">
          共 {total} 条 · 待办 {counts.todo} · 进行中 {counts.doing} · 已完成 {counts.done}
        </span>
        <SegmentedControl
          ariaLabel="待办视图切换"
          size="compact"
          value={mode}
          onChange={setMode}
          options={VIEW_MODES}
        />
      </header>

      <TaskFilterBar filter={filter} onChange={setFilter} />

      <div className="taskpanel__body scroll-thin">
        {mode === "list" ? (
          <TaskListView
            tasks={visible}
            titles={titles}
            today={today}
            onStatusChange={onStatusChange}
            onClearMarker={onClearMarker}
          />
        ) : (
          <TaskKanban
            tasks={visible}
            titles={titles}
            today={today}
            onStatusChange={onStatusChange}
            onClearMarker={onClearMarker}
          />
        )}
      </div>
    </section>
  );
}

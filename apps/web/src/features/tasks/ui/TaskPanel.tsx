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
  onStatusChange: (itemId: string, status: TaskStatus) => void;
  onClearMarker: (itemId: string) => void;
}

export function TaskPanel({
  tasks,
  titles,
  today,
  onStatusChange,
  onClearMarker,
}: TaskPanelProps) {
  const [mode, setMode] = useState<TaskViewMode>("list");
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_TASK_FILTER);

  const visible = filterTasks(tasks, filter, today);
  const counts = countByStatus(tasks);
  const total = TASK_COLUMNS.reduce((sum, column) => sum + counts[column.status], 0);

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

      <div className="taskpanel__body">
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

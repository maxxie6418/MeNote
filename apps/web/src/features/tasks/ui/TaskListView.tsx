/**
 * 待办列表视图（components.md §七 `TaskListView`）。
 *
 * 按状态分组（待办 → 进行中 → 已完成），组内按"有截止在前 → 优先级"排序（见 `../model`）。
 * 待办视图**不受置顶影响**（Q9）。
 */
import type { LocalItem } from "../../../data/db";
import type { TaskStatus } from "@menote/mdcore";
import { groupTasks } from "../model";
import { TaskCard } from "./TaskCard";

export interface TaskListViewProps {
  tasks: readonly LocalItem[];
  titles: Readonly<Record<string, string>>;
  today: string;
  onStatusChange: (itemId: string, status: TaskStatus) => void;
  onClearMarker: (itemId: string) => void;
}

export function TaskListView({
  tasks,
  titles,
  today,
  onStatusChange,
  onClearMarker,
}: TaskListViewProps) {
  const groups = groupTasks(tasks).filter((group) => group.tasks.length > 0);

  if (groups.length === 0) {
    return (
      <div className="memo-empty">
        <p className="memo-empty__title">没有符合条件的待办</p>
        <p className="memo-empty__hint">
          在录入框切到「待办」记一条，或者放宽上面的筛选条件。
        </p>
      </div>
    );
  }

  return (
    <div className="tasklist">
      {groups.map((group) => (
        <section key={group.status} className="tasklist__group" aria-label={group.label}>
          <h3 className="tasklist__head">
            {group.label}
            <span className="tasklist__count">{group.tasks.length}</span>
          </h3>
          {group.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              title={titles[task.id] ?? "未命名"}
              today={today}
              onStatusChange={onStatusChange}
              onClearMarker={onClearMarker}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

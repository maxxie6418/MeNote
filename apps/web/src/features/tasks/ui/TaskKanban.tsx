/**
 * 待办看板（components.md §七 `TaskKanban`；需求 §9.4「列表 / 看板」）。
 *
 * 三列固定顺序：待办 / 进行中 / 已完成。**改状态用卡片上的文字按钮**（"开始 / 完成 / 重开"）——
 * 需求里写的是"点卡片改状态**或**拖到另一列"，按钮这条路是无障碍友好、且不依赖拖拽实现的那一条；
 * 拖拽留待移动端适配时再补（DESIGN.md 禁止项 #16：不把拖拽当唯一入口）。
 */
import type { LocalItem } from "../../../data/db";
import type { TaskStatus } from "@menote/mdcore";
import { groupTasks } from "../model";
import { TaskCard } from "./TaskCard";

export interface TaskKanbanProps {
  tasks: readonly LocalItem[];
  titles: Readonly<Record<string, string>>;
  today: string;
  onStatusChange: (itemId: string, status: TaskStatus) => void;
  onClearMarker: (itemId: string) => void;
}

export function TaskKanban({
  tasks,
  titles,
  today,
  onStatusChange,
  onClearMarker,
}: TaskKanbanProps) {
  const columns = groupTasks(tasks);

  return (
    <div className="kanban">
      {columns.map((column) => (
        <section key={column.status} className="kanban__col" aria-label={column.label}>
          <h3 className="kanban__head">
            {column.label}
            <span className="tasklist__count">{column.tasks.length}</span>
          </h3>
          <div className="kanban__body">
            {column.tasks.length === 0 ? (
              <p className="kanban__empty">暂无</p>
            ) : (
              column.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  title={titles[task.id] ?? "未命名"}
                  today={today}
                  onStatusChange={onStatusChange}
                  onClearMarker={onClearMarker}
                />
              ))
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

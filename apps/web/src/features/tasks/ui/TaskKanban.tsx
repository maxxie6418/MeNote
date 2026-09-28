/**
 * 待办看板（components.md §七 `TaskKanban`；需求 §9.4「列表 / 看板」）。
 *
 * 三列固定顺序：待办 / 进行中 / 已完成。**改状态用卡片上的文字按钮**（"开始 / 完成 / 重开"）——
 * 需求里写的是"点卡片改状态**或**拖到另一列"，按钮这条路是无障碍友好、且不依赖拖拽实现的那一条；
 * 拖拽留待移动端适配时再补（DESIGN.md 禁止项 #16：不把拖拽当唯一入口）。
 *
 * 【v0.5.2】卡片标题可点开右侧详情（与清单行同一套入口）；「隐藏已完成」不影响看板——
 * 三列本身就是状态的全貌，列头已经写着状态与条数（定稿口径）。
 */
import type { LocalItem } from "../../../data/db";
import type { TaskStatus } from "@menote/mdcore";
import { groupTasks } from "../model";
import { TaskCard } from "./TaskCard";

export interface TaskKanbanProps {
  tasks: readonly LocalItem[];
  titles: Readonly<Record<string, string>>;
  today: string;
  /** 正打开详情的那一条（`null` = 没有） */
  openId: string | null;
  onOpen: (itemId: string) => void;
  onStatusChange: (itemId: string, status: TaskStatus) => void;
  onClearMarker: (itemId: string) => void;
}

export function TaskKanban({
  tasks,
  titles,
  today,
  openId,
  onOpen,
  onStatusChange,
  onClearMarker,
}: TaskKanbanProps) {
  const columns = groupTasks(tasks);

  return (
    <div className="kanban">
      {columns.map((column) => (
        <section key={column.status} className="kanban__col" aria-label={column.label}>
          <h3 className="kanban__head">
            {/* 列头圆点（原型 `.tkgrp__dot`）：颜色不单独表意，旁边就是列名与条数 */}
            <span
              className={`tasklist__dot tasklist__dot--${column.status}`}
              aria-hidden="true"
            />
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
                  open={openId === task.id}
                  onOpen={onOpen}
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

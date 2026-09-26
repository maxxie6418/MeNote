/**
 * 待办卡片（列表与看板共用同一张卡，避免两套渲染逻辑）。
 *
 * 显示：正文首行（标题）、截止、优先级、状态按钮；操作：切换状态、清除清单标记（Q23）。
 * 状态用**文字按钮**而不是只有颜色的小圆点（DESIGN.md 禁止项 #4：状态不能只靠颜色）。
 */
import type { LocalItem } from "../../../data/db";
import { Chip } from "../../../app/ui/Chip";
import { DropdownMenu } from "../../../app/ui/Menu";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, type TaskStatus } from "@menote/mdcore";
import { statusOf } from "../model";

/** 卡片上那个按钮的文字：推进到下一个状态，已完成则重开 */
function nextAction(status: TaskStatus): { label: string; next: TaskStatus } {
  if (status === "todo") return { label: "开始", next: "doing" };
  if (status === "doing") return { label: "完成", next: "done" };
  return { label: "重开", next: "todo" };
}

export interface TaskCardProps {
  task: LocalItem;
  /** 正文首行（没有就退回"未命名"） */
  title: string;
  today: string;
  onStatusChange: (itemId: string, status: TaskStatus) => void;
  onClearMarker: (itemId: string) => void;
}

export function TaskCard({ task, title, today, onStatusChange, onClearMarker }: TaskCardProps) {
  const status = statusOf(task);
  const action = nextAction(status);
  const overdue = task.task_due !== null && task.task_due < today && status !== "done";

  return (
    <article className="taskcard" data-task-id={task.id} data-status={status}>
      <div className="taskcard__main">
        <span className="taskcard__title">{title}</span>
        <div className="taskcard__meta">
          {task.task_due ? (
            <Chip variant="compact" tone={overdue ? "red" : "neutral"}>
              截止 {task.task_due}
              {overdue ? " · 已逾期" : ""}
            </Chip>
          ) : null}
          {task.task_priority ? (
            <Chip variant="compact" tone={task.task_priority === "high" ? "amber" : "neutral"}>
              优先级 {TASK_PRIORITY_LABELS[task.task_priority as "high" | "medium" | "low"] ?? task.task_priority}
            </Chip>
          ) : null}
          <span className="taskcard__status">{TASK_STATUS_LABELS[status]}</span>
        </div>
      </div>

      <div className="taskcard__actions">
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => onStatusChange(task.id, action.next)}
        >
          {action.label}
        </button>
        <DropdownMenu
          label={`${title} 的更多操作`}
          showChevron={false}
          trigger={<span aria-hidden="true">⋯</span>}
          items={[
            {
              id: "clear",
              label: "去掉清单标记",
              icon: "note",
              title: "删掉 YAML 里的 task 字段，条目仍留在 Memo 时间轴（Q23）",
              onSelect: () => onClearMarker(task.id),
            },
          ]}
        />
      </div>
    </article>
  );
}

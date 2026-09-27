/**
 * 待办卡片（**看板**用；原型 `.tkcard` 也是卡片，所以两种形态各有其位）。
 *
 * 显示：正文首行（标题）、截止、优先级、状态按钮；操作：切换状态、清除清单标记（Q23）。
 * 状态用**文字按钮**而不是只有颜色的小圆点（`DESIGN.md` 禁止项 #4：状态不能只靠颜色）。
 *
 * 【v0.5.2】标题从 `<span>` 改成 `<button>`：原型里点标题打开右侧详情。类名不变
 * （`.taskcard__title`），`aria-expanded` 反映这一条的详情开着没有。
 */
import type { LocalItem } from "../../../data/db";
import { Chip } from "../../../app/ui/Chip";
import { Icon } from "../../../app/ui/Icon";
import { DropdownMenu } from "../../../app/ui/Menu";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, type TaskStatus } from "@menote/mdcore";
import { isOverdue, statusOf, taskAdvance } from "../model";

export interface TaskCardProps {
  task: LocalItem;
  /** 正文首行（没有就退回"未命名"） */
  title: string;
  today: string;
  /** 这一条的详情是否正开着（选中标记 + `aria-expanded`） */
  open: boolean;
  onOpen: (itemId: string) => void;
  onStatusChange: (itemId: string, status: TaskStatus) => void;
  onClearMarker: (itemId: string) => void;
}

export function TaskCard({
  task,
  title,
  today,
  open,
  onOpen,
  onStatusChange,
  onClearMarker,
}: TaskCardProps) {
  const status = statusOf(task);
  const action = taskAdvance(status);
  const overdue = isOverdue(task, today);

  return (
    <article
      className="taskcard"
      data-task-id={task.id}
      data-status={status}
      /* 逾期标记：样式按原型给左侧一条红边（`data-overdue` 只作展示标记，不改数据） */
      data-overdue={overdue ? "true" : "false"}
      data-open={open ? "true" : "false"}
    >
      <div className="taskcard__main">
        <button
          type="button"
          className="taskcard__title"
          aria-expanded={open}
          title="查看详情"
          onClick={() => onOpen(task.id)}
        >
          {title}
        </button>
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
          trigger={<Icon name="more" size={13} />}
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

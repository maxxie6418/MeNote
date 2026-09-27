/**
 * 待办**清单行**（`features/tasks/ui/`；按用户原型 `.tkrow` / `.tkrows` / `.tkcheck`）。
 *
 * 与 `TaskCard` 的分工：**看板用卡片**（`.tkcard`，原型也是卡片）、**清单用行**（`.tkrow`）。
 * 行是"横向一行"：`[复选框] [标题] [元信息] [操作]`，同一个分组里的行装在一个圆角容器里，
 * 行之间用一条细线分隔（原型 `.tkrows` + `.tkrow + .tkrow`）。
 *
 * 复选框是**原生 `input[type=checkbox]`**：勾选即"完成 / 重开"（仓库里复选框一律用原生——
 * 设置页、列面板、回收站、表格复选格都是这么做的）。状态仍然**有文字**（右侧的推进按钮），
 * 不单靠复选框的勾来表达（`DESIGN.md` 禁止项 #4）。
 *
 * 【v0.5.2】标题从 `<span>` 改成 `<button>`：原型里点标题打开右侧详情（原型注释也写明
 * "真实实现里应换成真按钮"）。类名不变（`.taskrow__title`），所以样式与既有结构断言都还成立；
 * `aria-expanded` 如实反映"这一条的详情开着没有"。
 */
import type { LocalItem } from "../../../data/db";
import { Chip } from "../../../app/ui/Chip";
import { Icon } from "../../../app/ui/Icon";
import { DropdownMenu } from "../../../app/ui/Menu";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, type TaskStatus } from "@menote/mdcore";
import { isOverdue, statusOf, taskAdvance } from "../model";

export interface TaskRowProps {
  task: LocalItem;
  /** 正文首行（没有就退回"未命名"） */
  title: string;
  today: string;
  /** 这一条的详情是否正开着（选中标记 + `aria-expanded`） */
  open: boolean;
  /** 点标题打开 / 关闭详情（再点同一条即收起） */
  onOpen: (itemId: string) => void;
  onStatusChange: (itemId: string, status: TaskStatus) => void;
  onClearMarker: (itemId: string) => void;
}

export function TaskRow({
  task,
  title,
  today,
  open,
  onOpen,
  onStatusChange,
  onClearMarker,
}: TaskRowProps) {
  const status = statusOf(task);
  const action = taskAdvance(status);
  const overdue = isOverdue(task, today);

  return (
    <article
      className="taskrow"
      data-task-id={task.id}
      data-status={status}
      data-overdue={overdue ? "true" : "false"}
      data-open={open ? "true" : "false"}
    >
      <input
        type="checkbox"
        className="taskrow__check"
        checked={status === "done"}
        aria-label={`${title}：${status === "done" ? "已完成" : "未完成"}`}
        onChange={() => onStatusChange(task.id, status === "done" ? "todo" : "done")}
      />

      <button
        type="button"
        className="taskrow__title"
        aria-expanded={open}
        title="查看详情"
        onClick={() => onOpen(task.id)}
      >
        {title}
      </button>

      <span className="taskrow__meta">
        {task.task_due ? (
          <Chip variant="compact" tone={overdue ? "red" : "neutral"}>
            截止 {task.task_due}
            {overdue ? " · 已逾期" : ""}
          </Chip>
        ) : null}
        {task.task_priority ? (
          <Chip variant="compact" tone={task.task_priority === "high" ? "amber" : "neutral"}>
            优先级{" "}
            {TASK_PRIORITY_LABELS[task.task_priority as "high" | "medium" | "low"] ??
              task.task_priority}
          </Chip>
        ) : null}
        <span className="taskrow__status">{TASK_STATUS_LABELS[status]}</span>
      </span>

      <span className="taskrow__actions">
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
      </span>
    </article>
  );
}

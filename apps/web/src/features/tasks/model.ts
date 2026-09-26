/**
 * 待办视图的排序与筛选（功能拆解 M07-03/M07-04、M06-10；Q9）。
 *
 * 口径：
 * - **按状态分列/分组**：待办 → 进行中 → 已完成（顺序固定，不做"看板列可拖排序"）；
 * - 组内排序：**有截止的在前**（按日期升序）→ 无截止的在后 → 同日期按优先级（高 → 中 → 低）；
 * - **待办视图不受置顶影响**（Q9：置顶只作用于 Memo 时间轴）；
 * - 筛选**纯本地**（状态 / 优先级 / 截止范围），不发请求。
 *
 * 状态与优先级的字面量来自 `@menote/mdcore`（前后端同一份），这里只做展示与排序。
 */
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from "@menote/mdcore";

export interface TaskLike {
  id: string;
  is_task: number;
  task_status: string | null;
  task_due: string | null;
  task_priority: string | null;
  updated_at: number;
}

/** 看板的三列 / 列表的三个分组（顺序即展示顺序） */
export const TASK_COLUMNS: ReadonlyArray<{ status: TaskStatus; label: string }> = TASK_STATUSES.map(
  (status) => ({ status, label: TASK_STATUS_LABELS[status] }),
);

/** 未设置状态时视为"待办"（M07-03：新建清单默认状态待办） */
export function statusOf(task: TaskLike): TaskStatus {
  const status = task.task_status;
  return (TASK_STATUSES as readonly string[]).includes(status ?? "")
    ? (status as TaskStatus)
    : "todo";
}

/** 优先级权重：高 → 中 → 低；未设置排最后 */
function priorityWeight(priority: string | null): number {
  const index = (TASK_PRIORITIES as readonly string[]).indexOf(priority ?? "");
  return index === -1 ? TASK_PRIORITIES.length : index;
}

/** 组内排序：有截止在前（日期升序）→ 无截止在后；同日期按优先级 */
export function compareTasks(a: TaskLike, b: TaskLike): number {
  const aDue = a.task_due;
  const bDue = b.task_due;
  if (aDue !== bDue) {
    if (aDue === null) return 1;
    if (bDue === null) return -1;
    if (aDue !== bDue) return aDue < bDue ? -1 : 1;
  }
  const byPriority = priorityWeight(a.task_priority) - priorityWeight(b.task_priority);
  if (byPriority !== 0) return byPriority;
  // 最后用最近更新兜底，保证顺序稳定
  return b.updated_at - a.updated_at;
}

export interface TaskGroup<T extends TaskLike> {
  status: TaskStatus;
  label: string;
  tasks: T[];
}

/** 按状态分组并排好序（空分组也保留：看板要显示空列） */
export function groupTasks<T extends TaskLike>(tasks: readonly T[]): Array<TaskGroup<T>> {
  const onlyTasks = tasks.filter((task) => task.is_task === 1);
  return TASK_COLUMNS.map(({ status, label }) => ({
    status,
    label,
    tasks: onlyTasks.filter((task) => statusOf(task) === status).sort(compareTasks),
  }));
}

/** 每个状态的条数（筛选栏与看板列头用） */
export function countByStatus(tasks: readonly TaskLike[]): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0 };
  for (const task of tasks) {
    if (task.is_task !== 1) continue;
    counts[statusOf(task)] += 1;
  }
  return counts;
}

export const DUE_RANGES = [
  { value: "all", label: "全部" },
  { value: "overdue", label: "已逾期" },
  { value: "today", label: "今天" },
  { value: "week", label: "7 天内" },
  { value: "none", label: "未设日期" },
] as const;

export type DueRange = (typeof DUE_RANGES)[number]["value"];

export interface TaskFilter {
  status: TaskStatus | "all";
  priority: TaskPriority | "all";
  due: DueRange;
}

export const EMPTY_TASK_FILTER: TaskFilter = { status: "all", priority: "all", due: "all" };

/** 今天（`YYYY-MM-DD`，UTC+8 口径由调用方传入的 `today` 决定，便于测试） */
export function addDays(isoDay: string, days: number): string {
  const base = Date.parse(`${isoDay}T00:00:00Z`);
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 纯本地筛选：状态 / 优先级 / 截止范围。
 * `today` 是"今天"的 `YYYY-MM-DD`（由界面按设置时区算好后传入，这里不做时区判断）。
 */
export function filterTasks<T extends TaskLike>(
  tasks: readonly T[],
  filter: TaskFilter,
  today: string,
): T[] {
  const weekEnd = addDays(today, 7);
  return tasks.filter((task) => {
    if (task.is_task !== 1) return false;
    if (filter.status !== "all" && statusOf(task) !== filter.status) return false;
    if (filter.priority !== "all" && task.task_priority !== filter.priority) return false;

    switch (filter.due) {
      case "overdue":
        // 逾期：有日期、日期已过、且还没完成
        return (
          task.task_due !== null && task.task_due < today && statusOf(task) !== "done"
        );
      case "today":
        return task.task_due === today;
      case "week":
        return task.task_due !== null && task.task_due >= today && task.task_due <= weekEnd;
      case "none":
        return task.task_due === null;
      default:
        return true;
    }
  });
}

/** 优先级筛选项（含"全部"） */
export const PRIORITY_OPTIONS: ReadonlyArray<{ value: TaskPriority | "all"; label: string }> = [
  { value: "all", label: "全部优先级" },
  ...TASK_PRIORITIES.map((priority) => ({
    value: priority,
    label: TASK_PRIORITY_LABELS[priority],
  })),
];

/**
 * 待办卡片上的标题：取正文第一行（去掉 Markdown 标记），最多 60 字。
 * 清单条目也是 Memo，没有标题列，所以标题就从内容来（与 Q10 取首行同一口径）。
 */
export function taskTitle(content: string): string {
  for (const rawLine of content.split("\n")) {
    const line = rawLine
      .replace(/^#{1,6}\s*/, "")
      .replace(/^[-*+]\s+(\[[ xX]\]\s*)?/, "")
      .replace(/[`*_>]/g, "")
      .trim();
    if (line === "") continue;
    return line.length > 60 ? `${line.slice(0, 60)}…` : line;
  }
  return "未命名";
}

/** 状态筛选项（含"全部"） */
export const STATUS_OPTIONS: ReadonlyArray<{ value: TaskStatus | "all"; label: string }> = [
  { value: "all", label: "全部状态" },
  ...TASK_COLUMNS.map(({ status, label }) => ({ value: status, label })),
];

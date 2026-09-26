import { describe, expect, it } from "vitest";
import {
  addDays,
  compareTasks,
  countByStatus,
  EMPTY_TASK_FILTER,
  filterTasks,
  groupTasks,
  statusOf,
  taskTitle,
  type TaskLike,
} from "../src/features/tasks/model";

function task(id: string, extra: Partial<TaskLike> = {}): TaskLike {
  return {
    id,
    is_task: 1,
    task_status: null,
    task_due: null,
    task_priority: null,
    updated_at: 1,
    ...extra,
  };
}

const TODAY = "2026-09-26";

describe("任务状态与排序", () => {
  it("未设置状态视为待办（M07-03：新建清单默认待办）", () => {
    expect(statusOf(task("a"))).toBe("todo");
    expect(statusOf(task("b", { task_status: "doing" }))).toBe("doing");
    // 非法值也不会让界面崩：归到待办
    expect(statusOf(task("c", { task_status: "进行中" }))).toBe("todo");
  });

  it("组内：有截止的在前（日期升序），无截止的在后", () => {
    const sorted = [task("none"), task("late", { task_due: "2026-10-01" }), task("soon", { task_due: "2026-09-27" })]
      .sort(compareTasks)
      .map((item) => item.id);
    expect(sorted).toEqual(["soon", "late", "none"]);
  });

  it("同为无截止时按优先级（高 → 中 → 低 → 未设置）", () => {
    const sorted = [
      task("none"),
      task("low", { task_priority: "low" }),
      task("high", { task_priority: "high" }),
    ]
      .sort(compareTasks)
      .map((item) => item.id);
    expect(sorted).toEqual(["high", "low", "none"]);
  });

  it("同日期同优先级按最近更新倒序（顺序稳定）", () => {
    const sorted = [
      task("old", { task_due: TODAY, updated_at: 1 }),
      task("new", { task_due: TODAY, updated_at: 9 }),
    ]
      .sort(compareTasks)
      .map((item) => item.id);
    expect(sorted).toEqual(["new", "old"]);
  });
});

describe("分组与计数", () => {
  it("按状态分组，顺序固定为 待办 → 进行中 → 已完成，空分组也保留", () => {
    const groups = groupTasks([task("a"), task("b", { task_status: "done" })]);
    expect(groups.map((group) => group.status)).toEqual(["todo", "doing", "done"]);
    expect(groups.map((group) => group.tasks.length)).toEqual([1, 0, 1]);
    expect(groups.map((group) => group.label)).toEqual(["待办", "进行中", "已完成"]);
  });

  it("非清单条目不进待办视图", () => {
    expect(groupTasks([task("a", { is_task: 0 }), task("b")])[0]?.tasks.map((t) => t.id)).toEqual(["b"]);
  });

  it("计数不含非清单条目", () => {
    expect(
      countByStatus([
        task("a"),
        task("b", { task_status: "doing" }),
        task("c", { task_status: "done" }),
        task("d", { task_status: "done" }),
        task("e", { is_task: 0 }),
      ]),
    ).toEqual({ todo: 1, doing: 1, done: 2 });
  });
});

describe("筛选（纯本地）", () => {
  const tasks = [
    task("overdue", { task_due: "2026-09-20", task_priority: "high" }),
    task("today", { task_due: TODAY, task_priority: "medium" }),
    task("soon", { task_due: "2026-09-30", task_priority: "low" }),
    task("far", { task_due: "2026-11-01" }),
    task("none"),
    task("doneOverdue", { task_due: "2026-09-01", task_status: "done" }),
  ];

  it("默认不筛", () => {
    expect(filterTasks(tasks, EMPTY_TASK_FILTER, TODAY)).toHaveLength(6);
  });

  it("状态筛选", () => {
    expect(filterTasks(tasks, { ...EMPTY_TASK_FILTER, status: "done" }, TODAY).map((t) => t.id)).toEqual([
      "doneOverdue",
    ]);
  });

  it("优先级筛选", () => {
    expect(filterTasks(tasks, { ...EMPTY_TASK_FILTER, priority: "high" }, TODAY).map((t) => t.id)).toEqual([
      "overdue",
    ]);
  });

  it("逾期：有日期、已过、且未完成", () => {
    expect(filterTasks(tasks, { ...EMPTY_TASK_FILTER, due: "overdue" }, TODAY).map((t) => t.id)).toEqual([
      "overdue",
    ]);
  });

  it("今天 / 7 天内 / 未设日期", () => {
    expect(filterTasks(tasks, { ...EMPTY_TASK_FILTER, due: "today" }, TODAY).map((t) => t.id)).toEqual([
      "today",
    ]);
    expect(filterTasks(tasks, { ...EMPTY_TASK_FILTER, due: "week" }, TODAY).map((t) => t.id)).toEqual([
      "today",
      "soon",
    ]);
    expect(filterTasks(tasks, { ...EMPTY_TASK_FILTER, due: "none" }, TODAY).map((t) => t.id)).toEqual(["none"]);
  });

  it("多条件是叠加的", () => {
    expect(
      filterTasks(tasks, { status: "todo", priority: "high", due: "overdue" }, TODAY),
    ).toHaveLength(1);
    expect(
      filterTasks(tasks, { ...EMPTY_TASK_FILTER, status: "done", due: "overdue" }, TODAY),
    ).toHaveLength(0);
  });

  it("addDays 跨月跨年正确", () => {
    expect(addDays("2026-09-26", 7)).toBe("2026-10-03");
    expect(addDays("2026-12-30", 7)).toBe("2027-01-06");
  });
});

describe("卡片标题（取正文首行）", () => {
  it("去掉 Markdown 标记与清单方框", () => {
    expect(taskTitle("- [ ] 买牛奶\n\n顺便买鸡蛋")).toBe("买牛奶");
    expect(taskTitle("## 交物业费")).toBe("交物业费");
    expect(taskTitle("**重要**：写周报")).toBe("重要：写周报");
  });

  it("首行为空则往后找；全是空则给默认标题", () => {
    expect(taskTitle("\n\n第二行才是内容")).toBe("第二行才是内容");
    expect(taskTitle("\n  \n")).toBe("未命名");
  });

  it("过长截断到 60 字", () => {
    const title = taskTitle("字".repeat(80));
    expect([...title]).toHaveLength(61); // 60 字 + 省略号
    expect(title.endsWith("…")).toBe(true);
  });
});

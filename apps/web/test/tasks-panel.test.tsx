// @vitest-environment jsdom
/**
 * 待办视图（M2-5 验收点）：
 * - 列表 / 看板切换；看板三列固定顺序；
 * - 点卡片的文字按钮改状态（"开始 / 完成 / 重开"）；
 * - 状态 / 优先级 / 截止范围筛选（纯本地）；
 * - 去掉清单标记（Q23）入口；
 * - 状态不能只靠颜色（有文字）。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalItem } from "../src/data/db";
import { TaskPanel } from "../src/features/tasks/ui/TaskPanel";

afterEach(cleanup);

const TODAY = "2026-09-26";

function task(id: string, extra: Partial<LocalItem> = {}): LocalItem {
  return {
    id,
    type: "memo",
    folder_id: null,
    title: null,
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 10,
    content_hash: "h",
    tags: [],
    memo_at: Date.UTC(2026, 8, 26, 6, 0),
    is_task: 1,
    task_status: "todo",
    task_due: null,
    task_priority: null,
    pinned: 0,
    starred: 0,
    rev: 1,
    meta_rev: 1,
    sealed_rev: null,
    sync_seq: 1,
    created_at: 1,
    updated_at: 1,
    last_edit_at: 1,
    last_device: null,
    deleted_at: null,
    deleted: false,
    pending: null,
    ...extra,
  };
}

const TASKS = [
  task("t1", { task_status: "todo", task_due: "2026-09-20", task_priority: "high" }),
  task("t2", { task_status: "doing", task_due: TODAY, task_priority: "low" }),
  task("t3", { task_status: "done" }),
  task("notTask", { is_task: 0 }),
];

const TITLES = { t1: "交物业费", t2: "写周报", t3: "买牛奶", notTask: "随手一记" };

function renderPanel(overrides: Partial<Parameters<typeof TaskPanel>[0]> = {}) {
  const onStatusChange = vi.fn();
  const onClearMarker = vi.fn();
  const { container } = render(
    <TaskPanel
      tasks={TASKS}
      titles={TITLES}
      today={TODAY}
      onStatusChange={onStatusChange}
      onClearMarker={onClearMarker}
      {...overrides}
    />,
  );
  return { container, onStatusChange, onClearMarker };
}

/** 按文本取卡片（卡片上还有按钮，直接按 data 属性更稳） */
function card(container: HTMLElement, id: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-task-id="${id}"]`);
  if (!found) throw new Error(`没找到卡片：${id}`);
  return found;
}

describe("待办列表", () => {
  it("按状态分组显示，计数不含非清单条目", () => {
    const { container } = renderPanel();

    expect(container.textContent).toContain("共 3 条 · 待办 1 · 进行中 1 · 已完成 1");
    expect(container.textContent).toContain("交物业费");
    expect(container.textContent).not.toContain("随手一记"); // is_task = 0
  });

  it("卡片显示截止与优先级；逾期未完成的标出来", () => {
    const { container } = renderPanel();

    expect(within(card(container, "t1")).getByText(/截止 2026-09-20/)).toBeTruthy();
    expect(within(card(container, "t1")).getByText(/已逾期/)).toBeTruthy();
    expect(within(card(container, "t1")).getByText(/优先级 高/)).toBeTruthy();
    // 状态是文字而不是只有颜色
    expect(within(card(container, "t1")).getByText("待办")).toBeTruthy();
  });

  it("点「开始」把待办推进到进行中；已完成的卡片是「重开」", async () => {
    const user = userEvent.setup();
    const { container, onStatusChange } = renderPanel();

    await user.click(within(card(container, "t1")).getByRole("button", { name: "开始" }));
    expect(onStatusChange).toHaveBeenCalledWith("t1", "doing");

    await user.click(within(card(container, "t2")).getByRole("button", { name: "完成" }));
    expect(onStatusChange).toHaveBeenCalledWith("t2", "done");

    await user.click(within(card(container, "t3")).getByRole("button", { name: "重开" }));
    expect(onStatusChange).toHaveBeenCalledWith("t3", "todo");
  });

  it("去掉清单标记（Q23）在卡片的更多菜单里", async () => {
    const user = userEvent.setup();
    const { container, onClearMarker } = renderPanel();

    await user.click(within(card(container, "t1")).getByRole("button", { name: "交物业费 的更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "去掉清单标记" }));
    expect(onClearMarker).toHaveBeenCalledWith("t1");
  });
});

describe("看板", () => {
  it("三列固定顺序：待办 / 进行中 / 已完成，空列也保留", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel({
      tasks: [task("t1"), task("t3", { task_status: "done" })],
    });

    await user.click(screen.getByRole("button", { name: "看板" }));

    const columns = [...container.querySelectorAll(".kanban__col")];
    expect(columns).toHaveLength(3);
    expect(columns.map((col) => col.getAttribute("aria-label"))).toEqual([
      "待办",
      "进行中",
      "已完成",
    ]);
    expect(columns[1]?.textContent).toContain("暂无");
  });

  it("看板里同样能改状态（点卡片上的按钮，不依赖拖拽）", async () => {
    const user = userEvent.setup();
    const { container, onStatusChange } = renderPanel();

    await user.click(screen.getByRole("button", { name: "看板" }));
    await user.click(within(card(container, "t1")).getByRole("button", { name: "开始" }));
    expect(onStatusChange).toHaveBeenCalledWith("t1", "doing");
  });
});

describe("筛选（纯本地）", () => {
  it("按状态筛选", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    await user.click(screen.getByRole("button", { name: "已完成" }));
    expect(container.querySelectorAll(".taskcard")).toHaveLength(1);
    expect(container.textContent).toContain("买牛奶");
  });

  it("按优先级筛选", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    await user.click(screen.getByRole("button", { name: "高" }));
    expect(container.querySelectorAll(".taskcard")).toHaveLength(1);
    expect(container.textContent).toContain("交物业费");
  });

  it("按截止范围筛选：已逾期 / 今天 / 未设日期", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    await user.click(screen.getByRole("button", { name: "已逾期" }));
    expect(container.querySelectorAll(".taskcard")).toHaveLength(1);
    expect(container.textContent).toContain("交物业费");

    await user.click(screen.getByRole("button", { name: "全部" }));
    await user.click(screen.getByRole("button", { name: "未设日期" }));
    expect(container.querySelectorAll(".taskcard")).toHaveLength(1);
    expect(container.textContent).toContain("买牛奶");
  });

  it("筛完没有结果时给空状态与出口", async () => {
    const user = userEvent.setup();
    renderPanel({ tasks: [task("t1", { task_status: "todo" })] });

    await user.click(screen.getByRole("button", { name: "已完成" }));
    expect(screen.getByText("没有符合条件的待办")).toBeTruthy();
    expect(screen.getByText(/在录入框切到「待办」记一条/)).toBeTruthy();
  });
});

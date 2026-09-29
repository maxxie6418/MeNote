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
import { noPrivacyGate, privacyGateFrom } from "@menote/shared";
import type { LocalItem } from "../src/data/db";
import { TaskPanel } from "../src/features/tasks/ui/TaskPanel";
import { assertLabelledControls } from "./helpers/a11y";
import { assertSinglePrimaryAction } from "./helpers/design";

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

/** 正文（详情浮层的「描述」用它；这里给一条带换行的，顺便钉住"保留换行"的渲染） */
const BODIES = {
  t1: "交物业费\n9 月 20 日前",
  t2: "写周报",
  t3: "买牛奶",
};

function renderPanel(overrides: Partial<Parameters<typeof TaskPanel>[0]> = {}) {
  const onStatusChange = vi.fn();
  const onClearMarker = vi.fn();
  const onUnlock = vi.fn();
  const onAdd = vi.fn();
  const { container } = render(
    <TaskPanel
      tasks={TASKS}
      titles={TITLES}
      bodies={BODIES}
      today={TODAY}
      gate={noPrivacyGate()}
      onUnlock={onUnlock}
      onAdd={onAdd}
      filterForm="capsules"
      onStatusChange={onStatusChange}
      onClearMarker={onClearMarker}
      {...overrides}
    />,
  );
  // 读屏底线（渲染层断言，见 helpers/a11y.ts）——看板卡片上的状态按钮最容易漏名字
  assertLabelledControls(container, { buttons: 1 });
  assertSinglePrimaryAction(container);
  return { container, onStatusChange, onClearMarker, onUnlock, onAdd };
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

    // 概览给"总数 + 完成率"（原型 `.tksum`），**分状态计数挂在筛选条上**（原型如此，不重复）
    expect(container.textContent).toContain("共 3 条 · 已完成 1 条");
    expect(screen.getByRole("button", { name: "待办 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "进行中 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "已完成 1" })).toBeTruthy();
    expect(container.textContent).toContain("交物业费");
    expect(container.textContent).not.toContain("随手一记"); // is_task = 0
  });

  it("行内元信息照原型：逾期写「已逾期 · 日期」、优先级只写字；状态由分组名与推进按钮承载", () => {
    const { container } = renderPanel();

    // 原型 `.tkrow__meta`：状态在前、日期在后；优先级不带「优先级」三个字
    expect(within(card(container, "t1")).getByText(/已逾期 · 2026-09-20/)).toBeTruthy();
    expect(within(card(container, "t1")).getByText(/高/)).toBeTruthy();
    // 状态不靠颜色：推进按钮的文字（开始 / 完成 / 重开）与分组名都在
    expect(within(card(container, "t1")).getByRole("button", { name: "开始" })).toBeTruthy();
    expect(within(card(container, "t1")).queryByText("待办")).toBeNull();
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
  /*
    页头那条「列表 / 看板」切换：原型两项都带图标（`#i-list` / `#i-kanban`）。
    2026-09-29 修复前只有文字——用户反馈"待办的状态切换条缺少图标"。
  */
  it("页头的「列表 / 看板」两个按钮都带 sprite 图标（原型 `#i-list` / `#i-kanban`）", () => {
    const { container } = renderPanel();

    const group = container.querySelector('[aria-label="待办视图切换"]');
    expect(group).not.toBeNull();
    expect(group?.querySelector('use[href="#i-list"]')).not.toBeNull();
    expect(group?.querySelector('use[href="#i-kanban"]')).not.toBeNull();
    // 图标只是辅助，文字照旧在（DESIGN.md §5.5-4）
    expect(group?.textContent).toContain("列表");
    expect(group?.textContent).toContain("看板");
  });

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

  it("看板卡片上的「更多」同样是 sprite 的 `i-more`（与清单行同一个字形）", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    await user.click(screen.getByRole("button", { name: "看板" }));
    const kanbanCard = card(container, "t1");
    expect(kanbanCard.querySelector('use[href="#i-more"]')).not.toBeNull();
    expect(kanbanCard.textContent ?? "").not.toContain("⋯");
  });
});

describe("筛选（纯本地）", () => {
  it("按状态筛选", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    await user.click(screen.getByRole("button", { name: /^已完成/ }));
    expect(container.querySelectorAll(".taskrow")).toHaveLength(1);
    expect(container.textContent).toContain("买牛奶");
  });

  it("按优先级筛选", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    await user.click(screen.getByRole("button", { name: "高" }));
    expect(container.querySelectorAll(".taskrow")).toHaveLength(1);
    expect(container.textContent).toContain("交物业费");
  });

  it("按截止范围筛选：已逾期 / 今天 / 未设日期", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    await user.click(screen.getByRole("button", { name: "已逾期" }));
    expect(container.querySelectorAll(".taskrow")).toHaveLength(1);
    expect(container.textContent).toContain("交物业费");

    await user.click(screen.getByRole("button", { name: "全部" }));
    await user.click(screen.getByRole("button", { name: "未设日期" }));
    expect(container.querySelectorAll(".taskrow")).toHaveLength(1);
    expect(container.textContent).toContain("买牛奶");
  });

  it("筛完没有结果时给空状态与出口（出口开添加窗口，不再跳录入框）", async () => {
    const user = userEvent.setup();
    renderPanel({ tasks: [task("t1", { task_status: "todo" })] });

    await user.click(screen.getByRole("button", { name: /^已完成/ }));
    expect(screen.getByText("没有待办")).toBeTruthy();
    expect(screen.getByText(/点「添加待办」记一条/)).toBeTruthy();
    // 页头也有一个「添加待办」，故把空状态出口**限定在空块内**查
    const empty = screen.getByText("没有待办").closest(".memo-empty") as HTMLElement;
    expect(within(empty).getByRole("button", { name: /添加待办/ })).toBeTruthy();
  });

  it("隐私门禁锁定时整屏占位：不显示卡片与状态，且「解锁」是活出口（M3-5）", async () => {
    const user = userEvent.setup();
    const { container, onUnlock } = renderPanel({
      gate: privacyGateFrom({ scope: { memo: true }, search_bodies_when_unlocked: true }, "locked"),
    });

    expect(screen.getByText("待办已锁定")).toBeTruthy();
    expect(container.querySelectorAll(".taskrow")).toHaveLength(0);
    expect(screen.queryByText("交物业费")).toBeNull();
    // 计数仍显示（统计口径不变）
    expect(screen.getByText(/共 3 条/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /解锁/ }));
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });
});

describe("概览（原型 `.tksum`；v0.4.51 补）", () => {
  it("显示「共 N 条 · 已完成 M 条（P%）」与三段进度条", () => {
    const { container } = renderPanel();
    const summary = container.querySelector(".tksum");
    expect(summary?.textContent).toContain("共 3 条");
    expect(summary?.textContent).toContain("已完成");
    // 三段：done / doing / todo（原型顺序）
    const segments = [...(summary?.querySelectorAll(".tksum__bar span") ?? [])].map(
      (node) => node.className,
    );
    expect(segments).toEqual(["bar__done", "bar__doing", "bar__todo"]);
  });

  it("进度条是 `role=\"img\"` 且读屏文案把分段说清楚（条本身念不出占比）", () => {
    const { container } = renderPanel();
    const bar = container.querySelector(".tksum__bar");
    expect(bar?.getAttribute("role")).toBe("img");
    expect(bar?.getAttribute("aria-label")).toMatch(/待办 \d+ 条、进行中 \d+ 条、已完成 \d+ 条，共 \d+ 条/);
  });

  it("一条待办都没有时不画退化进度条（只留计数）", () => {
    const { container } = renderPanel({ tasks: [] });
    expect(container.querySelector(".tksum__bar")).toBeNull();
    expect(container.querySelector(".tksum")?.textContent).toContain("共 0 条");
  });
});

describe("清单行的结构（原型 `.tkrow`；v0.4.50 从卡片改成横向一行）", () => {
  it("一行 = 复选框 + 标题 + 元信息 + 操作（横向一行，不是卡片）", () => {
    const { container } = renderPanel();
    const row = container.querySelector(".taskrow");
    expect(row).not.toBeNull();
    const parts = [...(row?.children ?? [])].map((child) => child.className);
    expect(parts).toEqual([
      "taskrow__check",
      "taskrow__title",
      "taskrow__meta",
      "taskrow__actions",
    ]);
    // 清单用行、看板用卡片：默认（清单）视图里不该出现 `.taskcard`
    expect(container.querySelector(".taskcard")).toBeNull();
    // 行装在圆角容器里（原型 `.tkrows`）
    expect(container.querySelector(".tasklist__rows .taskrow")).not.toBeNull();
  });

  it("复选框：勾上即完成（原生 input，带可访问名字）", async () => {
    const user = userEvent.setup();
    const { onStatusChange } = renderPanel();

    await user.click(screen.getByRole("checkbox", { name: "交物业费：未完成" }));
    expect(onStatusChange).toHaveBeenCalledWith("t1", "done");
  });

  it("行内仍**有文字状态**（禁止项 #4：状态不能只靠复选框的勾）", () => {
    const { container } = renderPanel();
    const status = container.querySelector(".taskrow__status");
    expect(status?.textContent?.trim()).not.toBe("");
  });

  it("逾期行带 `data-overdue`（左侧红边靠它挂上）", () => {
    const { container } = renderPanel();
    // 夹具里 t1（交物业费）是已逾期那条
    expect(card(container, "t1").getAttribute("data-overdue")).toBe("true");
  });

  it("「更多」用 sprite 的 `i-more` 字形，不是文本字符（原型 `.tkrow__acts` 就是 `#i-more`）", () => {
    const { container } = renderPanel();
    const row = container.querySelector(".taskrow");
    expect(row?.querySelector('use[href="#i-more"]')).not.toBeNull();
    // 此前这里是 `⋯` 这个文本字符（v0.5.1 换掉）——字形与字号都不受控，且全仓其余「更多」都走 sprite
    expect(row?.textContent ?? "").not.toContain("⋯");
  });
});

describe("页头与筛选条（v0.5.2 按定稿 2026-09-27 调整）", () => {
  it("页头收成一条：标题 · 说明 ⓘ · 概览 · 视图切换 · 添加待办，同在一个 `.tkhead__main` 里", () => {
    const { container } = renderPanel();
    const head = container.querySelector(".tkhead__main");
    expect(head).not.toBeNull();
    expect(head?.querySelector(".memopanel__title")?.textContent).toBe("待办");
    expect(head?.querySelector(".infohint__btn")).not.toBeNull(); // 说明收进 InfoHint，不平铺
    expect(head?.querySelector(".tksum")).not.toBeNull(); // 实时计数仍然**可见**
    expect(head?.querySelector('[aria-label="待办视图切换"]')).not.toBeNull();
    expect(within(head as HTMLElement).getByRole("button", { name: "添加待办" })).toBeTruthy();
  });

  it("「添加待办」把请求交回组合根（打开添加内容窗口，不再跳录入框）", async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel();

    await user.click(screen.getByRole("button", { name: "添加待办" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("筛选条移进滚动容器（不再占页头一行），三个组名都在", () => {
    const { container } = renderPanel();

    // 位置：在滚动容器里（原型 `.page--task .page__scroll` 的第一个孩子）
    expect(container.querySelector(".taskpanel__body > .tkhead__dock > .taskfilter")).not.toBeNull();
    // 它不在页头里
    expect(container.querySelector(".tkhead__main .taskfilter")).toBeNull();
    // 组名（原型 `.tkhead__gl`）
    const labels = [...container.querySelectorAll(".tkhead__gl")].map((node) => node.textContent);
    expect(labels).toEqual(["状态", "优先级", "截止"]);
  });

  it("两种形态：胶囊横排是基线，悬浮小组件只多一个修饰类（样式在 CSS 里）", () => {
    const { container: capsules } = renderPanel({ filterForm: "capsules" });
    expect(capsules.querySelector(".tkhead__dock--float")).toBeNull();

    cleanup();
    const { container: floating } = renderPanel({ filterForm: "floating" });
    expect(floating.querySelector(".tkhead__dock--float .taskfilter")).not.toBeNull();
  });

  it("「隐藏已完成」开关与已完成分组头的收起按钮是**同一份状态**（定稿要求）", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    // 初始：已完成分组有行、开关未打开
    expect(container.querySelector('[data-task-id="t3"]')).not.toBeNull();
    expect(screen.getByRole("switch", { name: "隐藏已完成" }).getAttribute("aria-checked")).toBe(
      "false",
    );

    // 点分组头的收起按钮 → 行收起来，但**分组头与计数还在**（不让人以为数据没了）
    await user.click(screen.getByRole("button", { name: "收起已完成" }));
    expect(container.querySelector('[data-task-id="t3"]')).toBeNull();
    expect(container.textContent).toContain("已完成");
    // 顶部开关跟着变（同一份状态）
    expect(screen.getByRole("switch", { name: "隐藏已完成" }).getAttribute("aria-checked")).toBe(
      "true",
    );

    // 再用开关展开回来
    await user.click(screen.getByRole("switch", { name: "隐藏已完成" }));
    expect(container.querySelector('[data-task-id="t3"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "收起已完成" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("分组头有一条分隔线（原型 `.tkgrp__rule`）", () => {
    const { container } = renderPanel();
    const head = container.querySelector(".tasklist__head");
    expect(head?.querySelector(".tasklist__rule")).not.toBeNull();
  });

  it("看板下收起状态筛选与「隐藏已完成」（列头已承载状态与计数）", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    await user.click(screen.getByRole("button", { name: "看板" }));

    const labels = [...container.querySelectorAll(".tkhead__gl")].map((node) => node.textContent);
    expect(labels).toEqual(["优先级", "截止"]);
    expect(screen.queryByRole("switch", { name: "隐藏已完成" })).toBeNull();
    // 看板里三列照旧都在（隐藏已完成**不作用于看板**）
    expect(container.querySelectorAll(".kanban__col")).toHaveLength(3);
  });
});

describe("详情浮层（v0.5.2；原型 `.tdetail`）", () => {
  it("点清单行标题打开详情：面板出现、这一条被标为选中、标题按钮 aria-expanded 为真", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    expect(container.querySelector(".tdetail")).toBeNull();

    await user.click(within(card(container, "t1")).getByRole("button", { name: "交物业费" }));

    const detail = container.querySelector(".tdetail");
    expect(detail).not.toBeNull();
    // 详情在**滚动容器之外**（不推挤、也没把列表包住）——原型是绝对定位盖在界面上
    expect(container.querySelector(".taskpanel__wrap > .tdetail")).not.toBeNull();
    expect(card(container, "t1").getAttribute("data-open")).toBe("true");
    expect(
      within(card(container, "t1")).getByRole("button", { name: "交物业费" }).getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
    // 选中标记是"正在看的那条"，不改变别的行的状态
    expect(card(container, "t2").getAttribute("data-open")).toBe("false");
    // 单独断言详情区域里只有一个主操作（它和页头的「添加待办」是**两个区域**）
    assertSinglePrimaryAction(detail as HTMLElement);
  });

  it("详情给出标题、属性、描述与底部动作（描述保留正文换行）", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    await user.click(within(card(container, "t1")).getByRole("button", { name: "交物业费" }));
    const detail = container.querySelector(".tdetail") as HTMLElement;

    expect(within(detail).getByText("交物业费")).toBeTruthy();
    expect(within(detail).getByText(/截止 2026-09-20/)).toBeTruthy();
    expect(within(detail).getByText(/高/)).toBeTruthy();
    expect(within(detail).getByText("待办")).toBeTruthy();
    // 描述 = Memo 正文**原文**（换行保留——`textContent` 按原样比对，不走 testing-library 的空白归一化）
    expect(detail.querySelector(".tdetail__p")?.textContent).toBe("交物业费\n9 月 20 日前");
    expect(within(detail).getByRole("button", { name: "开始" })).toBeTruthy();
    expect(within(detail).getByRole("button", { name: "去掉清单标记" })).toBeTruthy();
  });

  it("详情里的推进按钮与行内是同一口径（同一个目标状态）", async () => {
    const user = userEvent.setup();
    const { container, onStatusChange } = renderPanel();

    await user.click(within(card(container, "t1")).getByRole("button", { name: "交物业费" }));
    const detail = container.querySelector(".tdetail") as HTMLElement;
    await user.click(within(detail).getByRole("button", { name: "开始" }));

    expect(onStatusChange).toHaveBeenCalledWith("t1", "doing");
  });

  it("点同一条再点一次收起；点另一条直接切过去（原型：不铺遮罩才能这么用）", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    await user.click(within(card(container, "t1")).getByRole("button", { name: "交物业费" }));
    await user.click(within(card(container, "t1")).getByRole("button", { name: "交物业费" }));
    expect(container.querySelector(".tdetail")).toBeNull();

    await user.click(within(card(container, "t1")).getByRole("button", { name: "交物业费" }));
    await user.click(within(card(container, "t2")).getByRole("button", { name: "写周报" }));
    expect(card(container, "t2").getAttribute("data-open")).toBe("true");
    expect(card(container, "t1").getAttribute("data-open")).toBe("false");
    expect(
      container.querySelector(".tdetail")?.textContent,
    ).toContain("写周报");
  });

  it("`Esc` 与关闭按钮都能收起（DESIGN.md §6.3 的 Esc 关闭链里有侧滑详情）", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    await user.click(within(card(container, "t1")).getByRole("button", { name: "交物业费" }));
    await user.keyboard("{Escape}");
    expect(container.querySelector(".tdetail")).toBeNull();

    await user.click(within(card(container, "t1")).getByRole("button", { name: "交物业费" }));
    await user.click(screen.getByRole("button", { name: "关闭详情" }));
    expect(container.querySelector(".tdetail")).toBeNull();
  });

  it("看板卡片的标题也能打开详情（两处入口同一套）", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    await user.click(screen.getByRole("button", { name: "看板" }));
    await user.click(within(card(container, "t2")).getByRole("button", { name: "写周报" }));

    expect(container.querySelector(".tdetail")).not.toBeNull();
    expect(card(container, "t2").getAttribute("data-open")).toBe("true");
  });

  it("正文没缓存到时说明为什么空（不写一句「暂无」了事）", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel({ bodies: {} });

    await user.click(within(card(container, "t1")).getByRole("button", { name: "交物业费" }));
    expect(container.querySelector(".tdetail")?.textContent).toContain("还没有正文");
  });
});

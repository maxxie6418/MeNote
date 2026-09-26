// @vitest-environment jsdom
/**
 * Memo 视图（M2-4 验收点）：
 * - 时间轴按天分组、显示渲染正文/标签/时间、清单 Memo 带小图标；
 * - 顶部标签筛选 + 日期范围筛选；
 * - 「添加」按钮把焦点送回录入框（M07-01 入口二）；
 * - **不提供收藏**（Q8）；
 * - 原位编辑（Q19）：`Ctrl+Enter` 保存、`Esc` 取消。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalItem } from "../src/data/db";
import { MemoPanel } from "../src/features/memos/ui/MemoPanel";

afterEach(cleanup);

/** 2026-09-26 14:05（北京时间） */
const NOW = Date.UTC(2026, 8, 26, 6, 5);
const DAY = 24 * 60 * 60 * 1000;

function memo(id: string, memoAt: number, extra: Partial<LocalItem> = {}): LocalItem {
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
    memo_at: memoAt,
    is_task: 0,
    task_status: null,
    task_due: null,
    task_priority: null,
    pinned: 0,
    starred: 0,
    rev: 1,
    meta_rev: 1,
    sealed_rev: null,
    sync_seq: 1,
    created_at: memoAt,
    updated_at: memoAt,
    last_edit_at: memoAt,
    last_device: null,
    deleted_at: null,
    deleted: false,
    pending: null,
    ...extra,
  };
}

const MEMOS = [
  memo("m1", NOW, { tags: ["工作"] }),
  memo("m2", NOW - DAY, { tags: ["生活"], is_task: 1 }),
];

function renderPanel(overrides: Partial<Parameters<typeof MemoPanel>[0]> = {}) {
  const onAdd = vi.fn();
  const onSave = vi.fn();
  const onTogglePinned = vi.fn();
  const { container } = render(
    <MemoPanel
      memos={MEMOS}
      contents={{ m1: "今天开会讨论 **方案**", m2: "- [ ] 买牛奶" }}
      onSave={onSave}
      onTogglePinned={onTogglePinned}
      onAdd={onAdd}
      now={NOW}
      {...overrides}
    />,
  );
  return { container, onAdd, onSave, onTogglePinned };
}

/** 按文本取标签胶囊（无障碍名里带 `#` 与空格，直接按文本更稳） */
function tagChip(container: HTMLElement, text: string): HTMLButtonElement {
  const chips = [...container.querySelectorAll<HTMLButtonElement>(".chip--tag")];
  const matched = chips.find((chip) => chip.textContent?.includes(text));
  if (!matched) throw new Error(`没找到标签胶囊：${text}`);
  return matched;
}

describe("Memo 时间轴", () => {
  it("按天分组、显示正文、时间与标签", async () => {
    const { container } = renderPanel();

    const days = [...container.querySelectorAll(".timeline__day")];
    expect(days).toHaveLength(2);
    expect(days[0]?.textContent).toContain("9月26日");
    expect(days[1]?.textContent).toContain("9月25日");

    // 两天的 14:05 各一条，所以用 getAllByText
    expect(screen.getAllByText("14:05").length).toBeGreaterThan(0);
    // 正文是渲染后的 Markdown（粗体标签），不是原始星号；MarkdownPreview 是懒加载组件，等它渲染完
    expect(await screen.findByText("方案")).toBeTruthy();
    expect(container.querySelector(".memo__body strong")?.textContent).toBe("方案");
    expect(tagChip(container, "工作")).toBeTruthy();
  });

  it("清单 Memo 带清单小图标", () => {
    const { container } = renderPanel();
    const flags = [...container.querySelectorAll(".memo__flag")].map((el) => el.textContent);
    expect(flags.some((text) => text?.includes("清单"))).toBe(true);
  });

  it("不提供收藏（Q8）", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /收藏/ })).toBeNull();
  });
});

describe("筛选", () => {
  it("标签筛选：点标签只看该标签，再点取消", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    await user.click(tagChip(container, "工作"));
    expect(container.querySelectorAll(".memo")).toHaveLength(1);

    await user.click(tagChip(container, "全部"));
    expect(container.querySelectorAll(".memo")).toHaveLength(2);
  });

  it("日期范围筛选：今天 / 近 7 天", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    await user.click(screen.getByRole("button", { name: "今天" }));
    expect(container.querySelectorAll(".memo")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "近 7 天" }));
    expect(container.querySelectorAll(".memo")).toHaveLength(2);
  });

  it("筛完没有结果时给出空状态（而不是一片空白）", async () => {
    const user = userEvent.setup();
    render(
      <MemoPanel
        memos={[memo("old", NOW - 40 * DAY)]}
        contents={{ old: "很久以前" }}
        onSave={vi.fn()}
        onTogglePinned={vi.fn()}
        onAdd={vi.fn()}
        now={NOW}
      />,
    );
    await user.click(screen.getByRole("button", { name: "今天" }));
    expect(screen.queryByText("很久以前")).toBeNull();
  });
});

describe("操作", () => {
  it("「添加」按钮交给调用方（把焦点送回录入框）", async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel();

    await user.click(screen.getByRole("button", { name: /添加/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("原位编辑：Ctrl+Enter 保存、Esc 取消（Q19）", async () => {
    const user = userEvent.setup();
    const { onSave } = renderPanel();

    const card = document.querySelector('[data-memo-id="m1"]') as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Memo 的更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "编辑" }));

    const input = screen.getByLabelText("编辑 Memo") as HTMLTextAreaElement;
    expect(input.value).toBe("今天开会讨论 **方案**");

    await user.clear(input);
    await user.type(input, "改成别的内容");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onSave).toHaveBeenCalledWith("m1", "改成别的内容");

    // Esc 取消：不保存
    await user.click(within(card).getByRole("button", { name: "Memo 的更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "编辑" }));
    const again = screen.getByLabelText("编辑 Memo");
    await user.type(again, "不要保存");
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("编辑 Memo")).toBeNull();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("置顶入口存在且走回调（Q9）", async () => {
    const user = userEvent.setup();
    const { onTogglePinned } = renderPanel();

    const card = document.querySelector('[data-memo-id="m1"]') as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Memo 的更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "置顶" }));
    expect(onTogglePinned).toHaveBeenCalledWith("m1");
  });
});

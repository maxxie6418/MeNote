// @vitest-environment jsdom
/**
 * 首页面板（M2-8 验收点）：
 * - 三块：概括预览（统计 / 今日待办 / 最近动态）→ 快捷方式 → 快速导航；
 * - 统计**始终计入加密条目**（不因锁定改变）；
 * - **来自 Memo 的部分在锁定时以"已锁定"占位**（Q7）——两条分支都有用例；
 * - 各卡片有空态；快捷方式与快速导航都走回调。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalItem } from "../src/data/db";
import { HomePanel } from "../src/features/home/ui/HomePanel";

afterEach(cleanup);

function item(id: string, extra: Partial<LocalItem> = {}): LocalItem {
  return {
    id,
    type: "note",
    folder_id: null,
    title: `标题 ${id}`,
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 10,
    content_hash: "h",
    tags: [],
    memo_at: null,
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
    created_at: 1,
    updated_at: 1,
    last_edit_at: null,
    last_device: null,
    deleted_at: null,
    deleted: false,
    pending: null,
    ...extra,
  };
}

const ITEMS = [
  item("n1", { title: "会议记录", updated_at: 9 }),
  item("n2", { title: "加密笔记", enc_self: 1, updated_at: 8 }),
  item("t1", { title: "读书清单", type: "table", updated_at: 7, tags: ["读书"] }),
];

const MEMOS = [
  item("m1", { type: "memo", title: null, memo_at: 5, is_task: 1, task_status: "todo", task_due: "2026-09-30" }),
];

function renderPanel(overrides: Partial<Parameters<typeof HomePanel>[0]> = {}) {
  const onNewNote = vi.fn();
  const onFocusComposer = vi.fn();
  const onFocusSearch = vi.fn();
  const onOpenItem = vi.fn();
  const onOpenView = vi.fn();
  const onOpenFolder = vi.fn();
  const onOpenTag = vi.fn();
  const { container } = render(
    <HomePanel
      items={ITEMS}
      memos={MEMOS}
      folders={[{ id: "f1", name: "学习" }]}
      titles={{ m1: "交物业费" }}
      onNewNote={onNewNote}
      onFocusComposer={onFocusComposer}
      onFocusSearch={onFocusSearch}
      onOpenItem={onOpenItem}
      onOpenView={onOpenView}
      onOpenFolder={onOpenFolder}
      onOpenTag={onOpenTag}
      {...overrides}
    />,
  );
  return {
    container,
    onNewNote,
    onFocusComposer,
    onFocusSearch,
    onOpenItem,
    onOpenView,
    onOpenFolder,
    onOpenTag,
  };
}

describe("概括预览", () => {
  it("统计按类型计数，且**计入加密条目**（含单篇加密）", () => {
    renderPanel();
    const stats = screen.getByText("条目统计").closest(".home-card") as HTMLElement;

    // 笔记 2（其中 1 条 enc_self=1）+ 表格 1 + Memo 1
    const numbers = [...stats.querySelectorAll(".home-stat__n")].map((el) => el.textContent);
    expect(numbers).toEqual(["2", "1", "1"]);
    expect(within(stats).getByText(/不区分锁定状态/)).toBeTruthy();
  });

  it("今日待办列出未完成清单项，点击打开该条目", async () => {
    const user = userEvent.setup();
    const { onOpenItem } = renderPanel();

    const card = screen.getByText("今日待办").closest(".home-card") as HTMLElement;
    expect(within(card).getByText("交物业费")).toBeTruthy();

    await user.click(within(card).getByText("交物业费"));
    expect(onOpenItem).toHaveBeenCalledWith("m1");
  });

  it("最近动态按最近更新列出，Memo 另行提示", () => {
    const { container } = renderPanel();
    const lines = [...container.querySelectorAll(".home-line__main")].map((el) => el.textContent);
    expect(lines).toContain("会议记录");
    expect(lines).toContain("加密笔记");
    expect(screen.getByText(/另有 1 条 Memo/)).toBeTruthy();
  });

  it("**门禁锁定时 Memo 部分以「已锁定」占位**，统计数字口径不变（Q7）", () => {
    const { container } = renderPanel({ memoLocked: true });

    // 统计照旧（含 Memo 数字）
    const numbers = [...container.querySelectorAll(".home-stat__n")].map((el) => el.textContent);
    expect(numbers).toEqual(["2", "1", "1"]);

    // Memo 内容换成占位
    expect(screen.getAllByText(/已锁定/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("交物业费")).toBeNull();
  });

  it("空库时各卡片都有空态", () => {
    renderPanel({ items: [], memos: [], folders: [], titles: {} });

    expect(screen.getByText("没有未完成的待办。")).toBeTruthy();
    expect(screen.getByText(/还没有笔记/)).toBeTruthy();
    const numbers = [...screen.getByText("条目统计").closest(".home-card")!.querySelectorAll(".home-stat__n")].map(
      (el) => el.textContent,
    );
    expect(numbers).toEqual(["0", "0", "0"]);
  });
});

describe("快捷方式", () => {
  it("新建笔记 / 记录 Memo / 新建待办 / 搜索都走回调；加密空间禁用并说明", async () => {
    const user = userEvent.setup();
    const { onNewNote, onFocusComposer, onFocusSearch } = renderPanel();

    await user.click(screen.getByRole("button", { name: /新建笔记/ }));
    expect(onNewNote).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /记录 Memo/ }));
    expect(onFocusComposer).toHaveBeenCalledWith("memo");

    await user.click(screen.getByRole("button", { name: /新建待办/ }));
    expect(onFocusComposer).toHaveBeenCalledWith("task");

    await user.click(screen.getByRole("button", { name: /搜索（Ctrl\+K）/ }));
    expect(onFocusSearch).toHaveBeenCalledTimes(1);

    const vault = screen.getByRole("button", { name: /打开加密空间/ }) as HTMLButtonElement;
    expect(vault.disabled).toBe(true);
    expect(vault.title).toContain("M3");
  });
});

describe("快速导航", () => {
  it("文件夹 / 标签 / 常用视图都能跳转", async () => {
    const user = userEvent.setup();
    const { onOpenFolder, onOpenTag, onOpenView } = renderPanel();

    await user.click(screen.getByRole("button", { name: "学习" }));
    expect(onOpenFolder).toHaveBeenCalledWith("f1");

    await user.click(screen.getByRole("button", { name: /# 读书/ }));
    expect(onOpenTag).toHaveBeenCalledWith("读书");

    await user.click(screen.getByRole("button", { name: "最近编辑" }));
    expect(onOpenView).toHaveBeenCalledWith("recent");

    await user.click(screen.getByRole("button", { name: "待办" }));
    expect(onOpenView).toHaveBeenCalledWith("task");

    // 加密空间在 M2 禁用（不可点的标记渲染为带 data-disabled 的胶囊）
    const vaultChip = screen.getByText("加密空间");
    expect(vaultChip.getAttribute("data-disabled")).toBe("true");
    expect(vaultChip.getAttribute("title")).toContain("M3");
  });

  it("没有文件夹与标签时不渲染那两组（不留空组）", () => {
    renderPanel({ folders: [], items: [item("x", { tags: [] })] });

    expect(screen.queryByText("文件夹")).toBeNull();
    expect(screen.queryByText("标签")).toBeNull();
    expect(screen.getByText("常用视图")).toBeTruthy();
  });
});

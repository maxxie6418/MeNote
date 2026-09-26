// @vitest-environment jsdom
/**
 * 搜索结果面板（M2-6 验收点）：
 * - 结果单栏占满，带**高亮片段**（`<mark>`，不生成 HTML 字符串）；
 * - 顶部显示命中数；「筛选」展开后可按类型/时间/位置/标签过滤；
 * - 索引未建完时的提示可见；
 * - 空结果给出口（换说法 / 用筛选 / 清空回到原视图）；
 * - 「关闭」清空查询（回到进入前的视图）。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalItem } from "../src/data/db";
import {
  EMPTY_SEARCH_STATE,
  SearchPanel,
  type SearchResult,
} from "../src/features/search/ui/SearchPanel";

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
    last_edit_at: 1,
    last_device: null,
    deleted_at: null,
    deleted: false,
    pending: null,
    ...extra,
  };
}

const RESULTS: SearchResult[] = [
  {
    item: item("a", { tags: ["工作"] }),
    snippet: { before: "今天讨论了", match: "发布方案", after: "的细节" },
    score: 9,
  },
  {
    item: item("b", { type: "memo", title: null }),
    snippet: { before: "记一下", match: "发布", after: "节奏" },
    score: 4,
  },
];

function renderPanel(overrides: Partial<Parameters<typeof SearchPanel>[0]> = {}) {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const onFiltersChange = vi.fn();
  const { container } = render(
    <SearchPanel
      query="发布"
      results={RESULTS}
      folderNames={{ f1: "学习" }}
      filters={EMPTY_SEARCH_STATE}
      onFiltersChange={onFiltersChange}
      tags={["工作", "生活"]}
      onOpen={onOpen}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { container, onOpen, onClose, onFiltersChange };
}

describe("搜索结果", () => {
  it("显示命中数与高亮片段（mark 元素，不是 HTML 字符串）", () => {
    const { container } = renderPanel();

    expect(screen.getByText(/「发布」命中 2 条/)).toBeTruthy();
    const marks = [...container.querySelectorAll("mark")].map((el) => el.textContent);
    expect(marks).toEqual(["发布方案", "发布"]);
    // 片段前后文与高亮拼在一起
    expect(container.querySelector(".searchrow__snippet")?.textContent).toContain(
      "今天讨论了发布方案的细节",
    );
  });

  it("结果行显示类型 / 位置 / 标签", () => {
    const { container } = renderPanel();
    const rows = [...container.querySelectorAll(".searchrow")];
    expect(rows[0]?.textContent).toContain("笔记");
    expect(rows[0]?.textContent).toContain("根目录");
    expect(rows[0]?.textContent).toContain("#工作");
    // Memo 没有标题，行标题退化为类型名
    expect(rows[1]?.textContent).toContain("Memo");
  });

  it("点结果行打开该条目；「关闭」清空查询", async () => {
    const user = userEvent.setup();
    const { onOpen, onClose } = renderPanel();

    await user.click(screen.getAllByRole("button", { name: /今天讨论了/ })[0] as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith("a");

    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("筛选", () => {
  it("默认收起；展开后可按类型与时间筛选", async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderPanel();

    expect(screen.queryByLabelText("按类型筛选")).toBeNull();

    const filtersButton = screen.getByRole("button", { name: "筛选" });
    await user.click(filtersButton);
    expect(screen.getByLabelText("按类型筛选")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Memo" }));
    expect(onFiltersChange).toHaveBeenCalledWith({ ...EMPTY_SEARCH_STATE, type: "memo" });

    await user.click(screen.getByRole("button", { name: "近 7 天" }));
    expect(onFiltersChange).toHaveBeenCalledWith({ ...EMPTY_SEARCH_STATE, range: "week" });
  });

  it("可按位置与标签筛选", async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderPanel();

    await user.click(screen.getByRole("button", { name: "筛选" }));
    await user.click(screen.getByRole("button", { name: "学习" }));
    expect(onFiltersChange).toHaveBeenCalledWith({ ...EMPTY_SEARCH_STATE, folderId: "f1" });

    await user.click(screen.getByRole("button", { name: /# 工作/ }));
    expect(onFiltersChange).toHaveBeenCalledWith({ ...EMPTY_SEARCH_STATE, tag: "工作" });
  });
});

describe("空结果与提示", () => {
  it("没有命中时给出口（换说法 / 筛选 / 清空回到原视图）", () => {
    renderPanel({ results: [] });
    expect(screen.getByText("没有找到匹配的内容")).toBeTruthy();
    expect(screen.getByText(/清空搜索框即可回到刚才的视图/)).toBeTruthy();
    expect(screen.getByText(/「发布」命中 0 条/)).toBeTruthy();
  });

  it("索引未建完时顶部有可见提示（DESIGN.md：破坏性/不完整必须可见）", () => {
    renderPanel({ staleNotice: "正在建立本地索引，当前结果可能不完整。" });
    const notice = screen.getByRole("status");
    expect(within(notice).getByText(/正在建立本地索引/)).toBeTruthy();
  });

  it("没有提示时不渲染提示条", () => {
    renderPanel();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

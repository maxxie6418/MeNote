// @vitest-environment jsdom
/**
 * 笔记列表行的结构（按用户原型 `deliverables/pages-redesign-2026-09-27/notes-tables.html` 的 `.docrow*`）。
 *
 * 原型要点：**横向一行**——26px 图标块 + 主块（标题 + 摘要两行）+ 右侧时间。
 * v0.4.49 从"竖向三行、无图标块"改成这个形态；这里把结构钉住（改回竖排就会红）。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteList } from "../src/features/notes/ui/NoteList";
import type { LocalItem } from "../src/data/db";

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
    created_at: Date.UTC(2026, 8, 27, 10, 0),
    updated_at: Date.UTC(2026, 8, 27, 10, 0),
    last_edit_at: null,
    last_device: null,
    deleted_at: null,
    deleted: false,
    pending: null,
    ...extra,
  };
}

function renderList(items: LocalItem[], summaries: Record<string, string> = {}): HTMLElement {
  const { container } = render(
    <NoteList
      items={items}
      title="全部笔记"
      selectedId={items[0]?.id ?? null}
      loading={false}
      summaries={summaries}
      onSelect={vi.fn()}
      onNewNote={vi.fn()}
    />,
  );
  return container;
}

describe("笔记列表行的结构（原型 `.docrow`）", () => {
  it("一行 = 图标块 + 主块（标题/摘要）+ 右侧时间", () => {
    const container = renderList([item("n1")], { n1: "第一行摘要" });
    const row = container.querySelector(".itemrow");
    expect(row).not.toBeNull();

    // 三块都在，且顺序是 图标 → 主块 → 时间
    const parts = [...(row?.children ?? [])].map((child) => child.className);
    expect(parts).toEqual(["itemrow__ico", "itemrow__main", "itemrow__meta"]);

    // 主块里是标题 + 摘要两行
    const main = container.querySelector(".itemrow__main");
    expect(main?.querySelector(".itemrow__title")?.textContent).toContain("标题 n1");
    expect(main?.querySelector(".itemrow__excerpt")?.textContent).toBe("第一行摘要");
  });

  it("图标按类型给：笔记 `note`、表格 `table`（图标是辅助，标题才是主要信息）", () => {
    const container = renderList([item("n1"), item("t1", { type: "table" })]);
    const icons = [...container.querySelectorAll(".itemrow__ico use")].map((use) =>
      use.getAttribute("href"),
    );
    expect(icons).toEqual(["#i-note", "#i-table"]);
  });

  it("选中行的标题走主色 + 600（原型 `.docrow[aria-current=true] .docrow__t`）", () => {
    const container = renderList([item("n1")]);
    // 选中态靠 `aria-current` 表达（样式挂在 CSS 上，这里只钉属性，避免样式与语义脱节）
    expect(container.querySelector(".itemrow")?.getAttribute("aria-current")).toBe("true");
  });

  it("摘要缺失时只显示标题一行（不占位、不留空行）", () => {
    const container = renderList([item("n1")]);
    expect(container.querySelector(".itemrow__excerpt")).toBeNull();
    // 标题照样在（回归：别把标题也一起藏了）
    expect(screen.getByText(/标题 n1/)).toBeTruthy();
  });
});

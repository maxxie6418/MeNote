// @vitest-environment jsdom
/**
 * 删除入口（M4-12；《M4 界面稿》§6.6）。
 *
 * 从 `ui.test.tsx` 分出来：那个文件又到了行数预算，而"删除入口"本来就是单独一摊
 * （后面还要加编辑器「更多」菜单、文件夹、Memo、表格四处）。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteList } from "../src/features/notes/ui/NoteList";
import type { LocalItem } from "../src/data/db";

afterEach(cleanup);

function note(overrides: Partial<LocalItem> = {}): LocalItem {
  return {
    id: "a",
    type: "note",
    folder_id: null,
    title: "标题",
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 1,
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
    ...overrides,
  };
}

function renderList(props: Partial<Parameters<typeof NoteList>[0]> = {}) {
  render(
    <NoteList
      items={[note()]}
      title="全部笔记"
      selectedId={null}
      loading={false}
      onSelect={vi.fn()}
      onNewNote={vi.fn()}
      {...props}
    />,
  );
}

describe("列表行的删除入口", () => {
  it("更多菜单里有「删除」，且是危险项（危险色 + 交给上层二次确认）", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderList({ onDelete });

    await user.click(screen.getByRole("button", { name: /的更多操作/ }));
    const item = screen.getByRole("menuitem", { name: "删除" });
    // 破坏性操作用危险样式（DESIGN.md §5.1）
    expect(item.className).toContain("menu__item--danger");

    await user.click(item);
    expect(onDelete).toHaveBeenCalledWith("a");
  });

  it("不给 onDelete 时菜单里不出现删除入口（未接线的视图不显示假按钮）", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole("button", { name: /的更多操作/ }));
    expect(screen.queryByRole("menuitem", { name: "删除" })).toBeNull();
  });
});

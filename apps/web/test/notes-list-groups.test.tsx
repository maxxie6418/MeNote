// @vitest-environment jsdom
/**
 * 列表列的**文件夹分组渲染**（B2 批；用户 2026-09-28 拍板"按方案 B 做"）。
 *
 * 纯函数的分组规则在 `notes-groups.test.ts` 里钉；这里钉**界面这一层**：
 * 组头与实时计数出现了、折叠只收自己那一组、选中笔记本时顶层组头不重复、
 * 不传 `groups` 的视图（最近编辑 / 收藏 / 标签 / 搜索）**一条组头都不该有**。
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LocalFolder, LocalItem } from "../src/data/db";
import { groupNotesByFolder } from "../src/features/notes/groups";
import { NoteList } from "../src/features/notes/ui/NoteList";

afterEach(cleanup);

const NOOP = (): void => undefined;

function item(id: string, title: string, folderId: string | null): LocalItem {
  return {
    id,
    type: "note",
    folder_id: folderId,
    title,
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
  };
}

function folder(id: string, name: string, parentId: string | null, depth: number): LocalFolder {
  return {
    id,
    parent_id: parentId,
    is_enc_space: 0,
    in_enc_space: 0,
    name,
    depth,
    position: 0,
    meta_rev: 1,
    sync_seq: 1,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    deleted: false,
    pending: null,
  };
}

const FOLDERS = [
  folder("f1", "工作", null, 1),
  folder("f1a", "本周", "f1", 2),
  folder("f2", "生活", null, 1),
];

const ITEMS = [
  item("n1", "会议纪要", null),
  item("n2", "周报", "f1"),
  item("n3", "本周待办", "f1a"),
  item("n4", "旅行清单", "f2"),
];

function renderList(overrides: Partial<Parameters<typeof NoteList>[0]> = {}) {
  const { container } = render(
    <NoteList
      items={ITEMS}
      title="全部笔记"
      selectedId={null}
      loading={false}
      onSelect={NOOP}
      onNewNote={NOOP}
      {...overrides}
    />,
  );
  return container;
}

describe("列表列的分组", () => {
  it("全部笔记：组头带名字与「N 条」，各组只装自己的条目", () => {
    const container = renderList({ groups: groupNotesByFolder(ITEMS, FOLDERS) });

    const heads = [...container.querySelectorAll(".notelist__head")].map((head) =>
      head.textContent?.replace(/\s+/g, ""),
    );
    expect(heads).toEqual(["未分类1条", "工作1条", "本周1条", "生活1条"]);

    const groups = [...container.querySelectorAll(".notelist__group")];
    const work = groups.find((group) => group.getAttribute("aria-label") === "工作");
    expect(work?.textContent).toContain("周报");
    expect(work?.textContent).not.toContain("旅行清单");
  });

  it("折叠只收自己那一组；`aria-expanded` 跟着变", () => {
    const container = renderList({ groups: groupNotesByFolder(ITEMS, FOLDERS) });

    const work = [...container.querySelectorAll(".notelist__group")].find(
      (group) => group.getAttribute("aria-label") === "工作",
    ) as HTMLElement;
    const toggle = within(work).getByRole("button", { name: "收起「工作」" });

    fireEvent.click(toggle);

    expect(within(work).queryByText("周报")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // 别的组不受影响
    expect(screen.getByText("旅行清单")).toBeTruthy();
  });

  it("选中笔记本：顶层组头不渲染（列表头已经写着名字），子夹组头仍在", () => {
    const container = renderList({
      title: "工作",
      path: ["工作"],
      groups: groupNotesByFolder(ITEMS, FOLDERS, { rootFolderId: "f1" }),
      hideGroupRootHeader: true,
    });

    const heads = [...container.querySelectorAll(".notelist__head")].map((head) =>
      head.textContent?.replace(/\s+/g, ""),
    );
    // 顶层「工作」的组头被藏掉，只剩子夹「本周」
    expect(heads).toEqual(["本周1条"]);
    expect(screen.getByText("周报")).toBeTruthy();
  });

  it("不传 groups 的视图（最近编辑 / 收藏 / 标签 / 搜索）：一条组头都没有", () => {
    const container = renderList({ items: [ITEMS[0] as LocalItem] });

    expect(container.querySelectorAll(".notelist__group")).toHaveLength(0);
    expect(container.querySelectorAll(".notelist__head")).toHaveLength(0);
  });
});

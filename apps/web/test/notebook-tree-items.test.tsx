// @vitest-environment jsdom
/**
 * 笔记本树：**空态与入口** + **树里列条目**（B2 批；用户 2026-09-28 拍板"默认不显示、做成设置项"）。
 *
 * 钉住四条：
 * 1. 没有文件夹时给出**可见的**空态与「新建文件夹」入口（此前那里是一片空白——用户报的
 *    "笔记本里没有文件夹"最直接的原因）；
 * 2. `showItems` 关着时**一条条目都不列**（默认贴原型）；
 * 3. 打开后每个文件夹最多列 50 条，超出给「还有 N 条…」，点它切到那个文件夹；
 * 4. 点条目直接打开（回调带上条目 id）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalFolder, LocalItem } from "../src/data/db";
import { FolderTree, TREE_ITEMS_LIMIT } from "../src/features/notes/ui/FolderTree";
import { NotebookPanel } from "../src/features/notes/ui/NotebookPanel";

afterEach(cleanup);

const NOOP = (): void => undefined;

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

function item(id: string, title: string, folderId: string, type: LocalItem["type"] = "note"): LocalItem {
  return {
    id,
    type,
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

const TREE = [folder("f1", "工作", null, 1), folder("f1a", "本周", "f1", 2)];

function renderTree(props: Partial<Parameters<typeof FolderTree>[0]> = {}) {
  const { container } = render(
    <FolderTree
      folders={TREE}
      selectedId={null}
      counts={{ f1: 2, f1a: 1 }}
      onSelect={NOOP}
      onRename={NOOP}
      onMove={NOOP}
      onCreateChild={NOOP}
      {...props}
    />,
  );
  return container;
}

describe("笔记本树里列条目", () => {
  it("默认（showItems 关）不列条目——贴原型形态", () => {
    const container = renderTree({
      itemsByFolder: { f1: [item("n1", "周报", "f1")] },
      onOpenItem: NOOP,
    });

    expect(container.querySelectorAll(".tree-item")).toHaveLength(0);
  });

  it("打开后列出每个文件夹的条目：图标 + 标题，点子项直接打开", () => {
    const onOpenItem = vi.fn();
    const container = renderTree({
      showItems: true,
      itemsByFolder: {
        f1: [item("n1", "周报", "f1")],
        f1a: [item("n2", "本周待办", "f1a", "table")],
      },
      onOpenItem,
    });

    const labels = [...container.querySelectorAll(".tree-item")].map((entry) =>
      entry.textContent?.trim(),
    );
    // 结构在前、内容在后：先出现子文件夹「本周」下的文档，再出现根文件夹「工作」下的文档
    expect(labels).toEqual(["本周待办", "周报"]);

    fireEvent.click(screen.getByRole("button", { name: "本周待办" }));
    expect(onOpenItem).toHaveBeenCalledWith("n2");
  });

  it("超过上限只列 50 条，并给「还有 N 条…」；点它切到那个文件夹", () => {
    const onSelect = vi.fn();
    const many = Array.from({ length: TREE_ITEMS_LIMIT + 3 }, (_, index) =>
      item(`n${index}`, `第 ${index} 条`, "f1"),
    );
    const container = renderTree({
      showItems: true,
      counts: { f1: many.length },
      itemsByFolder: { f1: many },
      onOpenItem: NOOP,
      onSelect,
    });

    const entries = [...container.querySelectorAll(".tree-item")];
    // 50 条 + 1 行「还有 N 条…」
    expect(entries).toHaveLength(TREE_ITEMS_LIMIT + 1);
    expect(entries.at(-1)?.textContent).toContain("还有 3 条");

    fireEvent.click(entries.at(-1) as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith("f1");
  });

  it("当前打开的文档行带选中反馈，收起文件夹时文档一起隐藏", () => {
    const container = renderTree({
      showItems: true,
      selectedItemId: "n1",
      itemsByFolder: { f1: [item("n1", "周报", "f1")] },
      onOpenItem: NOOP,
    });

    const row = container.querySelector<HTMLButtonElement>('.tree-item[aria-current="true"]');
    expect(row?.textContent).toContain("周报");

    fireEvent.click(screen.getByRole("button", { name: "收起「工作」里的内容" }));
    expect(container.querySelectorAll(".tree-item")).toHaveLength(0);
  });

  it("没给 onOpenItem 时不列条目（加密空间那棵树就是不给——列标题等于泄露内容）", () => {
    const container = renderTree({ showItems: true, itemsByFolder: { f1: [item("n1", "私事", "f1")] } });

    expect(container.querySelectorAll(".tree-item")).toHaveLength(0);
  });
});

describe("笔记本树的空态与入口", () => {
  it("没有文件夹时给说明与可见的「新建文件夹」入口，点了出现内联命名框", () => {
    render(
      <NotebookPanel
        view={{ kind: "notebook", folderId: null }}
        onViewChange={NOOP}
        folders={[]}
        counts={{}}
        onCreateFolder={vi.fn(async () => undefined)}
        onRenameFolder={async () => undefined}
        onMoveFolder={async () => undefined}
      />,
    );

    expect(screen.getByText("还没有文件夹")).toBeTruthy();
    // 用**精确**名字：`+` 菜单那颗按钮的无障碍名是「新建文件夹 / 表格」，模糊匹配会同时命中两颗
    fireEvent.click(screen.getByRole("button", { name: "新建文件夹" }));
    expect(screen.getByLabelText("新文件夹名称")).toBeTruthy();
  });

  it("有文件夹时不出现空态", () => {
    render(
      <NotebookPanel
        view={{ kind: "notebook", folderId: null }}
        onViewChange={NOOP}
        folders={TREE}
        counts={{}}
        onCreateFolder={async () => undefined}
        onRenameFolder={async () => undefined}
        onMoveFolder={async () => undefined}
      />,
    );

    expect(screen.queryByText("还没有文件夹")).toBeNull();
  });
});

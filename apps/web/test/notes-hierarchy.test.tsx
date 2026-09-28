// @vitest-environment jsdom
/**
 * 层级可见（2026-09-28 用户反馈的问题 1 后半句："界面上要能看出层级结构"）。
 *
 * 改动前层级只有 16px 缩进：父项与子项长得一样，收不起来；列表头也不说"现在在哪一层"。
 * 这一轮按用户选定的「A 轻量」形态补两处（都不动列表行结构）：
 * 1. 笔记本树：有子夹的父项加**折叠三角**（默认展开），子层加**引导线**；
 * 2. 列表头：子夹显示父级面包屑（`工作 › 本周`）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalFolder } from "../src/data/db";
import { FolderTree } from "../src/features/notes/ui/FolderTree";
import { ItemListHead } from "../src/app/workarea/ItemListHead";

afterEach(cleanup);

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

const TREE = [
  folder("f1", "工作", null, 1),
  folder("f2", "本周", "f1", 2),
  folder("f3", "生活", null, 1),
];

const NOOP = (): void => undefined;

function renderTree(): HTMLElement {
  const { container } = render(
    <FolderTree
      folders={TREE}
      selectedId={null}
      counts={{ f1: 2, f2: 1, f3: 0 }}
      onSelect={NOOP}
      onRename={NOOP}
      onMove={NOOP}
      onCreateChild={NOOP}
    />,
  );
  return container;
}

function childBlock(container: HTMLElement): Element | null {
  return container.querySelector(".tree__children");
}

describe("笔记本树的折叠与引导线", () => {
  it("默认展开：子层的容器在（引导线画在它上面）", () => {
    const container = renderTree();
    expect(childBlock(container)).not.toBeNull();
    expect(screen.getByText("本周")).toBeTruthy();
  });

  it("有子夹的父项给折叠按钮，没有子夹的不给（不给点了没反应的入口）", () => {
    renderTree();
    expect(screen.getByRole("button", { name: "收起「工作」里的子文件夹" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /「生活」里的子文件夹/ })).toBeNull();
  });

  it("点折叠按钮：子层收起、`aria-expanded` 变 false，父项本身还在（不影响选中）", () => {
    const container = renderTree();
    const toggle = screen.getByRole("button", { name: "收起「工作」里的子文件夹" });

    fireEvent.click(toggle);

    expect(childBlock(container)).toBeNull();
    expect(screen.queryByText("本周")).toBeNull();
    expect(screen.getByText("工作")).toBeTruthy();
    const collapsed = screen.getByRole("button", { name: "展开「工作」里的子文件夹" });
    expect(collapsed.getAttribute("aria-expanded")).toBe("false");
  });

  it("再点一次展开回来（同一个入口双向）", () => {
    const container = renderTree();
    fireEvent.click(screen.getByRole("button", { name: "收起「工作」里的子文件夹" }));
    fireEvent.click(screen.getByRole("button", { name: "展开「工作」里的子文件夹" }));

    expect(childBlock(container)).not.toBeNull();
    expect(screen.getByText("本周")).toBeTruthy();
  });

  it("点树行仍然是选中该文件夹（折叠按钮是行按钮的兄弟，不抢选中）", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <FolderTree
        folders={TREE}
        selectedId={null}
        counts={{}}
        onSelect={onSelect}
        onRename={NOOP}
        onMove={NOOP}
        onCreateChild={NOOP}
      />,
    );
    const rows = [...container.querySelectorAll<HTMLButtonElement>(".tree-row")];
    fireEvent.click(rows.find((row) => row.textContent?.includes("工作")) as HTMLButtonElement);
    expect(onSelect).toHaveBeenCalledWith("f1");
  });
});

describe("列表头的层级路径", () => {
  it("子夹：父级面包屑 + 子夹名 + 计数", () => {
    const { container } = render(<ItemListHead title="本周" count={3} path={["工作", "本周"]} />);
    expect(container.querySelector(".listpane__title")?.textContent).toBe("工作 › 本周");
    expect(container.querySelector(".listpane__count")?.textContent).toBe("3 条");
  });

  it("第 1 层笔记本：不重复显示面包屑（标题本身就是名字）", () => {
    const { container } = render(<ItemListHead title="工作" count={2} path={["工作"]} />);
    expect(container.querySelector(".listpane__title")?.textContent).toBe("工作");
  });

  it("根视图（没有路径）：只有标题", () => {
    const { container } = render(<ItemListHead title="全部笔记" count={9} />);
    expect(container.querySelector(".listpane__title")?.textContent).toBe("全部笔记");
    expect(container.querySelector(".listpane__path")).toBeNull();
  });
});

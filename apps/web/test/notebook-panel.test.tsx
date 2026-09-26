// @vitest-environment jsdom
/**
 * 笔记本面板（M2-3 验收点）：
 * - **两层限制**：第 2 层不出现"新建子文件夹"入口；在选中第 2 层时点 `+`，新文件夹建在它的父层；
 * - `+` 菜单：新建文件夹可用、新建表格**禁用并说明原因**（M5）；
 * - 内联命名：Enter 确认、Esc 取消、空名字不创建；
 * - 树：两层渲染 + 节点计数 + `待上传` 标记。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalFolder } from "../src/data/db";
import { NotebookPanel } from "../src/features/notes/ui/NotebookPanel";

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

const TREE = [folder("f1", "学习", null, 1), folder("f2", "英语", "f1", 2)];

function renderPanel(overrides: Partial<Parameters<typeof NotebookPanel>[0]> = {}) {
  const onCreateFolder = vi.fn(async () => undefined);
  const onViewChange = vi.fn();
  render(
    <NotebookPanel
      view={{ kind: "notebook", folderId: null }}
      onViewChange={onViewChange}
      folders={TREE}
      counts={{ f1: 2, f2: 1 }}
      onCreateFolder={onCreateFolder}
      {...overrides}
    />,
  );
  return { onCreateFolder, onViewChange };
}

describe("笔记本面板", () => {
  it("树渲染两层，节点带计数", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /学习/ }).textContent).toContain("2");
    expect(screen.getByRole("button", { name: /英语/ }).textContent).toContain("1");
  });

  it("点文件夹切换视图（笔记本视图 + 该文件夹）", async () => {
    const user = userEvent.setup();
    const { onViewChange } = renderPanel();

    await user.click(screen.getByRole("button", { name: /学习/ }));
    expect(onViewChange).toHaveBeenCalledWith({ kind: "notebook", folderId: "f1" });
  });

  it("`+` 菜单：新建文件夹可用，新建表格禁用并说明是 M5 提供", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "新建文件夹 / 表格" }));
    const menu = screen.getByRole("menu", { name: "新建文件夹 / 表格" });

    const folderItem = within(menu).getByRole("menuitem", { name: "新建文件夹" });
    expect((folderItem as HTMLButtonElement).disabled).toBe(false);

    const tableItem = within(menu).getByRole("menuitem", { name: "新建表格" }) as HTMLButtonElement;
    expect(tableItem.disabled).toBe(true);
    expect(tableItem.title).toContain("M5");
  });

  it("内联命名：Enter 用输入的名字创建；Esc 取消（不创建）", async () => {
    const user = userEvent.setup();

    // Enter 确认
    const first = renderPanel();
    await user.click(screen.getByRole("button", { name: "新建文件夹 / 表格" }));
    await user.click(screen.getByRole("menuitem", { name: "新建文件夹" }));
    await user.type(screen.getByLabelText("新文件夹名称"), "项目{Enter}");
    expect(first.onCreateFolder).toHaveBeenCalledWith("项目", null);

    cleanup();

    // Esc 取消
    const second = renderPanel();
    await user.click(screen.getByRole("button", { name: "新建文件夹 / 表格" }));
    await user.click(screen.getByRole("menuitem", { name: "新建文件夹" }));
    await user.type(screen.getByLabelText("新文件夹名称"), "不要了{Escape}");
    expect(second.onCreateFolder).not.toHaveBeenCalled();
  });

  it("空名字不创建（不做先建后改名的空文件夹）", async () => {
    const user = userEvent.setup();
    const { onCreateFolder } = renderPanel();

    await user.click(screen.getByRole("button", { name: "新建文件夹 / 表格" }));
    await user.click(screen.getByRole("menuitem", { name: "新建文件夹" }));
    await user.type(screen.getByLabelText("新文件夹名称"), "   {Enter}");

    expect(onCreateFolder).not.toHaveBeenCalled();
  });

  it("选中第 2 层时点 `+`：新文件夹建在它的父层（不会产生第 3 层）", async () => {
    const user = userEvent.setup();
    const { onCreateFolder } = renderPanel({
      view: { kind: "notebook", folderId: "f2" },
    });

    await user.click(screen.getByRole("button", { name: "新建文件夹 / 表格" }));
    await user.click(screen.getByRole("menuitem", { name: "新建文件夹" }));
    await user.type(screen.getByLabelText("新文件夹名称"), "同级新夹{Enter}");

    expect(onCreateFolder).toHaveBeenCalledWith("同级新夹", "f1");
  });

  it("节点显示待上传标记", () => {
    renderPanel({ folders: [{ ...folder("f9", "待传", null, 1), pending: "create_folder" }] });
    expect(screen.getByRole("button", { name: /待传/ }).textContent).toContain("待上传");
  });
});

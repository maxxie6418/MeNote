// @vitest-environment jsdom
/**
 * 正文「产品模式清单」的守卫（编辑拓展阶段 A，2026-09-29）。
 *
 * 阶段 A 把生产收敛成 **仅编辑 / 仅预览**：双栏从产品里移除、即时渲染暂时退出（实现保留，
 * 阶段 C 验完再回到产品清单）。这条边界有三处容易漏，所以单独一个文件钉住：
 *
 * 1. **老设置**（存储里仍是四档 `editor_modes`）进来，切换条也只能出现产品档——
 *    过滤在渲染前完成，不是"渲染了再拿 CSS 藏掉"；
 * 2. **老的本机记忆**（`split` / `live`）不能让正文卡住，也不能把已退出的档显示出来；
 * 3. **坏表格的「查看原文」**要照旧落到「仅编辑」：它是救援入口，不能被收敛顺手删掉。
 *
 * 编辑器与预览都换成替身（jsdom 跑不了真 CodeMirror），只验模式与分支。
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/app/editor/Editor", () => ({
  Editor: (props: { initialValue: string; onChange: (value: string) => void; ariaLabel?: string }) => (
    <div data-testid="editor" data-initial={props.initialValue} data-label={props.ariaLabel}>
      <button type="button" onClick={() => props.onChange("改过的内容")}>
        模拟输入
      </button>
    </div>
  ),
}));

vi.mock("../src/app/editor/MarkdownPreview", () => ({
  MarkdownPreview: (props: { source: string }) => (
    <div data-testid="preview" data-source={props.source} />
  ),
}));

import { NoteWorkspace } from "../src/features/notes/ui/NoteWorkspace";
import type { LocalItem } from "../src/data/db";

const noop = (): void => undefined;

afterEach(cleanup);

beforeEach(() => {
  // "上次用的那一档"记在本机：用例之间必须隔离，否则互相串档
  window.localStorage.clear();
});

function item(id: string, type: LocalItem["type"] = "note"): LocalItem {
  return {
    id,
    type,
    folder_id: null,
    title: "笔记",
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 0,
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
  };
}

describe("正文产品模式：阶段 A 只有「仅编辑 / 仅预览」", () => {
  it("默认（不传 availableModes）只有两档，且不出现「分屏」「即时渲染」", () => {
    render(
      <NoteWorkspace
        item={item("a")}
        initialBody="正文"
        snapshot={null}
        onInput={noop}
        onTitleChange={noop}
      />,
    );

    const group = screen.getByRole("group", { name: "编辑模式" });
    expect(within(group).getAllByRole("button")).toHaveLength(2);
    expect(within(group).getByRole("button", { name: "仅编辑" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "仅预览" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "分屏" })).toBeNull();
    expect(screen.queryByRole("button", { name: "即时渲染" })).toBeNull();
  });

  it("老设置（存着四档）进来也被收敛：切换条只列产品档", () => {
    render(
      <NoteWorkspace
        item={item("a")}
        initialBody="正文"
        snapshot={null}
        availableModes={["split", "edit", "preview", "live"]}
        onInput={noop}
        onTitleChange={noop}
      />,
    );

    const group = screen.getByRole("group", { name: "编辑模式" });
    expect(within(group).getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "分屏" })).toBeNull();
    expect(screen.queryByRole("button", { name: "即时渲染" })).toBeNull();
  });

  it("点「仅预览」后编辑器卸载、预览拿到最新内容；切回去编辑器重新挂载", async () => {
    render(
      <NoteWorkspace
        item={item("a")}
        initialBody="打开时的内容"
        snapshot={null}
        onInput={noop}
        onTitleChange={noop}
      />,
    );

    expect((await screen.findByTestId("editor")).getAttribute("data-initial")).toBe(
      "打开时的内容",
    );
    fireEvent.click(screen.getByRole("button", { name: "模拟输入" }));

    fireEvent.click(screen.getByRole("button", { name: "仅预览" }));
    expect(await screen.findByTestId("preview")).toBeTruthy();
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(screen.getByTestId("preview").getAttribute("data-source")).toBe("改过的内容");
    fireEvent.click(screen.getByRole("button", { name: "仅编辑" }));
    expect((await screen.findByTestId("editor")).getAttribute("data-initial")).toBe("改过的内容");
  });

  it("本机记着已退出的档（live / split）时，落到产品第一档而不是卡住或显示旧档", () => {
    for (const legacy of ["live", "split"] as const) {
      window.localStorage.setItem("menote:editor:last-mode", legacy);
      const view = render(
        <NoteWorkspace
          item={item("a")}
          initialBody="正文"
          snapshot={null}
          onInput={noop}
          onTitleChange={noop}
        />,
      );

      expect(screen.getByRole("button", { name: "仅编辑" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(screen.queryByRole("button", { name: "即时渲染" })).toBeNull();
      expect(screen.queryByRole("button", { name: "分屏" })).toBeNull();
      view.unmount();
    }
  });

  it("坏表格的「查看原文」仍落到「仅编辑」（救援入口不受产品收敛影响）", async () => {
    render(
      <NoteWorkspace
        item={item("t", "table")}
        initialBody={"```menote-table\nnot: [valid\n```\n"}
        snapshot={null}
        onInput={noop}
        onTitleChange={noop}
      />,
    );

    // 结构化失败 → 提示条 + 两条出路（表格不允许编辑时不留"点了没反应"的按钮）
    const notice = screen.getByRole("alert");
    fireEvent.click(within(notice).getByRole("button", { name: "查看原文" }));

    expect(await screen.findByTestId("editor")).toBeTruthy();
    expect(screen.queryByTestId("preview")).toBeNull();
  });
});

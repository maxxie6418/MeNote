// @vitest-environment jsdom
/**
 * 正文区三种模式切换 + 切换条目的内容保持（M1-11 QA 补测）。
 *
 * 为什么要单独测这条：编辑器在三档模式间切换时是**重新挂载**的（换布局必须重挂），
 * 挂载时用哪个文本决定用户看到什么。用 `initialBody`（打开条目那一刻的快照）会让
 * "切到仅预览再切回来"把中间敲的内容显示回旧版本，用户再敲一个字就把旧内容写进草稿 —— 丢数据。
 * 同理，切换条目时若沿用上一个条目的文本，会出现 A 的内容显示在 B 上。
 *
 * 这里把 CodeMirror 换成受控替身：能拿到 `initialValue` 并能主动触发 `onChange`，
 * 从而在 jsdom 里确定性地复现这两条路径（真实 CM6 依赖布局 API，不适合放进单测）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/app/editor/Editor", () => ({
  Editor: (props: {
    initialValue: string;
    onChange: (value: string) => void;
    ariaLabel?: string;
  }) => (
    <div data-testid="editor" data-initial={props.initialValue}>
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

afterEach(cleanup);

function item(id: string, title = "笔记"): LocalItem {
  return {
    id,
    type: "note",
    folder_id: null,
    title,
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

const noop = (): void => undefined;

describe("正文区模式切换", () => {
  it("切到仅预览再切回分屏，编辑器拿到的是最新内容而不是打开时的快照", async () => {
    render(
      <NoteWorkspace
        item={item("a")}
        initialBody="打开时的内容"
        snapshot={null}
        onInput={noop}
        onTitleChange={noop}
      />,
    );

    // 编辑器是 lazy 分包，首帧在 Suspense 里，等它出来
    expect((await screen.findByTestId("editor")).getAttribute("data-initial")).toBe(
      "打开时的内容",
    );

    // 用户在分屏里敲了字
    fireEvent.click(screen.getByRole("button", { name: "模拟输入" }));
    expect(screen.getByTestId("preview").getAttribute("data-source")).toBe("改过的内容");

    // 切到「仅预览」：编辑器卸载
    fireEvent.click(screen.getByRole("button", { name: "仅预览" }));
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(screen.getByTestId("preview").getAttribute("data-source")).toBe("改过的内容");

    // 切回「分屏」：编辑器重新挂载，必须是改过的内容
    fireEvent.click(screen.getByRole("button", { name: "分屏" }));
    expect((await screen.findByTestId("editor")).getAttribute("data-initial")).toBe(
      "改过的内容",
    );
  });

  it("切到仅编辑同样保持最新内容", async () => {
    render(
      <NoteWorkspace
        item={item("a")}
        initialBody="原始"
        snapshot={null}
        onInput={noop}
        onTitleChange={noop}
      />,
    );

    await screen.findByTestId("editor");
    fireEvent.click(screen.getByRole("button", { name: "模拟输入" }));
    fireEvent.click(screen.getByRole("button", { name: "仅预览" }));
    fireEvent.click(screen.getByRole("button", { name: "仅编辑" }));

    expect((await screen.findByTestId("editor")).getAttribute("data-initial")).toBe(
      "改过的内容",
    );
  });

  it("切换条目时重新挂载（用新条目的内容初始化，不显示上一篇的内容）", async () => {
    const { rerender } = render(
      <NoteWorkspace
        item={item("a")}
        initialBody="A 的内容"
        snapshot={null}
        onInput={noop}
        onTitleChange={noop}
      />,
    );
    await screen.findByTestId("editor");
    fireEvent.click(screen.getByRole("button", { name: "模拟输入" }));
    expect(screen.getByTestId("preview").getAttribute("data-source")).toBe("改过的内容");

    // 切到另一篇：App 用 key={item.id} 重挂 NoteWorkspace
    rerender(
      <NoteWorkspace
        key="b"
        item={item("b")}
        initialBody="B 的内容"
        snapshot={null}
        onInput={noop}
        onTitleChange={noop}
      />,
    );

    expect((await screen.findByTestId("editor")).getAttribute("data-initial")).toBe("B 的内容");
  });
});

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
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  // "上次用的那一档"记在本机：用例之间必须隔离，否则互相串档
  window.localStorage.clear();
});

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

describe("编辑模式：只列开着的档 + 记住上次用的那一档（2026-09-29）", () => {
  it("切换条只列设置里开着的档；只剩一档时它照常渲染（就一个按钮）", () => {
    render(
      <NoteWorkspace
        item={item("a")}
        initialBody="正文"
        snapshot={null}
        initialMode="preview"
        availableModes={["preview"]}
        onInput={noop}
        onTitleChange={noop}
      />,
    );

    const group = screen.getByRole("group", { name: "编辑模式" });
    expect(within(group).getAllByRole("button")).toHaveLength(1);
    expect(
      within(group).getByRole("button", { name: "仅预览" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("打开时用**本机记住的**那一档（上次离开时用的），而不是设置里的种子", () => {
    window.localStorage.setItem("menote:editor:last-mode", "preview");

    render(
      <NoteWorkspace
        item={item("a")}
        initialBody="正文"
        snapshot={null}
        initialMode="split"
        onInput={noop}
        onTitleChange={noop}
      />,
    );

    expect(screen.getByRole("button", { name: "仅预览" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("记住的那一档被关掉了 → 落到还开着的第一档（坏值不卡正文）", () => {
    window.localStorage.setItem("menote:editor:last-mode", "live");

    render(
      <NoteWorkspace
        item={item("a")}
        initialBody="正文"
        snapshot={null}
        availableModes={["edit", "preview"]}
        onInput={noop}
        onTitleChange={noop}
      />,
    );

    expect(screen.getByRole("button", { name: "仅编辑" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "即时渲染" })).toBeNull();
  });

  it("在切换条里点一档会记进本机：下次打开照它", () => {
    render(
      <NoteWorkspace
        item={item("a")}
        initialBody="正文"
        snapshot={null}
        onInput={noop}
        onTitleChange={noop}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "仅预览" }));
    expect(window.localStorage.getItem("menote:editor:last-mode")).toBe("preview");
  });
});

describe("跨标签页改动的事前提示（M2-9）", () => {
  it("提示条可见，并把「重新载入」接上回调", async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    const { rerender } = render(
      <NoteWorkspace
        item={item("a")}
        initialBody="正文"
        snapshot={null}
        remoteChanged={false}
        onReload={onReload}
        onInput={noop}
        onTitleChange={noop}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();

    rerender(
      <NoteWorkspace
        item={item("a")}
        initialBody="正文"
        snapshot={null}
        remoteChanged={true}
        onReload={onReload}
        onInput={noop}
        onTitleChange={noop}
      />,
    );

    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("另一个标签页被修改过");
    expect(banner.textContent).toContain("冲突副本");

    await user.click(within(banner).getByRole("button", { name: /重新载入/ }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe("附件入口（M4-10；界面稿 §7.1 / §7.5）", () => {
  it("正文头有「添加附件」，点它代点隐藏的文件输入（多选）", async () => {
    const user = userEvent.setup();
    const onFiles = vi.fn();
    render(
      <NoteWorkspace
        item={item("a")}
        initialBody="正文"
        snapshot={null}
        onInput={noop}
        onTitleChange={noop}
        onFiles={onFiles}
      />,
    );

    const input = screen.getByLabelText("选择附件") as HTMLInputElement;
    expect(input.multiple).toBe(true);

    // 点按钮应当点到那个 input（jsdom 里 click 不会真的开选择器，只能断言"被点了"）
    const clickSpy = vi.spyOn(input, "click");
    await user.click(screen.getByRole("button", { name: "添加附件" }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("选完文件后把文件交出去，并清空 input（同一个文件连选两次也要能触发）", async () => {
    const onFiles = vi.fn();
    render(
      <NoteWorkspace
        item={item("a")}
        initialBody="正文"
        snapshot={null}
        onInput={noop}
        onTitleChange={noop}
        onFiles={onFiles}
      />,
    );

    const input = screen.getByLabelText("选择附件") as HTMLInputElement;
    const file = new File(["x"], "图.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(input.value).toBe("");
  });

  it("没给 onFiles 时不渲染附件入口（组件不假设上传能力）", () => {
    render(
      <NoteWorkspace item={item("a")} initialBody="正文" snapshot={null} onInput={noop} onTitleChange={noop} />,
    );
    expect(screen.queryByRole("button", { name: "添加附件" })).toBeNull();
  });

  it("锁定态：正文区是占位，**不渲染预览**（附件自然也不会漏出来，界面稿 §7.5）", async () => {
    render(
      <NoteWorkspace
        item={item("a")}
        initialBody="![图](/api/attachments/h/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)"
        snapshot={null}
        encryption={{
          enabled: true,
          encrypted: true,
          unlocked: false,
          unlockedCount: 0,
          onUnlock: noop,
          onLock: noop,
          onToggle: noop,
          onLockAll: noop,
        }}
        onInput={noop}
        onTitleChange={noop}
        onFiles={vi.fn()}
      />,
    );

    // 预览（会渲染图片）整个不出现，附件入口也不可用
    expect(screen.queryByTestId("preview")).toBeNull();
    expect((screen.getByRole("button", { name: "添加附件" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
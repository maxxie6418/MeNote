// @vitest-environment jsdom
/**
 * 正文「产品模式清单」的守卫（编辑拓展阶段 A 立，阶段 C 扩档，2026-09-29）。
 *
 * 阶段 C 用户验收即时渲染后，生产是 **仅编辑 / 即时渲染 / 仅预览**：双栏仍留在产品外
 * （四档里只有它没回来）。这条边界有三处容易漏，所以单独一个文件钉住：
 *
 * 1. **老设置**（存储里仍是四档 `editor_modes`）进来，切换条也只能出现产品档——
 *    过滤在渲染前完成，不是"渲染了再拿 CSS 藏掉"；
 * 2. **老的本机记忆**（`split`）不能让正文卡住，也不能把已退出的档显示出来；
 *    而记忆里的 `live` 现在是合法偏好，要**照用**（阶段 C 之前它会被回落掉）；
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

describe("正文产品模式：阶段 C 起是「仅编辑 / 即时渲染 / 仅预览」", () => {
  it("默认（不传 availableModes）有三档，「分屏」不在其中", () => {
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
    expect(within(group).getAllByRole("button")).toHaveLength(3);
    expect(within(group).getByRole("button", { name: "仅编辑" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "仅预览" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "即时渲染" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "分屏" })).toBeNull();
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
    expect(within(group).getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "分屏" })).toBeNull();
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

  it("本机记忆：`live` 照用（已是产品档），`split` 回落到产品第一档", () => {
    // 阶段 C 起即时渲染是合法偏好：记住它就该打开它，不能像阶段 A 那样回落
    window.localStorage.setItem("menote:editor:last-mode", "live");
    const live = render(
      <NoteWorkspace
        item={item("a")}
        initialBody="正文"
        snapshot={null}
        onInput={noop}
        onTitleChange={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "即时渲染" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    live.unmount();

    // 双栏仍在产品外：老记忆不能让正文卡住，也不能把这一档显示出来
    window.localStorage.setItem("menote:editor:last-mode", "split");
    const split = render(
      <NoteWorkspace
        item={item("a")}
        initialBody="正文"
        snapshot={null}
        onInput={noop}
        onTitleChange={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "仅编辑" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "分屏" })).toBeNull();
    split.unmount();
  });

  it("首次打开（本机没有记忆）落「即时渲染」：2026-09-30 起这是设置的默认初始值", async () => {
    // `App.tsx` 把 `userSettings.settings.editor_mode` 传成 `initialMode`；没有本机记忆时它就是落档
    const { DEFAULT_USER_SETTINGS } = await import("@menote/shared");
    expect(DEFAULT_USER_SETTINGS.editor_mode).toBe("live");
    const first = render(
      <NoteWorkspace
        item={item("a")}
        initialBody="正文"
        snapshot={null}
        initialMode={DEFAULT_USER_SETTINGS.editor_mode}
        availableModes={[...DEFAULT_USER_SETTINGS.editor_modes]}
        onInput={noop}
        onTitleChange={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "即时渲染" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    first.unmount();
    // 记忆优先于初始值：用过一次「仅编辑」之后，下次打开不该被初始值拽回即时渲染
    window.localStorage.setItem("menote:editor:last-mode", "edit");
    render(
      <NoteWorkspace
        item={item("a")}
        initialBody="正文"
        snapshot={null}
        initialMode={DEFAULT_USER_SETTINGS.editor_mode}
        availableModes={[...DEFAULT_USER_SETTINGS.editor_modes]}
        onInput={noop}
        onTitleChange={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "仅编辑" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("即时渲染进入切换条并可作为当前档，Markdown 编辑始终仍可选", () => {
    render(
      <NoteWorkspace
        item={item("a")}
        initialBody="正文"
        snapshot={null}
        availableModes={["edit", "preview", "live"]}
        initialMode="live"
        onInput={noop}
        onTitleChange={noop}
      />,
    );

    expect(screen.getByRole("button", { name: "即时渲染" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "仅编辑" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "仅预览" })).toBeTruthy();
    // 双栏不回产品：即使调用方硬塞四档进来，切换条里也不许出现它
    expect(screen.queryByRole("button", { name: "分屏" })).toBeNull();
  });

  it("从「即时渲染」切回「仅编辑」后，编辑器重新挂载且不丢内容", async () => {
    render(
      <NoteWorkspace
        item={item("a")}
        initialBody="打开时的内容"
        snapshot={null}
        availableModes={["edit", "preview", "live"]}
        initialMode="live"
        onInput={noop}
        onTitleChange={noop}
      />,
    );

    expect((await screen.findByTestId("editor")).getAttribute("data-initial")).toBe(
      "打开时的内容",
    );
    fireEvent.click(screen.getByRole("button", { name: "模拟输入" }));
    fireEvent.click(screen.getByRole("button", { name: "仅编辑" }));

    // 换档重挂载时用实时正文初始化，不能退回打开时的快照（否则再敲一个字就把旧内容写回草稿）
    expect((await screen.findByTestId("editor")).getAttribute("data-initial")).toBe("改过的内容");
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

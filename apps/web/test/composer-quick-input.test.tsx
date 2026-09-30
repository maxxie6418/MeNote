// @vitest-environment jsdom
/**
 * 两个录入面接入轻量即时渲染宿主（编辑拓展阶段 B / Task B6）。
 *
 * 这一层验的是**接线**，不是命令语义（后者在 `format-commands.test.ts`）：
 * 功能栏录入框与添加内容窗口都换成 `QuickComposer`，`/` 用共享命令表，`@` 只把焦点送到
 * 既有受控字段（**不进正文**），两处用同一套字段选择器；发布仍走各自原有的回调。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/app/editor/MarkdownPreview", () => ({
  MarkdownPreview: (props: { source: string }) => (
    <div className="markdown-body" data-testid="preview" data-source={props.source} />
  ),
}));

import { AddEntryDialog } from "../src/app/fnbar/AddEntryDialog";
import { Composer } from "../src/app/fnbar/Composer";

afterEach(cleanup);

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("功能栏录入框", () => {
  it("`/加粗` 走共享命令：文本进正文、发布回调拿到同一份内容", async () => {
    const user = userEvent.setup();
    const onPublishMemo = vi.fn();
    render(<Composer onPublishMemo={onPublishMemo} />);

    const input = screen.getByRole("textbox", { name: "快速录入" }) as HTMLTextAreaElement;
    await user.type(input, "/加粗");
    expect(screen.getByRole("option", { name: "加粗" })).toBeTruthy();

    await user.keyboard("{Enter}");
    // 触发段 `/加粗` 被吃掉，只留下标记；光标停在标记中间，可以接着打字
    expect(input.value).toBe("****");
    expect(input.selectionStart).toBe(2);

    /*
      用 `keyboard` 而不是 `type`：`type()` 会先点一下输入框，而 jsdom 按不到坐标，
      点击会把光标放到文末（真实用户看得到 `****` 会点在中间）。这里要验的是**选区恢复**本身。
    */
    await user.keyboard("买牛奶");
    expect(input.value).toBe("**买牛奶**");

    const published = input.value;
    await user.click(screen.getByRole("button", { name: "发布" }));
    expect(onPublishMemo).toHaveBeenCalledWith(published, { asTask: false });
  });

  it("命令改的是同一个受控值：切到别的档、再点回来内容还在", async () => {
    const user = userEvent.setup();
    render(<Composer />);

    const input = screen.getByRole("textbox", { name: "快速录入" }) as HTMLTextAreaElement;
    await user.type(input, "开会");
    // 切档是"离开输入区"：内容按 Markdown 呈现（设计 v3 §51 的模型）
    await user.click(screen.getByRole("button", { name: "待办" }));

    const preview = await screen.findByTestId("preview");
    expect(preview.getAttribute("data-source")).toBe("开会");

    // 点呈现区回到编辑，内容没丢
    await user.click(screen.getByRole("button", { name: "快速录入（点击继续编辑）" }));
    expect((screen.getByRole("textbox", { name: "快速录入" }) as HTMLTextAreaElement).value).toBe("开会");
  });

  it("Memo 档没有可写属性：`@` 不出菜单", async () => {
    const user = userEvent.setup();
    render(<Composer />);

    await user.type(screen.getByRole("textbox", { name: "快速录入" }), "@");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("待办档 `@` → 截止日期：焦点落到既有的日期字段，`@` 不进正文", async () => {
    const user = userEvent.setup();
    const onPublishTask = vi.fn();
    render(<Composer onPublishTask={onPublishTask} />);

    await user.click(screen.getByRole("button", { name: "待办" }));
    const input = screen.getByRole("textbox", { name: "快速录入" }) as HTMLTextAreaElement;
    await user.type(input, "交周报 @");
    expect(within(screen.getByRole("listbox", { name: "属性" })).getByRole("option", { name: "截止日期" })).toBeTruthy();

    await user.keyboard("{Enter}");

    expect(document.activeElement?.getAttribute("aria-label")).toBe("截止日期");
    // 同一录入面内换焦点：输入态**不**塌成呈现，文本就地更新（`@` 已被吃掉）
    expect(input.value).toBe("交周报 ");
    expect(screen.queryByTestId("preview")).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();

    // 发布仍然只用受控字段的值（属性没有变成正文）
    onPublishTask.mockClear();
    await user.click(screen.getByRole("button", { name: "发布" }));
    expect(onPublishTask).toHaveBeenCalledWith("交周报 ", { due: null, priority: "medium" });
  });

  it("待办档 `@` → 优先级：聚焦当前生效的那一档", async () => {
    const user = userEvent.setup();
    render(<Composer />);

    await user.click(screen.getByRole("button", { name: "待办" }));
    const input = screen.getByRole("textbox", { name: "快速录入" });
    await user.type(input, "@");
    await user.keyboard("{ArrowDown}{Enter}");

    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute("aria-pressed")).toBe("true");
    expect(focused.closest('[aria-label="优先级"]')).toBeTruthy();
    expect((input as HTMLTextAreaElement).value).toBe("");
  });
});

describe("添加内容窗口", () => {
  it("kind=memo：沿用窗口自己的输入类名，`/` 命令同样可用", async () => {
    const user = userEvent.setup();
    const onPublishMemo = vi.fn();
    render(
      <AddEntryDialog
        open
        kind="memo"
        onClose={vi.fn()}
        onPublishMemo={onPublishMemo}
        onPublishTask={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox", { name: "添加 Memo的内容" }) as HTMLTextAreaElement;
    expect(input.className).toBe("addentry__input");

    await user.type(input, "/引用");
    await user.keyboard("{Enter}");
    expect(input.value).toBe("> ");
  });

  it("kind=task：`@` 与录入框落到同一个字段，`@` 不进正文", async () => {
    const user = userEvent.setup();
    render(
      <AddEntryDialog
        open
        kind="task"
        onClose={vi.fn()}
        onPublishMemo={vi.fn()}
        onPublishTask={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox", { name: "添加待办的内容" }) as HTMLTextAreaElement;
    await user.type(input, "@");
    await user.keyboard("{Enter}");

    expect(document.activeElement?.getAttribute("aria-label")).toBe("截止日期");
    expect(input.value).toBe("");
  });

  it("窗口里的 `Ctrl+Enter` 仍然发布，发布后关窗并清空", async () => {
    const user = userEvent.setup();
    const onPublishMemo = vi.fn();
    const onClose = vi.fn();
    render(
      <AddEntryDialog
        open
        kind="memo"
        onClose={onClose}
        onPublishMemo={onPublishMemo}
        onPublishTask={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "添加 Memo的内容" }), "记一笔");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onPublishMemo).toHaveBeenCalledWith("记一笔", { asTask: false });
    expect(onClose).toHaveBeenCalled();
  });
});

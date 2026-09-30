// @vitest-environment jsdom
/**
 * 快捷输入的轻量即时渲染宿主（编辑拓展阶段 B / Task B5）。
 *
 * 钉住的是**最小承诺**，不是富文本能力：聚焦时可靠 textarea、失焦后按 Markdown 呈现、
 * 点一下回到编辑；`/` 给快捷基础命令、`@` 只回调属性选择（绝不写进正文）；
 * 输入法组合期间不抢键；多个实例互不串值；`Ctrl/Cmd+Enter` 发布。
 *
 * 用例一律通过一个**受控外壳**（`Harness`）使用组件——真实宿主就是这么用的：
 * 它持有 `value`，组件只负责把新值交回去。直接传常量 value 会得到"受控组件被冻结"的假象。
 *
 * `MarkdownPreview` 换成替身：真实实现依赖 markdown-it + DOMPurify（在分包里），
 * 这里只需确认"呈现的是同一份文本、且是只读呈现"。
 */
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/app/editor/MarkdownPreview", () => ({
  MarkdownPreview: (props: { source: string }) => (
    <div className="markdown-body" data-testid="preview" data-source={props.source} />
  ),
}));

import { QuickComposer, triggerAt } from "../src/app/fnbar/QuickComposer";
import { attributeCommandsFor } from "../src/app/fnbar/quick-attributes";
import type { QuickAttributeCommand, QuickAttributeHost, QuickAttributeId } from "../src/app/fnbar/quick-attributes";

afterEach(cleanup);

beforeEach(() => {
  // jsdom 没有实现 scrollIntoView：命令菜单的高亮项"滚进可视区"要有替身
  Element.prototype.scrollIntoView = vi.fn();
});

const TASK_ATTRIBUTES = attributeCommandsFor("task");

interface HarnessProps {
  mode?: QuickAttributeHost;
  initial?: string;
  attributes?: readonly QuickAttributeCommand[];
  onChooseAttribute?: (id: QuickAttributeId) => void;
  onSubmitShortcut?: () => void;
  /** 记录每次交出去的值（真实宿主会同时更新自己的状态） */
  record?: (value: string) => void;
  ariaLabel?: string;
}

function Harness({
  mode = "memo",
  initial = "",
  attributes = [],
  onChooseAttribute,
  onSubmitShortcut,
  record,
  ariaLabel = "快速录入",
}: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <QuickComposer
      mode={mode}
      value={value}
      onChange={(next) => {
        setValue(next);
        record?.(next);
      }}
      attributes={attributes}
      onChooseAttribute={onChooseAttribute}
      onSubmitShortcut={onSubmitShortcut}
      ariaLabel={ariaLabel}
    />
  );
}

describe("即时渲染模型：聚焦 textarea、失焦呈现、点击回到编辑", () => {
  it("失焦后按 Markdown 呈现已完成的短内容，再次点击可继续编辑", async () => {
    const user = userEvent.setup();
    render(<Harness initial="- **买牛奶**" />);

    // 打开就是输入态（要能立刻打字）
    const input = screen.getByRole("textbox", { name: "快速录入" });
    await user.click(input);
    await user.tab();

    // 失焦 → 呈现态：同一份原文交给 MarkdownPreview（只读，不改写用户内容）
    expect(screen.queryByRole("textbox")).toBeNull();
    expect((await screen.findByTestId("preview")).getAttribute("data-source")).toBe("- **买牛奶**");

    // 点呈现区回到编辑（不用 hover，点击就是入口）
    await user.click(screen.getByRole("button", { name: "快速录入（点击继续编辑）" }));
    expect(screen.getByRole("textbox", { name: "快速录入" })).toBeTruthy();
  });

  it("内容为空时失焦仍留在输入态（空壳呈现没有意义）", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("textbox", { name: "快速录入" }));
    await user.tab();

    expect(screen.getByRole("textbox", { name: "快速录入" })).toBeTruthy();
    expect(screen.queryByTestId("preview")).toBeNull();
  });

  it("发布清空内容后自动回到输入态", async () => {
    const user = userEvent.setup();
    function ClearableHarness() {
      const [value, setValue] = useState("写完的");
      return (
        <>
          <button type="button" onClick={() => setValue("")}>
            清空
          </button>
          <QuickComposer
            mode="memo"
            value={value}
            onChange={setValue}
            attributes={[]}
            ariaLabel="快速录入"
          />
        </>
      );
    }
    render(<ClearableHarness />);

    fireEvent.blur(screen.getByRole("textbox", { name: "快速录入" }));
    expect(screen.getByTestId("preview")).toBeTruthy();

    // 宿主发布后把 value 清空（模拟 Composer 的乐观发布）
    await user.click(screen.getByRole("button", { name: "清空" }));
    expect(screen.getByRole("textbox", { name: "快速录入" })).toBeTruthy();
  });

  it("受控：输入只把新值交回宿主，组件自己不存副本", () => {
    const onChange = vi.fn();
    render(<QuickComposer mode="memo" value="" onChange={onChange} attributes={[]} ariaLabel="快速录入" />);
    const input = screen.getByRole("textbox", { name: "快速录入" }) as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "买牛奶" } });

    expect(onChange).toHaveBeenCalledWith("买牛奶");
    // 宿主没有把新值传回来 → 组件不自己留一份
    expect(input.value).toBe("");
  });
});

describe("/ 命令：只在行首或空白后触发，作用于当前实例", () => {
  it("行首输入 / 打开菜单、按已输入的内容过滤、选中后只改当前实例的文本", async () => {
    const user = userEvent.setup();
    const record = vi.fn();
    render(<Harness record={record} />);

    const input = screen.getByRole("textbox", { name: "快速录入" });
    await user.type(input, "/加");

    expect(screen.getByRole("listbox", { name: "命令" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "加粗" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "引用" })).toBeNull();

    await user.keyboard("{Enter}");

    // 触发段 `/加` 被吃掉（它不是用户要写的内容），命令在光标处执行
    expect(record).toHaveBeenLastCalledWith("****");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((screen.getByRole("textbox", { name: "快速录入" }) as HTMLTextAreaElement).value).toBe("****");
  });

  it("非空白前输入 / 不触发；触发词后跟空白也退出触发", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByRole("textbox", { name: "快速录入" });
    await user.type(input, "12/34");
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.clear(input);
    await user.type(input, "/加 粗");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((input as HTMLTextAreaElement).value).toBe("/加 粗");
  });

  it("代码围栏内不触发（那里的 / 是正文内容）", () => {
    expect(triggerAt("```\n/加", 6)).toBeNull();
    expect(triggerAt("```\n```\n\n/加", 11)).toEqual({ kind: "/", query: "加", start: 9, caret: 11 });
  });

  it("Esc 只关菜单，不动已输入的内容", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByRole("textbox", { name: "快速录入" });
    await user.type(input, "/加");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect((input as HTMLTextAreaElement).value).toBe("/加");
  });

  it("菜单开着时用方向键移动、选中的是当前高亮项", async () => {
    const user = userEvent.setup();
    const record = vi.fn();
    render(<Harness record={record} />);

    await user.type(screen.getByRole("textbox", { name: "快速录入" }), "/");
    await user.keyboard("{ArrowDown}{Enter}");

    // 清单第二项是「斜体」→ 空选区插一对 `*`（两个星号，光标在中间）
    expect(record).toHaveBeenLastCalledWith("**");
  });
});

describe("@ 属性：只回调宿主，不写进正文", () => {
  it("待办：输入 @ 打开属性菜单，选择后回调宿主，且触发段不进正文", async () => {
    const user = userEvent.setup();
    const record = vi.fn();
    const onChooseAttribute = vi.fn();
    render(
      <Harness mode="task" attributes={TASK_ATTRIBUTES} record={record} onChooseAttribute={onChooseAttribute} />,
    );

    await user.type(screen.getByRole("textbox", { name: "快速录入" }), "开会 @");
    const listbox = screen.getByRole("listbox", { name: "属性" });
    expect(within(listbox).getByRole("option", { name: "截止日期" })).toBeTruthy();
    expect(within(listbox).getByRole("option", { name: "优先级" })).toBeTruthy();

    await user.keyboard("{Enter}");

    expect(onChooseAttribute).toHaveBeenCalledWith("due");
    // 关键：`@` 不进正文——它被吃掉，剩下的只有用户真正写的内容
    expect(record).toHaveBeenLastCalledWith("开会 ");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("方向键可以在属性之间移动，Enter 选中当前项", async () => {
    const user = userEvent.setup();
    const onChooseAttribute = vi.fn();
    render(<Harness mode="task" attributes={TASK_ATTRIBUTES} onChooseAttribute={onChooseAttribute} />);

    await user.type(screen.getByRole("textbox", { name: "快速录入" }), "@");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChooseAttribute).toHaveBeenCalledWith("priority");
  });

  it("Memo / 笔记没有可写属性：@ 不进菜单（不留「按键没反应」的状态）", async () => {
    const user = userEvent.setup();
    render(<Harness mode="memo" attributes={attributeCommandsFor("memo")} />);

    await user.type(screen.getByRole("textbox", { name: "快速录入" }), "@");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("输入法、快捷键与多实例", () => {
  it("组合输入中不打开 / 或 @ 菜单", () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "快速录入" });

    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "/", isComposing: true });
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "@", isComposing: true });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("组合输入结束后才按内容重算触发", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "快速录入" }) as HTMLTextAreaElement;

    fireEvent.compositionStart(input);
    fireEvent.compositionEnd(input, { data: "/加" });
    // 组合结束把内容一次性写进来 → 触发点仍然认得出来
    fireEvent.change(input, { target: { value: "/加" } });
    expect(screen.getByRole("listbox", { name: "命令" })).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Ctrl/Cmd + Enter 调 onSubmitShortcut", async () => {
    const user = userEvent.setup();
    const onSubmitShortcut = vi.fn();
    render(<Harness initial="内容" onSubmitShortcut={onSubmitShortcut} />);

    await user.click(screen.getByRole("textbox", { name: "快速录入" }));
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onSubmitShortcut).toHaveBeenCalledTimes(1);
  });

  it("两个实例互不串值、各管各的菜单", async () => {
    const user = userEvent.setup();
    const recordA = vi.fn();
    const recordB = vi.fn();
    render(
      <>
        <Harness record={recordA} />
        <Harness mode="task" attributes={TASK_ATTRIBUTES} ariaLabel="待办录入" record={recordB} />
      </>,
    );

    const [inputA, inputB] = screen.getAllByRole("textbox");
    await user.type(inputA!, "/加");
    expect(screen.getByRole("listbox", { name: "命令" })).toBeTruthy();
    expect(recordA).toHaveBeenLastCalledWith("/加");
    expect(recordB).not.toHaveBeenCalled();

    // 切到第二个实例：第一个失焦即收起自己的菜单
    await user.type(inputB!, "@");
    expect(screen.queryByRole("listbox", { name: "命令" })).toBeNull();
    expect(screen.getByRole("listbox", { name: "属性" })).toBeTruthy();
    expect(recordB).toHaveBeenLastCalledWith("@");
  });
});

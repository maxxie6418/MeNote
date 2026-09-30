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

/*
  块级即时渲染（v0.6.3）：用户 2026-09-30 验收时反馈"切换行之后样式不及时显示，除非退出编辑"、
  "用 `/` 调用的样式不生效"。根因是当时只有**失焦整块呈现**这一种时机。这一组用例钉住新口径：
  **打字过程中，已完成的块就呈现**，`/` 命令的结果不必离开录入框就能看到效果。
*/
describe("快捷输入：块级即时渲染（当前块源码、其余块即时呈现）", () => {
  it("已完成的块在打字时就在呈现，不需要失焦", async () => {
    render(<Harness initial={"- 第一项\n- 第二项"} />);
    // 两块都是列表项 → 光标默认在最后一块（textarea），第一块当场呈现
    expect((await screen.findByTestId("preview")).getAttribute("data-source")).toBe("- 第一项");
    expect((screen.getByLabelText("快速录入") as HTMLTextAreaElement).value).toBe("- 第二项");
  });

  it("回车就呈现上一行：Enter 之后上一块变呈现块，textarea 只剩新块", async () => {
    const user = userEvent.setup();
    render(<Harness initial="- 第一项" />);
    const input = screen.getByLabelText("快速录入") as HTMLTextAreaElement;

    await user.type(input, "{Enter}");

    expect((await screen.findByTestId("preview")).getAttribute("data-source")).toBe("- 第一项");
    expect(input.value).toBe("");
  });

  it("段落里按回车也算提交；接着写第二行时会并回同一段（Markdown 的软换行语义）", async () => {
    const user = userEvent.setup();
    render(<Harness initial="第一行" />);
    const input = screen.getByLabelText("快速录入") as HTMLTextAreaElement;

    await user.type(input, "{Enter}");
    // 文末那个空行自成一块 → 上一行当场呈现，光标落到新块
    expect((await screen.findByTestId("preview")).getAttribute("data-source")).toBe("第一行");
    expect(input.value).toBe("");

    /*
      接着写第二行：无标记的连续两行在 Markdown 里**是同一段**，所以两块并回一块、
      呈现让位给源码（光标所在的那一段显示源码）。这是切块近似的已知表现，内容不受影响。
    */
    await user.type(input, "第二行");
    expect(screen.queryByTestId("preview")).toBeNull();
    expect(input.value).toBe("第一行\n第二行");
  });

  it("`/加粗` 的结果不必离开录入框就能看到效果", async () => {
    const user = userEvent.setup();
    const record = vi.fn();
    render(<Harness initial="" record={record} />);
    const input = screen.getByLabelText("快速录入") as HTMLTextAreaElement;

    /*
      真实路径是"打 `/加粗` → 菜单回车 → 光标落在 `****` 中间 → 接着打字"。
      **不能先选中文字再打命令**：打字会替换掉选区，那样只是在空选区上插了一对标记。
    */
    await user.type(input, "/加粗");
    await user.keyboard("{Enter}");
    expect(input.value).toBe("****");
    await user.keyboard("买牛奶");
    expect(input.value).toBe("**买牛奶**");

    // 回车提交这一块：不点别处、不失焦整个录入框，效果就在面前呈现
    await user.type(input, "{Enter}");
    expect((await screen.findByTestId("preview")).getAttribute("data-source")).toBe("**买牛奶**");
    expect(record).toHaveBeenLastCalledWith("**买牛奶**\n");
  });

  it("点已呈现的块回到编辑：那一块变回源码，全文逐字不变", async () => {
    const user = userEvent.setup();
    const record = vi.fn();
    render(<Harness initial={"- 一\n- 二"} record={record} />);
    const input = screen.getByLabelText("快速录入") as HTMLTextAreaElement;

    await user.click(screen.getByTestId("preview"));
    expect(input.value).toBe("- 一");
    // 换块不重建 textarea：焦点与输入法组合都靠这一个节点活着
    expect(document.activeElement).toBe(input);
    await user.type(input, "补");
    expect(record).toHaveBeenLastCalledWith("- 一补\n- 二");
  });

  it("换块时 textarea 是同一个 DOM 节点（不重建，焦点与原生撤销都不丢）", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness initial={"- 一\n- 二"} />);
    const before = container.querySelector("textarea");
    expect(before).not.toBeNull();

    await user.click(screen.getByTestId("preview"));

    expect(container.querySelector("textarea")).toBe(before);
  });

  it("失焦整块呈现仍是兜底：点回来继续编辑，内容一字不差", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Harness initial={"- 一\n- 二"} ariaLabel="快速录入" />
        <button type="button">别处</button>
      </>,
    );
    const input = screen.getByLabelText("快速录入") as HTMLTextAreaElement;

    // 先聚焦再点到别处，"失焦"才真的发生
    await user.click(input);
    await user.click(screen.getByRole("button", { name: "别处" }));

    // 整块呈现只留一个入口，且呈现的是**全文**（编辑态下 textarea 只持有当前块，这里已经不是它）
    const view = screen.getByRole("button", { name: "快速录入（点击继续编辑）" });
    expect(within(view).getByTestId("preview").getAttribute("data-source")).toBe("- 一\n- 二");
  });
});

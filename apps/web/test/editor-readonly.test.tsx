// @vitest-environment jsdom
/**
 * 正文编辑器在「即时渲染」档下的数据通路（编辑拓展阶段 C / Task C2）。
 *
 * 为什么这一份用**真的 `Editor`**：`live-preview.test.ts` 测的是装饰纯函数，`editor-lab-page.test.tsx`
 * 把编辑器换成了 textarea 替身——两条都答不了"视图真的建起来之后，变更还出不出得去 / 进不进得来"。
 * 本文件的断言只关于数据通路，不关于装饰长什么样。
 *
 * 代价是得给 jsdom 补一个布局 API 存根（见 `patchClientRects`）：CodeMirror 的测量帧会调
 * `Range.prototype.getClientRects`、`getBoundingClientRect`，jsdom 两个都没有，缺了它会在
 * `requestAnimationFrame` 里抛未捕获异常——用例可能仍然是绿的，但套件会带着 unhandled error 退出。
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor, type EditorHandle } from "../src/app/editor/Editor";

/** jsdom 没有的布局方法；只补这两个，返回零矩形即可（测量结果不参与本文件的断言）。 */
function patchClientRects(): void {
  const proto = Range.prototype as unknown as {
    getClientRects?: () => DOMRectList;
    getBoundingClientRect?: () => DOMRect;
  };
  proto.getClientRects = () => [] as unknown as DOMRectList;
  proto.getBoundingClientRect = () => zeroRect();
}

function zeroRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function unpatchClientRects(): void {
  const proto = Range.prototype as unknown as Record<string, unknown>;
  delete proto.getClientRects;
  delete proto.getBoundingClientRect;
}

/** 正文里那个可编辑区；真实 CM6 一定会有。传 `container` 以免捞到上一个用例残留的节点。 */
function contentNode(container: HTMLElement = document.body): HTMLElement {
  const node = container.querySelector(".cm-content");
  if (!(node instanceof HTMLElement)) throw new Error("没找到 .cm-content：编辑器没建起来");
  return node;
}

let handle: EditorHandle | null = null;

beforeEach(() => {
  patchClientRects();
  handle = null;
});

afterEach(() => {
  cleanup();
  unpatchClientRects();
});

describe("即时渲染档下的正文数据通路", () => {
  it("即时渲染打开时仍将正文变更交给 onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Editor initialValue="- **重点**" live onChange={onChange} ariaLabel="正文" />);

    const content = contentNode();
    await user.click(content);
    await user.keyboard("X");

    // 真视图里打字走的是 CM6 的事务，宿主只该从 onChange 拿到新正文
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0]?.[0]).toContain("重点");
  });

  it("即时渲染只读时不接受文本变更", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <Editor
        initialValue="正文"
        live
        readOnly
        onChange={onChange}
        onReady={(next) => {
          handle = next;
        }}
        ariaLabel="只读正文"
      />,
    );

    const content = contentNode(container);
    await user.click(content);
    await user.keyboard("X");
    /*
      等一拍再断言，且断言落在**文档本身**上：`readOnly` 挡的是用户事务，
      若它没挡住，`read()` 会多出那个字。
      不用 `waitFor(() => expect(onChange).not.toHaveBeenCalled())`——那个写法在第一次检查就通过，
      而漏出来的变更可能晚一拍才到，于是"套件闲时绿、并跑时红"（本用例真出现过一次这样的假红）。
      `contenteditable` 在只读下仍是 `true`（CM6 只加 `aria-readonly`），所以判定不能落在 DOM 属性上。
    */
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(handle?.read()).toBe("正文");
    expect(content.textContent).toBe("正文");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("只读时仍允许程序化替换（锁定挡的是用户输入，不是宿主）", () => {
    const onChange = vi.fn();
    render(
      <Editor
        initialValue="待替换"
        live
        readOnly
        onChange={onChange}
        onReady={(next) => {
          handle = next;
        }}
        ariaLabel="只读正文"
      />,
    );

    // `EditorState.readOnly` 挡的是**用户输入**（上面的键入用例），不是 `dispatch`：
    // 附件占位替换、外部指令这类宿主写入必须照旧生效，否则锁定会连自动流程一起冻住
    handle?.replace("待替换", "已替换");
    expect(handle?.read()).toBe("已替换");
    // 程序化变更照旧报给宿主：宿主可能就是靠这条回调把新正文写回存储的
    expect(onChange).toHaveBeenCalledWith("已替换");
  });

  it("切即时渲染 / 切只读只重配置：视图只建一次，正文节点不被换掉", () => {
    const events: string[] = [];
    const onLifecycle = (event: string): void => {
      events.push(event);
    };
    const props = {
      initialValue: "正文",
      onChange: () => undefined,
      onLifecycle,
      ariaLabel: "正文",
    };
    const { container, rerender } = render(<Editor {...props} />);
    const before = contentNode(container);
    expect(events.filter((event) => event === "created")).toHaveLength(1);

    rerender(<Editor {...props} live />);
    rerender(<Editor {...props} live readOnly />);

    /*
      重建视图会丢撤销历史与光标——试验页那两条读数（活动实例 / 监听）要证明的正是"没有重建"。
      这里用真编辑器把同一条边界钉死：`.cm-content` 是 React 管不到的视图内部节点，
      它没被换掉才说明走的是 `Compartment` 重配置。
    */
    expect(contentNode(container)).toBe(before);
    expect(events.filter((event) => event === "created")).toHaveLength(1);
    expect(events.filter((event) => event === "destroyed")).toHaveLength(0);
    expect(events.filter((event) => event === "modeReconfigured")).toHaveLength(2);
  });
});

// @vitest-environment jsdom
/**
 * `/` 命令菜单（编辑拓展阶段 B / Task B2）。
 *
 * 菜单本身**不持有文本、不认识宿主**：它拿 `commands` 显示、按 `query` 过滤、把选择交回 `onChoose`。
 * 所以这里只钉交互契约——默认高亮首项、方向键首尾循环、`Enter` 选中、`Esc` 只关闭、
 * 过滤无匹配时**菜单保持打开**且不乱触发、输入法组合期间不抢键。
 *
 * 焦点策略：菜单**不抢 DOM 焦点**（焦点留在宿主的 textarea，用户才能继续打字过滤），
 * 高亮用 `aria-selected` 表达；键盘监听只在打开期间挂在 `document` 上（与 `ui/Menu.tsx` 的
 * `DropdownMenu` 同一做法），且只消费方向键 / `Enter` / `Esc`。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandMenu } from "../src/app/editor/CommandMenu";

afterEach(cleanup);

beforeEach(() => {
  // jsdom 没有实现 scrollIntoView：高亮项"滚进可视区"这条要有替身才能断言
  Element.prototype.scrollIntoView = vi.fn();
});

function setup(overrides: Partial<Parameters<typeof CommandMenu>[0]> = {}) {
  const onChoose = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <CommandMenu
      open
      query=""
      commands={["bold", "bullet-list", "quote"]}
      onChoose={onChoose}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onChoose, onClose, view };
}

function selectedOption(): string | null {
  return screen.getByRole("option", { selected: true }).textContent;
}

describe("命令菜单：显示与过滤", () => {
  it("只显示传入的命令（中文名），不显示没传的", () => {
    setup();

    expect(screen.getByRole("option", { name: "加粗" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "无序列表" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "引用" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "标题" })).toBeNull();
    expect(screen.getByRole("listbox", { name: "命令" })).toBeTruthy();
  });

  it("按中文名或英文 id 过滤，忽略开头的 /", () => {
    const { view } = setup({ query: "/列" });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "无序列表" })).toBeTruthy();

    view.rerender(
      <CommandMenu
        open
        query="/quo"
        commands={["bold", "bullet-list", "quote"]}
        onChoose={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "引用" })).toBeTruthy();
  });

  it("过滤后无匹配：菜单保持打开、不渲染任何选项、显示一行说明", async () => {
    const user = userEvent.setup();
    const { onChoose, onClose } = setup({ query: "zzz" });

    expect(screen.getByRole("listbox", { name: "命令" })).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("没有匹配的命令")).toBeTruthy();

    // 这时按键不能静默触发选择（也**不能**静默关掉菜单——用户会以为按键丢了）
    await user.keyboard("{Enter}{ArrowDown}{ArrowUp}");
    expect(onChoose).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox", { name: "命令" })).toBeTruthy();
  });

  it("open=false 时什么都不渲染", () => {
    setup({ open: false });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("命令菜单：键盘", () => {
  it("打开时默认高亮首项，直接 Enter 选中的就是首项", async () => {
    const user = userEvent.setup();
    const { onChoose, onClose } = setup();

    expect(selectedOption()).toBe("加粗");
    await user.keyboard("{Enter}");

    expect(onChoose).toHaveBeenCalledWith("bold");
    // 关不关菜单由宿主决定，组件自己不关
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ArrowDown 移到第二项，ArrowUp 从首项回到末项（首尾循环）", async () => {
    const user = userEvent.setup();
    const { onChoose } = setup();

    await user.keyboard("{ArrowDown}");
    expect(selectedOption()).toBe("无序列表");
    await user.keyboard("{Enter}");
    expect(onChoose).toHaveBeenLastCalledWith("bullet-list");

    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(selectedOption()).toBe("引用");
    await user.keyboard("{Enter}");
    expect(onChoose).toHaveBeenLastCalledWith("quote");
  });

  it("移动高亮时把该项滚进可视区", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    setup();
    scrollIntoView.mockClear();

    await user.keyboard("{ArrowDown}");
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("Escape 只调 onClose，不选中任何命令", async () => {
    const user = userEvent.setup();
    const { onChoose, onClose } = setup();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("输入法组合期间不抢键（Enter / 方向键都不动）", () => {
    const { onChoose, onClose } = setup();

    fireEvent.keyDown(document, { key: "Enter", isComposing: true });
    fireEvent.keyDown(document, { key: "ArrowDown", isComposing: true });
    fireEvent.keyDown(document, { key: "Escape", isComposing: true });

    expect(onChoose).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(selectedOption()).toBe("加粗");
  });

  it("关闭后不再接管键盘（监听随 open 一起撤掉）", async () => {
    const user = userEvent.setup();
    const { onChoose, onClose, view } = setup();

    view.rerender(
      <CommandMenu
        open={false}
        query=""
        commands={["bold", "bullet-list", "quote"]}
        onChoose={onChoose}
        onClose={onClose}
      />,
    );
    await user.keyboard("{Enter}{Escape}");

    expect(onChoose).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("命令菜单：过滤后高亮回到有效项", () => {
  it("先移到第三项、再把过滤结果缩到一项：高亮落在那一项上，Enter 选中它", async () => {
    const user = userEvent.setup();
    const { onChoose, view } = setup();

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(selectedOption()).toBe("引用");

    view.rerender(
      <CommandMenu
        open
        query="/列"
        commands={["bold", "bullet-list", "quote"]}
        onChoose={onChoose}
        onClose={vi.fn()}
      />,
    );

    expect(selectedOption()).toBe("无序列表");
    await user.keyboard("{Enter}");
    expect(onChoose).toHaveBeenCalledWith("bullet-list");
  });

  it("鼠标移到某一项会改高亮（点与键不分家）", async () => {
    const user = userEvent.setup();
    const { onChoose } = setup();

    await user.hover(screen.getByRole("option", { name: "引用" }));
    expect(selectedOption()).toBe("引用");

    await user.click(screen.getByRole("option", { name: "引用" }));
    expect(onChoose).toHaveBeenCalledWith("quote");
  });
});

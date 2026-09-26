// @vitest-environment jsdom
/**
 * 功能栏结构不变量（DESIGN.md §2.5-2、M2 实施计划 M2-2 的验收点）。
 *
 * 这些是"看起来能用但实际破坏了约定"的高发区，所以用 DOM 结构钉死：
 * - 加密空间**贴底固定**：必须是滚动容器 `.fnbar__scroll` 的**兄弟**，不能在它里面；
 * - **功能栏内不出现账户区**（账户入口只在顶栏）；
 * - 两条导航造型必须**同时存在且可区分**：浏览三段是下划线页签、录入框模式是盒式分段控件；
 * - 三档附加项：memo 空容器占位、task 截止+优先级、note 首行作标题+根目录，且**无加密胶囊**。
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../src/app/fnbar/Composer";
import { FnBar } from "../src/app/fnbar/FnBar";

afterEach(cleanup);

function renderFnBar(overrides: Partial<Parameters<typeof FnBar>[0]> = {}) {
  return render(
    <FnBar
      onNewNote={vi.fn()}
      onPublishNote={vi.fn()}
      onPublishMemo={vi.fn()}
      onPublishTask={vi.fn()}
      view={{ kind: "notebook" }}
      onViewChange={vi.fn()}
      notebookPanel={<div data-testid="notebook-panel" />}
      tags={[
        { tag: "工作", count: 2 },
        { tag: "dev", count: 1 },
      ]}
      {...overrides}
    />,
  );
}

describe("功能栏结构", () => {
  it("加密空间贴底固定：是滚动容器的兄弟，不在滚动容器里", () => {
    const { container } = renderFnBar();
    const scroll = container.querySelector(".fnbar__scroll");
    const vault = container.querySelector(".fnbar__vault");

    expect(scroll).toBeTruthy();
    expect(vault).toBeTruthy();
    expect(scroll?.contains(vault as Node)).toBe(false);
    expect(vault?.parentElement?.className).toBe("fnbar");
  });

  it("功能栏内不出现账户区（账户入口只在顶栏）", () => {
    const { container } = renderFnBar();
    expect(within(container).queryByRole("button", { name: "账户与设置" })).toBeNull();
    expect(container.querySelector(".avatar")).toBeNull();
  });

  it("两条导航造型同时存在且可区分：下划线页签 vs 盒式分段控件", () => {
    const { container } = renderFnBar();

    // 浏览三段 = 下划线页签
    const navSeg = container.querySelector(".nav-seg");
    expect(navSeg).toBeTruthy();
    expect(navSeg?.querySelectorAll(".seg-item")).toHaveLength(3);
    // 页签是描边+底部下划线，不是灰实底
    expect(container.querySelectorAll(".segmented")).toHaveLength(1);

    // 盒式分段控件只出现在录入框模式行
    const segmented = container.querySelector(".segmented");
    expect(segmented?.classList.contains("segmented--compact")).toBe(true);
    expect(segmented?.querySelectorAll(".segmented__item")).toHaveLength(3);
  });

  it("浏览三段：Memo 与待办已可用，只剩首页禁用并说明原因", async () => {
    const user = userEvent.setup();
    const onBrowseChange = vi.fn();
    renderFnBar({ onBrowseChange });

    const home = screen.getByRole("tab", { name: /首页/ }) as HTMLButtonElement;
    expect(home.disabled).toBe(true);
    expect(home.title).toContain("M2-8");

    // Memo（M2-4）与待办（M2-5）都已可用
    const memo = screen.getByRole("tab", { name: /Memo/ }) as HTMLButtonElement;
    expect(memo.disabled).toBe(false);
    await user.click(memo);
    expect(onBrowseChange).toHaveBeenCalledWith("memo");

    const task = screen.getByRole("tab", { name: /待办/ }) as HTMLButtonElement;
    expect(task.disabled).toBe(false);
    await user.click(task);
    expect(onBrowseChange).toHaveBeenCalledWith("task");
  });

  it("导航与分组：最近编辑/收藏可切换、笔记本分组是插槽、标签云来自条目", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    renderFnBar({ onViewChange });

    expect(screen.getByRole("button", { name: /最近编辑/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /收藏/ })).toBeTruthy();
    // 笔记本分组由 App 插槽传入（功能栏不依赖 notes feature）
    expect(screen.getByTestId("notebook-panel")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /收藏/ }));
    expect(onViewChange).toHaveBeenCalledWith({ kind: "starred" });

    await user.click(screen.getByRole("button", { name: /# 工作/ }));
    expect(onViewChange).toHaveBeenCalledWith({ kind: "tag", tag: "工作" });
  });

  it("加密空间是禁用占位并说明原因（M2 只做外观）", () => {
    renderFnBar();
    const vault = screen.getByRole("button", { name: /加密空间/ }) as HTMLButtonElement;
    expect(vault.disabled).toBe(true);
    expect(vault.title).toContain("M3");
    expect(vault.dataset.locked).toBe("true");
  });
});

describe("录入框三档附加项", () => {
  it("memo 档空容器占位；task 档截止+优先级；note 档首行作标题+根目录且无加密胶囊", async () => {
    const user = userEvent.setup();
    render(<Composer onPublishNote={vi.fn()} />);

    const extras = screen.getByTestId("composer-extras");
    expect(extras.textContent).toBe(""); // memo：空容器，不塌陷（容器仍在）

    await user.click(screen.getByRole("button", { name: "待办" }));
    // task 档是真实控件（M2-5）：原生日期输入 + 优先级三段
    expect(screen.getByLabelText("截止日期")).toBeTruthy();
    expect(extras.textContent).toContain("截止");
    for (const label of ["高", "中", "低"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }

    await user.click(screen.getByRole("button", { name: "笔记" }));
    expect(extras.textContent).toContain("首行作标题");
    expect(extras.textContent).toContain("根目录");
    // 需求 §8.7：输入框没有加密开关
    expect(extras.textContent).not.toContain("加密");
  });

  it("笔记档 Ctrl+Enter 发布：首行作标题、其余为正文、发布后清空", async () => {
    const user = userEvent.setup();
    const onPublishNote = vi.fn();
    render(<Composer onPublishNote={onPublishNote} />);

    await user.click(screen.getByRole("button", { name: "笔记" }));
    const input = screen.getByLabelText("快速录入") as HTMLTextAreaElement;
    await user.click(input);
    await user.keyboard("# 买菜{Enter}{Enter}- 西红柿");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onPublishNote).toHaveBeenCalledWith("买菜", "- 西红柿");
    expect(input.value).toBe("");
  });

  it("未接入的档位按 Ctrl+Enter 不发布", async () => {
    const user = userEvent.setup();
    const onPublishNote = vi.fn();
    render(<Composer onPublishNote={onPublishNote} />);

    await user.click(screen.getByRole("button", { name: "待办" }));
    const input = screen.getByLabelText("快速录入");
    await user.click(input);
    await user.keyboard("随手一记");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onPublishNote).not.toHaveBeenCalled();
  });

  it("Memo 档 Ctrl+Enter 发布：清空输入框、带上 asTask", async () => {
    const user = userEvent.setup();
    const onPublishMemo = vi.fn();
    render(<Composer onPublishMemo={onPublishMemo} />);

    const input = screen.getByLabelText("快速录入") as HTMLTextAreaElement;
    await user.click(input);
    await user.keyboard("随手一记 #灵感");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onPublishMemo).toHaveBeenCalledWith("随手一记 #灵感", { asTask: false });
    expect(input.value).toBe("");
  });

  it("写了 - [ ] 才提示「设为清单？」：点了才带清单标记，删掉清单项则自动作废", async () => {
    const user = userEvent.setup();
    const onPublishMemo = vi.fn();
    render(<Composer onPublishMemo={onPublishMemo} />);

    const input = screen.getByLabelText("快速录入") as HTMLTextAreaElement;
    const extras = screen.getByTestId("composer-extras");

    // 普通 Memo：不出现提示（不自动改语义）
    await user.click(input);
    await user.type(input, "普通一条");
    expect(extras.textContent).not.toContain("设为清单");

    // 写了 - [ ] 才出现（user.type 会把 [ 当特殊键，所以直接赋值）
    fireEvent.change(input, { target: { value: "普通一条\n- [ ] 买牛奶" } });
    expect(extras.textContent).toContain("设为清单？");

    // 点一下才带上标记（点按钮会移走焦点，发布前先点回输入框）
    await user.click(screen.getByRole("button", { name: /设为清单/ }));
    expect(extras.textContent).toContain("已设为清单");

    await user.click(input);
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onPublishMemo).toHaveBeenCalledWith("普通一条\n- [ ] 买牛奶", { asTask: true });
  });
});

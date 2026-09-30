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
      vault={{
        enabled: false,
        locked: false,
        count: 0,
        onOpen: vi.fn(),
        onUnlock: vi.fn(),
        onEnable: vi.fn(),
      }}
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

  it("浏览三段全部可用；未选首页作为启动视图时不显示首页项", async () => {
    const user = userEvent.setup();
    const onBrowseChange = vi.fn();
    const { unmount } = renderFnBar({ onBrowseChange });

    // 首页（M2-8）已可用：不再是禁用占位
    const home = screen.getByRole("tab", { name: /首页/ }) as HTMLButtonElement;
    expect(home.disabled).toBe(false);
    await user.click(home);
    expect(onBrowseChange).toHaveBeenCalledWith("home");

    const memo = screen.getByRole("tab", { name: /Memo/ }) as HTMLButtonElement;
    expect(memo.disabled).toBe(false);
    await user.click(memo);
    expect(onBrowseChange).toHaveBeenCalledWith("memo");

    const task = screen.getByRole("tab", { name: /待办/ }) as HTMLButtonElement;
    expect(task.disabled).toBe(false);
    await user.click(task);
    expect(onBrowseChange).toHaveBeenCalledWith("task");

    unmount();

    // 未选首页作为启动视图：首页项不出现，只剩两项（由 flex:1 等分）
    renderFnBar({ showHome: false });
    expect(screen.queryByRole("tab", { name: /首页/ })).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
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

  it("标签区**贴底固定**：与滚动区并列（不被笔记本树推挤），位置在导航区之后、加密空间之前", () => {
    const { container } = renderFnBar();
    const scroll = container.querySelector(".fnbar__scroll");
    const tags = container.querySelector(".fnbar__tags");

    expect(scroll).toBeTruthy();
    expect(tags).toBeTruthy();
    // 关键：它不在滚动区里——树再长也推不动它
    expect(scroll?.contains(tags as Node)).toBe(false);
    expect(tags?.parentElement?.className).toBe("fnbar");
    expect([...(tags?.parentElement?.children ?? [])].map((node) => node.className)).toEqual([
      "fnbar__top",
      "fnbar__scroll",
      "fnbar__tags",
      "fnbar__vault",
    ]);
  });

  it("标签用**按钮铺开**（不是列）：每个标签是一个可点的 chip，仍能点进标签视图", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    const { container } = renderFnBar({ onViewChange });

    const tags = container.querySelector(".fnbar__tags");
    const buttons = [...(tags?.querySelectorAll("button.chip--tag") ?? [])];
    expect(buttons.map((node) => node.textContent?.trim())).toEqual(["# 工作", "# dev"]);
    // 铺开的容器是 `.tags`（flex-wrap）；"不排成列"由 layout-invariants 在 CSS 上守
    expect(tags?.querySelector(".tags")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /# 工作/ }));
    expect(onViewChange).toHaveBeenCalledWith({ kind: "tag", tag: "工作" });
  });

  it("未启用隐私锁时，节点说明去哪里启用且不带锁定标记（M3-10 起改为「引导启用」）", () => {
    renderFnBar();
    const vault = screen.getByRole("button", { name: /加密空间/ }) as HTMLButtonElement;
    expect(vault.title).toContain("设置 › 隐私锁");
    // 未启用不是"锁定态"：不带 data-locked（那是"已锁定"的标记）
    expect(vault.dataset.locked).toBeUndefined();
    expect(vault.textContent).toContain("未启用");
  });

  it("已锁定：可点且提示去解锁（不展开内容）", () => {
    const onUnlock = vi.fn();
    renderFnBar({
      vault: {
        enabled: true,
        locked: true,
        count: 3,
        onOpen: vi.fn(),
        onUnlock,
        onEnable: vi.fn(),
      },
    });

    const vault = screen.getByRole("button", { name: /加密空间/ }) as HTMLButtonElement;
    expect(vault.disabled).toBe(false);
    expect(vault.textContent).toContain("已锁定");
    fireEvent.click(vault);
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it("未启用：**可点并引导启用**（不是 disabled 占位，设计 §9.2-②）", () => {
    const onEnable = vi.fn();
    renderFnBar({
      vault: {
        enabled: false,
        locked: false,
        count: 0,
        onOpen: vi.fn(),
        onUnlock: vi.fn(),
        onEnable,
      },
    });

    const vault = screen.getByRole("button", { name: /加密空间/ }) as HTMLButtonElement;
    expect(vault.disabled).toBe(false);
    expect(vault.textContent).toContain("未启用");
    fireEvent.click(vault);
    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it("已锁定：**条目数照常显示**（计数属统计口径）", () => {
    renderFnBar({
      vault: {
        enabled: true,
        locked: true,
        count: 5,
        onOpen: vi.fn(),
        onUnlock: vi.fn(),
        onEnable: vi.fn(),
      },
    });

    const vault = screen.getByRole("button", { name: /加密空间/ }) as HTMLButtonElement;
    expect(vault.textContent).toContain("已锁定");
    expect(vault.textContent).toContain("5");
  });

  it("已解锁：显示空间内条目数，点击打开空间；**功能栏里不再有空间内文件夹树**（2026-09-29）", () => {
    const onOpen = vi.fn();
    const { container } = renderFnBar({
      vault: {
        enabled: true,
        locked: false,
        count: 7,
        onOpen,
        onUnlock: vi.fn(),
        onEnable: vi.fn(),
      },
    });

    const vault = screen.getByRole("button", { name: /加密空间/ }) as HTMLButtonElement;
    expect(vault.textContent).toContain("7");
    fireEvent.click(vault);
    expect(onOpen).toHaveBeenCalledTimes(1);

    // 树搬去了加密空间视图（`NotesPane` 的列表列）；功能栏这条贴底节点只作入口
    expect(container.querySelector(".vaulttree")).toBeNull();
    expect(screen.queryByText("新建空间内文件夹")).toBeNull();
  });
});

describe("录入框两行（属性行已退出功能栏，2026-10-01）", () => {
  it("三档切换只有输入区 + 模式行：不出现属性容器、截止/优先级、首行作标题、落点 chip", async () => {
    const user = userEvent.setup();
    render(<Composer onPublishNote={vi.fn()} />);

    // 属性行连同它的容器一起没了（原 `.composer__extras[data-testid="composer-extras"]`）
    expect(screen.queryByTestId("composer-extras")).toBeNull();

    await user.click(screen.getByRole("button", { name: "待办" }));
    // task 档不再有可编辑属性：没有日期控件、没有优先级三段
    expect(screen.queryByLabelText("截止日期")).toBeNull();
    for (const label of ["高", "中", "低"]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }

    await user.click(screen.getByRole("button", { name: "笔记" }));
    expect(screen.queryByText("首行作标题")).toBeNull();
    expect(screen.queryByText("根目录")).toBeNull();
    // 需求 §8.7：输入框没有加密开关
    expect(screen.queryByText("加密")).toBeNull();
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

  it("待办档发布用默认值：无截止 + 优先级「中」（属性去添加内容窗口设）", async () => {
    const user = userEvent.setup();
    const onPublishTask = vi.fn();
    const onPublishNote = vi.fn();
    render(<Composer onPublishTask={onPublishTask} onPublishNote={onPublishNote} />);

    await user.click(screen.getByRole("button", { name: "待办" }));
    const input = screen.getByLabelText("快速录入") as HTMLTextAreaElement;
    await user.click(input);
    await user.keyboard("买牛奶");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onPublishTask).toHaveBeenCalledWith("买牛奶", { due: null, priority: "medium" });
    expect(onPublishNote).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("Memo 档 Ctrl+Enter 发布：清空输入框、asTask 恒为 false", async () => {
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

  it("写了 - [ ] 也不会自动标清单：功能栏录入框不再给「设为清单？」入口（`asTask` 恒 false）", async () => {
    const user = userEvent.setup();
    const onPublishMemo = vi.fn();
    render(<Composer onPublishMemo={onPublishMemo} />);

    const input = screen.getByLabelText("快速录入") as HTMLTextAreaElement;
    await user.click(input);
    // user.type 会把 [ 当特殊键，所以直接赋值
    fireEvent.change(input, { target: { value: "普通一条\n- [ ] 买牛奶" } });
    expect(screen.queryByRole("button", { name: /设为清单/ })).toBeNull();

    await user.click(input);
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onPublishMemo).toHaveBeenCalledWith("普通一条\n- [ ] 买牛奶", { asTask: false });
  });
});

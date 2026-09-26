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
import { cleanup, render, screen, within } from "@testing-library/react";
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
      view={{ kind: "notebook" }}
      onViewChange={vi.fn()}
      counts={{ notebook: 3 }}
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

  it("未接入的浏览三段禁用并说明原因（不做空入口）", () => {
    renderFnBar();
    const home = screen.getByRole("tab", { name: /首页/ }) as HTMLButtonElement;
    expect(home.disabled).toBe(true);
    expect(home.title).toContain("M2-8");
    expect((screen.getByRole("tab", { name: /Memo/ }) as HTMLButtonElement).title).toContain("M2-4");
    expect((screen.getByRole("tab", { name: /待办/ }) as HTMLButtonElement).title).toContain("M2-5");
  });

  it("导航与分组：最近编辑/收藏、笔记本带计数、标签云来自条目", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    renderFnBar({ onViewChange });

    expect(screen.getByRole("button", { name: /最近编辑/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /收藏/ })).toBeTruthy();

    const notebook = screen.getByRole("button", { name: /笔记本/ });
    expect(notebook.textContent).toContain("3");

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
    expect(extras.textContent).toContain("截止");
    expect(extras.textContent).toContain("优先级");

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

    const input = screen.getByLabelText("快速录入");
    await user.click(input);
    await user.keyboard("随手一记");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onPublishNote).not.toHaveBeenCalled();
  });
});

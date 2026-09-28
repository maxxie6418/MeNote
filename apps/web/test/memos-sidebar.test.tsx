// @vitest-environment jsdom
/**
 * Memo 侧栏与瀑布流图册（B3 批，2026-09-28）。
 *
 * 四条要钉住的契约（设计稿 `docs/modules/Menote-Memo侧栏与图册-设计-v1.md`）：
 * 1. **可插拔**：面板按注册表渲染，`memo_view.sidebar` 的 `order` / `hidden` 决定顺序与显隐，
 *    未知 id 只被忽略（这是"旧客户端不抹掉新模块配置"的那条纪律）；
 * 2. **六块各自的内容**：概述三数、热力图 84 格、随机漫步、那年今日（没有往年记录不渲染）、
 *    日期、标签；
 * 3. **视图切换**：时间轴 ↔ 瀑布流；图册只画有图且已上传的 Memo，没有则给空态出口；
 * 4. **定位**：随机漫步 / 那年今日 / 图册点卡都会**先松开筛选**再切回时间轴、并高亮 2 秒。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { noPrivacyGate } from "@menote/shared";
import type { LocalItem } from "../src/data/db";
import { MemoPanel } from "../src/features/memos/ui/MemoPanel";

afterEach(cleanup);

/** 2026-09-26 14:05（北京时间） */
const NOW = Date.UTC(2026, 8, 26, 6, 5);

function memo(id: string, memoAt: number, extra: Partial<LocalItem> = {}): LocalItem {
  return {
    id,
    type: "memo",
    folder_id: null,
    title: null,
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 10,
    content_hash: "h",
    tags: [],
    memo_at: memoAt,
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
    created_at: memoAt,
    updated_at: memoAt,
    last_edit_at: memoAt,
    last_device: null,
    deleted_at: null,
    deleted: false,
    pending: null,
    ...extra,
  };
}

/** 今天 2 条 + 往年同月日 1 条（让「那年今日」有东西可指） */
const MEMOS = [
  memo("today-1", NOW, { tags: ["工作"] }),
  memo("today-2", NOW - 3_600_000, { tags: ["工作", "生活"] }),
  memo("last-year", Date.UTC(2025, 8, 26, 1, 0)),
];

function renderPanel(overrides: Partial<Parameters<typeof MemoPanel>[0]> = {}) {
  const onAdd = vi.fn();
  const { container } = render(
    <MemoPanel
      memos={MEMOS}
      contents={{
        "today-1": { content: "今天开会讨论方案", convertedTo: null },
        "today-2": { content: "买菜：西红柿", convertedTo: null },
        "last-year": { content: "去年今天在搬家", convertedTo: null },
      }}
      gate={noPrivacyGate()}
      onUnlock={vi.fn()}
      onSave={vi.fn()}
      onTogglePinned={vi.fn()}
      onConvert={vi.fn()}
      onOpenConverted={vi.fn()}
      onAdd={onAdd}
      onDelete={vi.fn()}
      now={NOW}
      {...overrides}
    />,
  );
  return { container, onAdd };
}

/** 侧栏里各块的小标题（顺序即渲染顺序） */
function sidebarTitles(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".memopanel__side .subblk__t")].map(
    (node) => node.textContent ?? "",
  );
}

describe("侧栏：可插拔模块", () => {
  it("默认按清单顺序渲染六块", () => {
    const { container } = renderPanel();
    expect(sidebarTitles(container)).toEqual([
      "概述",
      "热力图",
      "那年今日",
      "日期",
      "标签",
    ]);
    // 随机漫步没有小标题（按钮本体就是入口），单独认一下
    expect(container.querySelector(".subact--solo")?.textContent).toContain("随机漫步");
  });

  it("设置里的 order / hidden 立刻生效；未知 id 只被忽略", () => {
    const { container } = renderPanel({
      sidebar: { order: ["tags", "未来模块"], hidden: ["heatmap", "随机"] },
    });

    const titles = sidebarTitles(container);
    expect(titles[0]).toBe("标签");
    expect(titles).not.toContain("热力图");
    expect(titles).toContain("概述");
    // order 里写了的排前面，没写的按默认顺序补在后面
    expect(titles.slice(0, 2)).toEqual(["标签", "概述"]);
  });

  it("概述给三个数字；热力图铺 84 格", () => {
    const { container } = renderPanel();
    const stats = [...container.querySelectorAll(".stat3__n")].map((node) => node.textContent);
    // 总数 3 / **本月**新增 2（今天那两条；去年那条不在本月）/ 记录天数 2（今天 + 去年那天）
    expect(stats).toEqual(["3", "2", "2"]);
    expect(container.querySelectorAll(".heat .hm")).toHaveLength(84);
  });

  it("那年今日：有往年记录才渲染，显示日期与条数", () => {
    const { container } = renderPanel();
    const otd = container.querySelector(".otd");
    expect(otd?.textContent).toContain("2025年9月26日");
    expect(otd?.textContent).toContain("1 条");

    cleanup();
    const only = renderPanel({ memos: [memo("only-this-year", NOW)] });
    expect(only.container.querySelector(".otd")).toBeNull();
  });

  it("标签按纵向列表给计数（全部 = 全部 Memo 条数）", () => {
    const { container } = renderPanel();
    const items = [...container.querySelectorAll(".subitem")];
    expect(items[0]?.textContent).toContain("全部");
    expect(items[0]?.textContent).toContain("3");
    expect(items.some((item) => item.textContent?.includes("# 工作"))).toBe(true);
  });
});

describe("视图切换与图册", () => {
  it("默认时间轴；切到瀑布流后没有图就给空态与出口", async () => {
    const user = userEvent.setup();
    const { container, onAdd } = renderPanel();

    expect(container.querySelector(".timeline")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "瀑布流" }));

    expect(container.querySelector(".flow")).toBeNull();
    expect(screen.getByText("还没有带图的 Memo")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /切到录入框/ }));
    expect(onAdd).toHaveBeenCalled();
  });

  it("有已上传的图片时渲染瓦片；宽高缺失取方档", async () => {
    const user = userEvent.setup();
    const images = new Map([
      ["today-1", [{ sha256: "a".repeat(64), width: null, height: null, hasThumb: true }]],
    ]);
    const { container } = renderPanel({ images });

    await user.click(screen.getByRole("button", { name: "瀑布流" }));
    const tile = container.querySelector(".wf");
    expect(tile).toBeTruthy();
    expect(tile?.querySelector(".wf__img--sq")).toBeTruthy();
    // 只画有图的那一条
    expect(container.querySelectorAll(".wf")).toHaveLength(1);
    // 说明取正文首行
    expect(tile?.textContent).toContain("今天开会讨论方案");
  });

  it("点图册瓦片：切回时间轴并高亮那一条", async () => {
    const user = userEvent.setup();
    const images = new Map([
      ["today-1", [{ sha256: "b".repeat(64), width: 1600, height: 900, hasThumb: false }]],
    ]);
    const { container } = renderPanel({ images });

    await user.click(screen.getByRole("button", { name: "瀑布流" }));
    await user.click(container.querySelector(".wf__open") as HTMLButtonElement);

    expect(container.querySelector(".timeline")).toBeTruthy();
    expect(container.querySelector(".timeline__item.is-walked")).toBeTruthy();
  });
});

describe("定位（随机漫步 / 那年今日）", () => {
  it("随机漫步：先松开筛选再定位（目标被标签筛掉也能跳到）", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    // 先筛成只剩「生活」这一条
    await user.click(
      [...container.querySelectorAll<HTMLButtonElement>(".subitem")].find((item) =>
        item.textContent?.includes("# 生活"),
      ) as HTMLButtonElement,
    );
    expect(container.querySelectorAll(".memo")).toHaveLength(1);

    // 注意：`.subact--solo` 本身就是那个 button（不是里面还有个 button）
    await user.click(container.querySelector(".subact--solo") as HTMLButtonElement);

    // 筛选松开 → 三条都回来，并且有一条被高亮
    expect(container.querySelectorAll(".memo")).toHaveLength(3);
    expect(container.querySelectorAll(".timeline__item.is-walked")).toHaveLength(1);
  });

  it("那年今日：点它定位到往年那一条", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    await user.click(container.querySelector(".otd") as HTMLButtonElement);

    const walked = container.querySelector(".timeline__item.is-walked");
    expect(walked?.querySelector("[data-memo-id]")?.getAttribute("data-memo-id")).toBe("last-year");
  });
});

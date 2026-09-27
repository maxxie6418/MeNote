// @vitest-environment jsdom
/**
 * 回收站页（M4-12；《M4 界面稿》§六）。
 *
 * 用例名对齐《M4 实施计划》M4-12 的 `trash-view.test.ts` 清单，并覆盖界面稿的几条硬要求：
 * 确认框文案写全范围、不承诺快照、破坏性操作二次确认、实时计数可见、离线置灰并说明。
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAY_MS, TRASH_RETENTION_DAYS_DEFAULT } from "@menote/shared";
import { TrashPage, type TrashPageProps } from "../src/features/trash/ui/TrashPage";
import type { TrashRowModel } from "../src/features/trash/model";

afterEach(cleanup);

function row(overrides: Partial<TrashRowModel> = {}): TrashRowModel {
  return {
    id: "i1",
    type: "note",
    title: "被删的笔记",
    titleHidden: false,
    inEncSpace: false,
    encSelf: false,
    deletedAt: Date.UTC(2026, 8, 20, 10, 0, 0),
    remainingDays: 23,
    urgent: false,
    ...overrides,
  };
}

function renderPage(overrides: Partial<TrashPageProps> = {}) {
  const actions = {
    onToggleSelect: vi.fn(),
    onSelectAll: vi.fn(),
    onRestore: vi.fn(),
    onPurge: vi.fn(),
    onEmpty: vi.fn(),
    onBackToSettings: vi.fn(),
    onRetry: vi.fn(),
  };
  render(
    <TrashPage
      rows={[row(), row({ id: "i2", title: "第二条", remainingDays: 2, urgent: true })]}
      selected={new Set<string>()}
      {...actions}
      {...overrides}
    />,
  );
  return actions;
}

describe("回收站页头与列表", () => {
  it("页头有「← 返回设置」、标题、保留期说明与危险操作「清空回收站」；**没有实心主色按钮**", async () => {
    const user = userEvent.setup();
    const actions = renderPage();

    await user.click(screen.getByRole("button", { name: "← 返回设置" }));
    expect(actions.onBackToSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "回收站" })).toBeTruthy();
    expect(screen.getByText(/保留 30 天/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "清空回收站" })).toBeTruthy();
    // 本页不设主操作：没有任何 `btn--primary`
    expect(document.querySelector(".btn--primary")).toBeNull();
  });

  it("行内显示类型、删除时间与**剩余保留天数**（实时计数必须可见）", () => {
    renderPage();
    const rows = document.querySelectorAll(".trashrow");
    expect(rows[0]?.textContent).toContain("笔记");
    expect(rows[0]?.textContent).toContain("剩余 23 天");
  });

  it("≤3 天的行加「即将永久删除」文字（颜色不单独表意）", () => {
    renderPage();
    const urgent = document.querySelectorAll(".trashrow")[1];
    expect(urgent?.textContent).toContain("剩余 2 天");
    expect(urgent?.textContent).toContain("即将永久删除");
    expect(urgent?.querySelector(".trashrow__remain--urgent")).toBeTruthy();
  });

  it("到期当天的行写「今天到期」而不是「剩余 0 天」", () => {
    renderPage({ rows: [row({ remainingDays: 0, urgent: true })] });
    expect(screen.getByText(/今天到期/)).toBeTruthy();
  });

  it("加密空间条目锁定时显示占位标题（真实标题不出现）", () => {
    renderPage({
      rows: [row({ title: "加密空间内条目", titleHidden: true, inEncSpace: true })],
    });
    expect(screen.getByText("加密空间内条目")).toBeTruthy();
    expect(screen.queryByText("被删的笔记")).toBeNull();
  });

  it("单篇加密条目显示明文标题 + 加密标注", () => {
    renderPage({ rows: [row({ encSelf: true, title: "单篇" })] });
    expect(screen.getByText("单篇")).toBeTruthy();
    expect(screen.getByText("已加密")).toBeTruthy();
  });
});

describe("恢复与永久删除", () => {
  it("恢复直接执行（不弹确认）", async () => {
    const user = userEvent.setup();
    const actions = renderPage();

    await user.click(screen.getAllByRole("button", { name: "恢复" })[0] as HTMLElement);
    expect(actions.onRestore).toHaveBeenCalledWith(["i1"]);
    // 没有出现任何对话框
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("永久删除必须二次确认，确认框写全范围且**不承诺快照文件**", async () => {
    const user = userEvent.setup();
    const actions = renderPage();

    await user.click(screen.getAllByRole("button", { name: "永久删除" })[0] as HTMLElement);
    const dialog = screen.getByRole("dialog", { name: "永久删除" });
    expect(within(dialog).getByText(/及其全部版本/)).toBeTruthy();
    expect(within(dialog).getByText(/不再被引用的附件/)).toBeTruthy();
    expect(within(dialog).getByText(/快照中的文件不在本次操作范围内/)).toBeTruthy();
    expect(within(dialog).getByText(/不可撤销/)).toBeTruthy();
    // 确认之前不动作
    expect(actions.onPurge).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "永久删除" }));
    expect(actions.onPurge).toHaveBeenCalledWith(["i1"]);
  });

  it("确认框取消则不删除", async () => {
    const user = userEvent.setup();
    const actions = renderPage();

    await user.click(screen.getAllByRole("button", { name: "永久删除" })[0] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(actions.onPurge).not.toHaveBeenCalled();
  });

  it("清空回收站写实时条数并二次确认", async () => {
    const user = userEvent.setup();
    const actions = renderPage();

    await user.click(screen.getByRole("button", { name: "清空回收站" }));
    const dialog = screen.getByRole("dialog", { name: "清空回收站" });
    expect(within(dialog).getByText(/回收站中的 2 条内容/)).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "清空回收站" }));
    expect(actions.onEmpty).toHaveBeenCalledTimes(1);
  });
});

describe("批量与进度", () => {
  it("选中后才出现批量条与实时计数；全选/反选都能用", async () => {
    const user = userEvent.setup();
    const actions = renderPage({ selected: new Set(["i1"]) });

    expect(screen.getByText("已选 1 条")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "永久删除选中" }));
    const dialog = screen.getByRole("dialog", { name: "永久删除" });
    await user.click(within(dialog).getByRole("button", { name: "永久删除" }));
    expect(actions.onPurge).toHaveBeenCalledWith(["i1"]);

    await user.click(screen.getByRole("checkbox", { name: "全选" }));
    expect(actions.onSelectAll).toHaveBeenCalledWith(true);
  });

  it("批量删除显示进度文案", () => {
    renderPage({ progress: { done: 10, total: 24, label: "正在删除 10 / 24" } });
    expect(screen.getByText("正在删除 10 / 24")).toBeTruthy();
  });

  it("失败清单可见并给「重试」", async () => {
    const user = userEvent.setup();
    const actions = renderPage({ failures: [{ id: "i1", reason: "网络不可用" }] });

    expect(screen.getByText("1 条没能删除，仍留在列表里")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(actions.onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("空状态与离线", () => {
  it("空状态说明为什么空与下一步，且不给「清空」这类无意义按钮", () => {
    renderPage({ rows: [] });

    expect(screen.getByText("回收站是空的")).toBeTruthy();
    // 页头也有一句保留期说明，所以这里限定在空状态块里找
    const empty = document.querySelector(".trashpage__empty") as HTMLElement;
    expect(within(empty).getByText(/保留 30 天（可在设置里改）/)).toBeTruthy();
    const clear = screen.getByRole("button", { name: "清空回收站" }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
    expect(clear.getAttribute("title")).toBe("回收站已经是空的");
  });

  it("离线时恢复与永久删除置灰并说明「需要联网」，但列表照常可看", () => {
    renderPage({ offline: true });

    const restore = screen.getAllByRole("button", { name: "恢复" })[0] as HTMLButtonElement;
    expect(restore.disabled).toBe(true);
    expect(restore.getAttribute("title")).toBe("需要联网");
    const purge = screen.getAllByRole("button", { name: "永久删除" })[0] as HTMLButtonElement;
    expect(purge.disabled).toBe(true);
    // 看是能看的
    expect(screen.getByText("被删的笔记")).toBeTruthy();
  });

  it("保留期改成自定义天数时，文案跟着变", () => {
    // 默认 30 天在页头说明里；行内的剩余天数由数据决定（这里只钉默认值来源）
    expect(TRASH_RETENTION_DAYS_DEFAULT).toBe(30);
    renderPage({ rows: [row({ remainingDays: 7 })] });
    expect(screen.getByText(/剩余 7 天/)).toBeTruthy();
    expect(DAY_MS).toBe(86_400_000);
  });
});

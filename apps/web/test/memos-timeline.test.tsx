// @vitest-environment jsdom
/**
 * 时间轴的两列结构（按用户原型 `deliverables/pages-redesign-2026-09-27/index.html` 的 `.tl__*`）。
 *
 * 原型要点：**左栏 88px 放日期（+星期）/ 每条的时刻**，右列是内容；主干上有节点
 * （日期=主色实心点、条目=空心点）。改这一处时最容易回退成"单列 + 日期星期拼一行"，
 * 所以本文件把这几条钉住。
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dayPartsInZone } from "../src/features/memos/model";
import { MemoTimeline } from "../src/features/memos/ui/MemoTimeline";
import type { LocalItem } from "../src/data/db";

afterEach(cleanup);

/** 同一天的 13:05 与 21:40（本地时区构造，避免时区相关的期望值漂移） */
const DAY = new Date(2026, 8, 27, 13, 5).getTime();
const LATER = new Date(2026, 8, 27, 21, 40).getTime();

function memo(id: string, at: number): LocalItem {
  return {
    id,
    type: "memo",
    folder_id: null,
    title: `备忘 ${id}`,
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 10,
    content_hash: "h",
    tags: [],
    memo_at: at,
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
    created_at: at,
    updated_at: at,
    last_edit_at: at,
    last_device: null,
    deleted_at: null,
    deleted: false,
    pending: null,
  };
}

function renderTimeline(): HTMLElement {
  const { container } = render(
    <MemoTimeline
      memos={[memo("m1", DAY), memo("m2", LATER)]}
      contents={{
        m1: { content: "第一条", convertedTo: null },
        m2: { content: "第二条", convertedTo: null },
      }}
      onSave={vi.fn()}
      onTogglePinned={vi.fn()}
      onConvert={vi.fn()}
      onDelete={vi.fn()}
      onOpenConverted={vi.fn()}
      onSelectTag={vi.fn()}
    />,
  );
  return container;
}

describe("日期与星期分开取", () => {
  it("`dayPartsInZone` 把「日期」与「星期」分成两个字段（原型是两行）", () => {
    const parts = dayPartsInZone(DAY, "Asia/Shanghai");
    expect(parts.date).toContain("9月27日");
    // 星期是独立字段：日期里**不含**它（拼接就会退化成改前那样）
    expect(parts.date).not.toContain("周");
    expect(parts.weekday).toContain("周");
  });
});

describe("时间轴两列结构", () => {
  it("日期行：左栏是日期 + 星期两行，且日期里不含星期", () => {
    const container = renderTimeline();
    const date = container.querySelector(".timeline__date");
    expect(date?.textContent ?? "").toContain("9月27日");
    expect(date?.textContent ?? "").not.toContain("周");
    expect(container.querySelector(".timeline__wd")?.textContent ?? "").toContain("周");
  });

  it("每条的时刻在**左栏**（原型 `.tl__time`），卡片里不再重复显示", () => {
    const container = renderTimeline();
    const gutters = [...container.querySelectorAll(".timeline__gutter .timeline__time")];
    // 时间轴是**最新在上**（既有排序口径），所以顺序是 21:40 → 13:05
    expect(gutters.map((node) => node.textContent)).toEqual(["21:40", "13:05"]);
    // 防回退：卡片里不该再出现 `.memo__time`（同一信息不要出现两次）
    expect(container.querySelector(".memo__time")).toBeNull();
  });

  it("主干节点：每天一个日期实心点，每条一个空心点（原型 `.tl__node` / `.tl__dot`）", () => {
    const container = renderTimeline();
    expect(container.querySelectorAll(".timeline__node")).toHaveLength(1);
    expect(container.querySelectorAll(".timeline__dot")).toHaveLength(2);
    // 内容在右列（`.timeline__content`），每条 Memo 一个
    expect(container.querySelectorAll(".timeline__content .memo")).toHaveLength(2);
  });
});

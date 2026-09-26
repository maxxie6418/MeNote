// 设置时区为 Asia/Shanghai（UTC+8）：跨时区分组是本模块最容易出错的地方，单独钉住
import { describe, expect, it } from "vitest";
import {
  buildNoteFromMemo,
  collectMemoTags,
  dayKeyInZone,
  dayLabelInZone,
  DEFAULT_TIME_ZONE,
  EMPTY_FILTER,
  filterMemos,
  groupMemosByDay,
  sortMemos,
  startOfDayInZone,
  timeLabelInZone,
  type MemoLike,
} from "../src/features/memos/model";

function memo(id: string, memoAt: number | null, extra: Partial<MemoLike> = {}): MemoLike {
  return { id, memo_at: memoAt, pinned: 0, tags: [], is_task: 0, ...extra };
}

/** 2026-09-26 14:05（北京时间）= 06:05 UTC */
const T = Date.UTC(2026, 8, 26, 6, 5);

describe("时区下的日期与时间", () => {
  it("默认时区是 Asia/Shanghai", () => {
    expect(DEFAULT_TIME_ZONE).toBe("Asia/Shanghai");
  });

  it("按设置时区算日历日（不是本机时区）", () => {
    expect(dayKeyInZone(T)).toBe("2026-09-26");
    // 北京时间 00:30 属于 26 日，而 UTC 还停在 25 日 —— 这正是"不能用本机时区"的意义
    const earlyMorning = Date.UTC(2026, 8, 25, 16, 30);
    expect(dayKeyInZone(earlyMorning)).toBe("2026-09-26");
    expect(dayKeyInZone(earlyMorning, "UTC")).toBe("2026-09-25");
  });

  it("日期标题与时刻文案", () => {
    expect(dayLabelInZone(T)).toContain("9月26日");
    expect(timeLabelInZone(T)).toBe("14:05");
  });

  it("当天 0 点：时区下的 00:00（不是 UTC 0 点）", () => {
    const start = startOfDayInZone(T);
    expect(dayKeyInZone(start)).toBe("2026-09-26");
    expect(start).toBe(Date.UTC(2026, 8, 25, 16, 0)); // 北京时间 26 日 0 点 = UTC 25 日 16 点
  });
});

describe("排序与分组", () => {
  it("置顶在前，其余按 memo_at 倒序（Q9）", () => {
    const sorted = sortMemos([
      memo("a", 100),
      memo("b", 300),
      memo("c", 200, { pinned: 1 }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["c", "b", "a"]);
  });

  it("按天分组，天与天内都倒序", () => {
    const days = groupMemosByDay([
      memo("old", Date.UTC(2026, 8, 24, 2, 0)),
      memo("new", Date.UTC(2026, 8, 26, 6, 5)),
      memo("mid", Date.UTC(2026, 8, 26, 1, 0)),
    ]);

    expect(days.map((day) => day.dayKey)).toEqual(["2026-09-26", "2026-09-24"]);
    expect(days[0]?.memos.map((item) => item.id)).toEqual(["new", "mid"]);
  });

  it("memo_at 为空的条目不进时间轴", () => {
    expect(groupMemosByDay([memo("x", null), memo("y", T)])).toHaveLength(1);
  });

  it("置顶的 Memo 出现在时间轴最上方（Q9）", () => {
    const days = groupMemosByDay([
      memo("plain", Date.UTC(2026, 8, 26, 6, 5)),
      memo("pinned", Date.UTC(2026, 8, 20, 6, 0), { pinned: 1 }),
    ]);
    expect(days[0]?.dayKey).toBe("2026-09-20");
  });
});

describe("标签与日期范围筛选", () => {
  const memos = [
    memo("today", T, { tags: ["工作"] }),
    memo("threeDaysAgo", T - 3 * 24 * 60 * 60 * 1000, { tags: ["工作", "dev"] }),
    memo("twentyDaysAgo", T - 20 * 24 * 60 * 60 * 1000, { tags: [] }),
  ];

  it("不筛选时返回全部", () => {
    expect(filterMemos(memos, EMPTY_FILTER, T)).toHaveLength(3);
  });

  it("标签筛选", () => {
    expect(filterMemos(memos, { tag: "工作", range: "all" }, T).map((m) => m.id)).toEqual([
      "today",
      "threeDaysAgo",
    ]);
    expect(filterMemos(memos, { tag: "dev", range: "all" }, T).map((m) => m.id)).toEqual([
      "threeDaysAgo",
    ]);
  });

  it("日期范围：今天 / 近 7 天 / 近 30 天", () => {
    expect(filterMemos(memos, { tag: null, range: "today" }, T).map((m) => m.id)).toEqual(["today"]);
    expect(filterMemos(memos, { tag: null, range: "week" }, T).map((m) => m.id)).toEqual([
      "today",
      "threeDaysAgo",
    ]);
    expect(filterMemos(memos, { tag: null, range: "month" }, T)).toHaveLength(3);
  });

  it("标签 + 范围可以叠加", () => {
    expect(filterMemos(memos, { tag: "工作", range: "week" }, T)).toHaveLength(2);
    expect(filterMemos(memos, { tag: "dev", range: "today" }, T)).toHaveLength(0);
  });
});

describe("标签云", () => {
  it("按出现次数倒序统计", () => {
    expect(collectMemoTags([memo("a", T, { tags: ["x", "y"] }), memo("b", T, { tags: ["x"] })])).toEqual([
      { tag: "x", count: 2 },
      { tag: "y", count: 1 },
    ]);
  });
});

describe("Memo 转笔记（Q10）", () => {
  it("标题取正文第一行，正文为其余内容", () => {
    expect(buildNoteFromMemo("买菜\n\n- 西红柿\n- 鸡蛋", [])).toEqual({
      title: "买菜",
      body: "- 西红柿\n- 鸡蛋",
    });
  });

  it("标题最多 50 字（按码点截断，不切半汉字）", () => {
    const long = "标".repeat(60);
    const { title } = buildNoteFromMemo(long, []);
    expect([...title]).toHaveLength(50);
  });

  it("标签原样带走（写进笔记的 YAML），清单字段不带走（Q10）", () => {
    const { body } = buildNoteFromMemo("- [ ] 买牛奶", ["生活"]);
    expect(body).toContain("tags: [生活]");
    expect(body).not.toContain("task");
  });

  it("没有标签时不写 front matter（正文保持干净）", () => {
    const { body } = buildNoteFromMemo("第一行\n第二行", []);
    expect(body).toBe("第二行");
  });

  it("首行为空时给默认标题", () => {
    expect(buildNoteFromMemo("   \n内容", []).title).toBe("未命名笔记");
  });
});

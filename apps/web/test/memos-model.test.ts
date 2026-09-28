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
  heatmap12w,
  onThisDay,
  orderedSidebarModules,
  pickRandomMemo,
  sortMemos,
  startOfDayInZone,
  summarizeMemos,
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

// ——————————————— 侧栏的派生值（B3 批） ———————————————

describe("侧栏模块的顺序与隐藏（用户配置只做这两件事）", () => {
  it("没配置时就是清单的默认顺序", () => {
    expect(orderedSidebarModules(undefined)).toEqual([
      "stats",
      "heatmap",
      "random",
      "onThisDay",
      "date",
      "tags",
    ]);
  });

  it("order 里写到的排前面，没写到的按默认顺序补在后面", () => {
    expect(orderedSidebarModules({ order: ["tags", "stats"] })).toEqual([
      "tags",
      "stats",
      "heatmap",
      "random",
      "onThisDay",
      "date",
    ]);
  });

  it("hidden 的去掉；hidden 与 order 同时给时 hidden 赢", () => {
    expect(orderedSidebarModules({ hidden: ["heatmap", "random"] })).not.toContain("heatmap");
    expect(orderedSidebarModules({ order: ["tags"], hidden: ["tags"] })[0]).toBe("stats");
  });

  it("不认识 / 已下线的 id 直接忽略（这是契约能向上兼容的关键）", () => {
    expect(
      orderedSidebarModules({ order: ["未来模块", "tags"], hidden: ["另一个未来模块"] }),
    ).toEqual(["tags", "stats", "heatmap", "random", "onThisDay", "date"]);
  });
});

describe("概述三数（原型 .stat3）", () => {
  it("总条数 / 本月新增 / 记录天数；memo_at 为空的条目不算", () => {
    const summary = summarizeMemos(
      [
        memo("a", T), // 9-26
        memo("b", Date.UTC(2026, 8, 1, 3, 0)), // 9-01（同月）
        memo("c", Date.UTC(2026, 7, 20, 3, 0)), // 8-20（上个月）
        memo("d", null), // 没有时刻：不进任何一档
      ],
      T,
    );
    expect(summary).toEqual({ total: 3, thisMonth: 2, activeDays: 3 });
  });

  it("「本月」按设置时区的日历月算，不是本机时区", () => {
    // UTC 8-31 16:30 = 北京时间 9-1 00:30 → 算进 9 月
    const edge = Date.UTC(2026, 7, 31, 16, 30);
    expect(summarizeMemos([memo("edge", edge)], T).thisMonth).toBe(1);
    expect(summarizeMemos([memo("edge", edge)], T, "UTC").thisMonth).toBe(0);
  });
});

describe("热力图（原型 .heat：12 周 × 7 天，一列一周）", () => {
  it("84 格；一列一周（第一格是周一），最后一列是本周", () => {
    const map = heatmap12w([], T);
    expect(map.cells).toHaveLength(84);
    // 第一格必须是周一（`grid-auto-flow: column` 依赖这个顺序）
    expect(new Date(`${map.cells[0]?.dayKey}T00:00:00Z`).getUTCDay()).toBe(1);
    // 2026-09-26 是周六 → 本周第 6 行（索引 11*7+5 = 82）是今天，83 是周日
    expect(map.cells[82]?.dayKey).toBe("2026-09-26");
    expect(map.cells[83]?.dayKey).toBe("2026-09-27");
  });

  it("分 5 档：0 / 1 / 2–3 / 4–5 / 6+，并给出总条数与文案", () => {
    const sameDay = (count: number, dayOffset = 0) =>
      Array.from({ length: count }, (_, index) => memo(`m${dayOffset}-${index}`, T - dayOffset * 86_400_000));

    const map = heatmap12w(
      [...sameDay(1, 0), ...sameDay(3, 1), ...sameDay(4, 2), ...sameDay(6, 3)],
      T,
    );
    const levelAt = (offset: number) => map.cells[82 - offset]?.level;

    expect(levelAt(0)).toBe(1);
    expect(levelAt(1)).toBe(2);
    expect(levelAt(2)).toBe(3);
    expect(levelAt(3)).toBe(4);
    expect(levelAt(4)).toBe(0);
    expect(map.total).toBe(1 + 3 + 4 + 6);
    expect(map.label).toBe("近 12 周 · 共 14 条");
  });

  it("12 周之外的老记录不进热力图（但也不影响概述）", () => {
    const map = heatmap12w([memo("old", T - 200 * 86_400_000)], T);
    expect(map.total).toBe(0);
    expect(summarizeMemos([memo("old", T - 200 * 86_400_000)], T).total).toBe(1);
  });
});

describe("那年今日（原型 .otd）", () => {
  it("没有往年记录时返回 null（不渲染空壳）", () => {
    expect(onThisDay([memo("this-year", T)], T)).toBeNull();
  });

  it("排除今年：今年同月日的记录不算", () => {
    const lastYear = Date.UTC(2025, 8, 26, 6, 0);
    const result = onThisDay([memo("this-year", T), memo("last-year", lastYear)], T);
    expect(result?.dayKey).toBe("2025-09-26");
    expect(result?.count).toBe(1);
  });

  it("前后等距时取更早的那一天", () => {
    const earlier = Date.UTC(2025, 8, 25, 6, 0);
    const later = Date.UTC(2025, 8, 27, 6, 0);
    expect(onThisDay([memo("later", later), memo("earlier", earlier)], T)?.dayKey).toBe(
      "2025-09-25",
    );
  });

  it("同月日跨年时取最近的那一年，并给那一天最早的时刻与条数", () => {
    const older = Date.UTC(2024, 8, 26, 1, 0);
    // 注意用 UTC 表达时也要落在**北京时间的 9-26**（UTC 16:00 之后就是次日了）
    const newer = Date.UTC(2025, 8, 26, 1, 0);
    const alsoNewer = Date.UTC(2025, 8, 26, 4, 0);
    const result = onThisDay(
      [memo("old", older), memo("new", newer), memo("new-late", alsoNewer)],
      T,
    );

    expect(result?.dayKey).toBe("2025-09-26");
    expect(result?.count).toBe(2);
    expect(result?.at).toBe(newer); // 最早的时刻，用来定位
  });
});

describe("随机漫步（原型 .subact--solo）", () => {
  it("空列表返回 null；随机源可注入（测试不靠真随机）", () => {
    expect(pickRandomMemo([])).toBeNull();
    const items = ["a", "b", "c"];
    expect(pickRandomMemo(items, () => 0)).toBe("a");
    expect(pickRandomMemo(items, () => 0.5)).toBe("b");
  });

  it("随机源给到边界值 1 也不会越界", () => {
    expect(pickRandomMemo(["a", "b"], () => 1)).toBe("b");
  });
});

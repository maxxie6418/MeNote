import { describe, expect, it } from "vitest";
import type { LocalItem } from "../src/data/db";
import { homeStats, openTaskPreview, recentPreview, topTags } from "../src/features/home/model";

function item(id: string, extra: Partial<LocalItem> = {}): LocalItem {
  return {
    id,
    type: "note",
    folder_id: null,
    title: `标题 ${id}`,
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 10,
    content_hash: "h",
    tags: [],
    memo_at: null,
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
    created_at: 1,
    updated_at: 1,
    last_edit_at: 1,
    last_device: null,
    deleted_at: null,
    deleted: false,
    pending: null,
    ...extra,
  };
}

describe("条目统计", () => {
  it("按类型计数：笔记 / 表格 / Memo", () => {
    expect(
      homeStats([
        item("a"),
        item("b"),
        item("c", { type: "table", title: "表" }),
        item("d", { type: "memo", title: null, memo_at: 1 }),
      ]),
    ).toEqual({ notes: 2, tables: 1, memos: 1, total: 4 });
  });

  it("**始终计入加密条目**（统计口径不区分锁定状态）", () => {
    const stats = homeStats([
      item("plain"),
      item("enc", { enc_self: 1 }),
      item("space", { in_enc_space: 1 }),
      item("memo", { type: "memo", title: null, memo_at: 1, in_enc_space: 1 }),
    ]);
    expect(stats.notes).toBe(3);
    expect(stats.memos).toBe(1);
    expect(stats.total).toBe(4);
  });

  it("空库时全为 0（卡片据此显示空态）", () => {
    expect(homeStats([])).toEqual({ notes: 0, tables: 0, memos: 0, total: 0 });
  });
});

describe("今日待办预览", () => {
  const titles = { t1: "交物业费", t2: "写周报", t3: "买牛奶" };

  it("只取未完成的清单条目，按截止 → 优先级排序，最多 4 条", () => {
    const preview = openTaskPreview(
      [
        item("t1", { is_task: 1, task_status: "todo", task_due: "2026-09-30", task_priority: "low" }),
        item("t2", { is_task: 1, task_status: "doing", task_due: "2026-09-27", task_priority: "high" }),
        item("t3", { is_task: 1, task_due: null, task_priority: "high" }),
        item("done", { is_task: 1, task_status: "done" }),
        item("notTask"),
      ],
      titles,
    );

    expect(preview.map((task) => task.id)).toEqual(["t2", "t1", "t3"]);
    expect(preview[0]?.title).toBe("写周报");
  });

  it("没有未完成待办时返回空数组（空态文案在卡片里）", () => {
    expect(openTaskPreview([item("done", { is_task: 1, task_status: "done" })], {})).toEqual([]);
  });

  it("标题缺失时给占位名", () => {
    expect(openTaskPreview([item("x", { is_task: 1 })], {})[0]?.title).toBe("未命名");
  });
});

describe("最近动态", () => {
  it("按最近更新倒序取前若干条", () => {
    const entries = recentPreview([
      item("old", { updated_at: 1 }),
      item("new", { updated_at: 9 }),
      item("mid", { updated_at: 5 }),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(["new", "mid", "old"]);
  });

  it("没有标题时给占位名；类型带出去（图标用）", () => {
    expect(recentPreview([item("t", { title: null, type: "table" })])[0]).toMatchObject({
      title: "未命名笔记",
      type: "table",
    });
  });

  it("空数组返回空（卡片显示空态）", () => {
    expect(recentPreview([])).toEqual([]);
  });
});

describe("快速导航的标签", () => {
  it("按出现次数倒序、同数按名称，取前若干个", () => {
    expect(
      topTags([item("a", { tags: ["工作", "dev"] }), item("b", { tags: ["工作"] })], 6),
    ).toEqual([
      { tag: "工作", count: 2 },
      { tag: "dev", count: 1 },
    ]);
  });

  it("limit 生效", () => {
    expect(topTags([item("a", { tags: ["a", "b", "c"] })], 2)).toHaveLength(2);
  });
});

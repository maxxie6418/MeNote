import { describe, expect, it } from "vitest";
import {
  collectTags,
  filterByView,
  viewTitle,
  viewKey,
  type ViewableItem,
} from "../src/features/notes/views";

const items: ViewableItem[] = [
  { starred: 1, tags: ["工作", "dev"], updated_at: 300 },
  { starred: 0, tags: ["工作"], updated_at: 200 },
  { starred: 0, tags: [], updated_at: 100 },
];

describe("视图过滤", () => {
  it("笔记本 / 最近编辑：全部未删除条目（顺序由上游保证）", () => {
    expect(filterByView(items, { kind: "notebook" })).toHaveLength(3);
    expect(filterByView(items, { kind: "recent" }).map((i) => i.updated_at)).toEqual([
      300, 200, 100,
    ]);
  });

  it("收藏：只留 starred = 1", () => {
    expect(filterByView(items, { kind: "starred" })).toHaveLength(1);
  });

  it("标签：按标签筛选（大小写敏感的原始写法）", () => {
    expect(filterByView(items, { kind: "tag", tag: "工作" })).toHaveLength(2);
    expect(filterByView(items, { kind: "tag", tag: "dev" })).toHaveLength(1);
    expect(filterByView(items, { kind: "tag", tag: "不存在" })).toHaveLength(0);
  });

  it("过滤不修改原数组", () => {
    const copy = [...items];
    filterByView(items, { kind: "starred" });
    expect(items).toEqual(copy);
  });

  it("标题与视图键：标签视图带 # 前缀，键唯一", () => {
    expect(viewTitle({ kind: "notebook" })).toBe("全部笔记");
    expect(viewTitle({ kind: "recent" })).toBe("最近编辑");
    expect(viewTitle({ kind: "starred" })).toBe("收藏");
    expect(viewTitle({ kind: "tag", tag: "工作" })).toBe("# 工作");
    expect(viewKey({ kind: "tag", tag: "工作" })).toBe("tag:工作");
    expect(viewKey({ kind: "starred" })).toBe("starred");
  });
});

describe("文件夹视图筛选", () => {
  it("文件夹视图只显示该文件夹直接包含的条目", () => {
    const scoped: ViewableItem[] = [
      { starred: 0, tags: [], updated_at: 3, folder_id: "f1" },
      { starred: 0, tags: [], updated_at: 2, folder_id: null },
      { starred: 0, tags: [], updated_at: 1 },
    ];
    expect(filterByView(scoped, { kind: "notebook", folderId: "f1" })).toHaveLength(1);
    expect(filterByView(scoped, { kind: "notebook", folderId: null })).toHaveLength(3);
    expect(viewKey({ kind: "notebook", folderId: "f1" })).toBe("folder:f1");
    expect(viewKey({ kind: "notebook", folderId: null })).toBe("notebook");
  });
});

describe("标签云统计", () => {
  it("按条目数倒序，同数按名称升序", () => {
    expect(collectTags(items)).toEqual([
      { tag: "工作", count: 2 },
      { tag: "dev", count: 1 },
    ]);
  });

  it("没有标签时为空数组", () => {
    expect(collectTags([{ starred: 0, tags: [], updated_at: 1 }])).toEqual([]);
  });

  it("同一条目里的重复标签只算一次", () => {
    expect(collectTags([{ starred: 0, tags: ["a", "a"], updated_at: 1 }])).toEqual([
      { tag: "a", count: 2 },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { noPrivacyGate, privacyGateFrom } from "@menote/shared";
import {
  collectTags,
  filterByView,
  viewTitle,
  viewKey,
  type ViewableItem,
} from "../src/features/notes/views";

/** 门禁：未启用（无门禁）。门禁分支另见下面的"隐私门禁"用例 */
const GATE = noPrivacyGate();

function note(id: string, extra: Partial<ViewableItem> = {}): ViewableItem {
  return {
    id,
    type: "note",
    enc_self: 0,
    in_enc_space: 0,
    deleted_at: null,
    starred: 0,
    tags: [],
    updated_at: 100,
    ...extra,
  };
}

const items: ViewableItem[] = [
  { ...note("a"), starred: 1, tags: ["工作", "dev"], updated_at: 300 },
  { ...note("b"), tags: ["工作"], updated_at: 200 },
  { ...note("c"), updated_at: 100 },
];

describe("视图过滤", () => {
  it("笔记本 / 最近编辑：全部未删除条目（顺序由上游保证）", () => {
    expect(filterByView(items, { kind: "notebook" }, GATE)).toHaveLength(3);
    expect(filterByView(items, { kind: "recent" }, GATE).map((i) => i.updated_at)).toEqual([
      300, 200, 100,
    ]);
  });

  it("收藏：只留 starred = 1", () => {
    expect(filterByView(items, { kind: "starred" }, GATE)).toHaveLength(1);
  });

  it("标签：按标签筛选（大小写敏感的原始写法）", () => {
    expect(filterByView(items, { kind: "tag", tag: "工作" }, GATE)).toHaveLength(2);
    expect(filterByView(items, { kind: "tag", tag: "dev" }, GATE)).toHaveLength(1);
    expect(filterByView(items, { kind: "tag", tag: "不存在" }, GATE)).toHaveLength(0);
  });

  it("过滤不修改原数组", () => {
    const copy = [...items];
    filterByView(items, { kind: "starred" }, GATE);
    expect(items).toEqual(copy);
  });

  it("隐私门禁（M3）：锁定时空间内条目不出现在三视图；单篇条目仍列出", () => {
    const withPrivacy = [
      note("plain"),
      note("space", { in_enc_space: 1 }),
      note("single", { enc_self: 1, starred: 1 }),
    ];
    const locked = privacyGateFrom(
      { scope: { memo: true }, search_bodies_when_unlocked: true },
      "locked",
    );
    const unlocked = privacyGateFrom(
      { scope: { memo: true }, search_bodies_when_unlocked: true },
      "unlocked",
    );

    expect(filterByView(withPrivacy, { kind: "recent" }, locked).map((i) => i.id)).toEqual([
      "plain",
      "single",
    ]);
    expect(filterByView(withPrivacy, { kind: "starred" }, locked).map((i) => i.id)).toEqual([
      "single",
    ]);
    // 解锁期间空间内条目进入三视图（《隐私锁设计》§5.1）
    expect(filterByView(withPrivacy, { kind: "recent" }, unlocked).map((i) => i.id)).toEqual([
      "plain",
      "space",
      "single",
    ]);
  });

  it("隐私门禁：回收站里的条目不进普通列表", () => {
    const trashed = [note("live"), note("gone", { deleted_at: 123 })];
    expect(filterByView(trashed, { kind: "recent" }, GATE).map((i) => i.id)).toEqual(["live"]);
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
      note("f1a", { folder_id: "f1", updated_at: 3 }),
      note("root", { folder_id: null, updated_at: 2 }),
      note("other", { updated_at: 1 }),
    ];
    expect(filterByView(scoped, { kind: "notebook", folderId: "f1" }, GATE)).toHaveLength(1);
    expect(filterByView(scoped, { kind: "notebook", folderId: null }, GATE)).toHaveLength(3);
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
    expect(collectTags([note("x")])).toEqual([]);
  });

  it("同一条目里的重复标签只算一次", () => {
    expect(collectTags([note("x", { tags: ["a", "a"] })])).toEqual([
      { tag: "a", count: 2 },
    ]);
  });

  it("标签云**计入**隐私条目（统计一律计入，与列表口径不同）", () => {
    expect(collectTags([note("s", { in_enc_space: 1, tags: ["私密"] }), note("p", { tags: ["私密"] })])).toEqual([
      { tag: "私密", count: 2 },
    ]);
  });
});

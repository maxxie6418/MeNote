// @vitest-environment jsdom
/**
 * 列表列按文件夹分组（B2 批；用户 2026-09-28 拍板"按方案 B 做"）。
 *
 * 钉住四条口径（设计稿 §二）：
 * 1. **全部笔记**：先「未分类」，再各第 1 层文件夹（按名称排），子夹作二级组；
 * 2. **选中某个笔记本**：只返回一组（它自己的条目 + 子夹二级组），不递归进子夹；
 * 3. **空分组不渲染**（建了但没内容的文件夹不出现在列表里）；
 * 4. **组内保持传入顺序**（调用方给的是"最近编辑倒序"，这里不重排）。
 */
import { describe, expect, it } from "vitest";
import type { LocalFolder } from "../src/data/db";
import { groupNotesByFolder, indexItemsByFolder } from "../src/features/notes/groups";

function folder(id: string, name: string, parentId: string | null, depth: number): LocalFolder {
  return {
    id,
    parent_id: parentId,
    is_enc_space: 0,
    in_enc_space: 0,
    name,
    depth,
    position: 0,
    meta_rev: 1,
    sync_seq: 1,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    deleted: false,
    pending: null,
  };
}

interface Item {
  id: string;
  folder_id: string | null;
}

const FOLDERS = [
  folder("f2", "工作", null, 1),
  folder("f1", "生活", null, 1),
  folder("f2a", "本周", "f2", 2),
  folder("f1a", "旅行", "f1", 2),
  folder("empty", "空的", null, 1),
];

describe("indexItemsByFolder（树里列条目的索引）", () => {
  it("按文件夹分组；**根目录的条目不进表**（树里没有根这一行）", () => {
    const items: Item[] = [
      { id: "a", folder_id: "f1" },
      { id: "b", folder_id: "f1" },
      { id: "root", folder_id: null },
      { id: "c", folder_id: "f2a" },
    ];

    const index = indexItemsByFolder(items);

    expect(Object.keys(index).sort()).toEqual(["f1", "f2a"]);
    expect(index.f1?.map((item) => item.id)).toEqual(["a", "b"]);
    expect(index.f2a?.map((item) => item.id)).toEqual(["c"]);
  });

  it("组内保持传入顺序（调用方给的是最近编辑倒序）", () => {
    const index = indexItemsByFolder([
      { id: "newer", folder_id: "f1" },
      { id: "older", folder_id: "f1" },
    ]);
    expect(index.f1?.map((item) => item.id)).toEqual(["newer", "older"]);
  });
});

describe("groupNotesByFolder（全部笔记）", () => {
  it("未分类固定第一组，其余文件夹按名称排；子夹作二级组", () => {
    const items: Item[] = [
      { id: "a", folder_id: null },
      { id: "b", folder_id: "f2" },
      { id: "c", folder_id: "f2a" },
      { id: "d", folder_id: "f1" },
    ];

    const groups = groupNotesByFolder(items, FOLDERS);

    expect(groups.map((group) => group.name)).toEqual(["未分类", "工作", "生活"]);
    expect(groups[0]?.folderId).toBeNull();
    expect(groups[1]?.items.map((item) => item.id)).toEqual(["b"]);
    expect(groups[1]?.children.map((child) => child.name)).toEqual(["本周"]);
    expect(groups[1]?.children[0]?.items.map((item) => item.id)).toEqual(["c"]);
    expect(groups[2]?.folderId).toBe("f1");
  });

  it("空分组不渲染：建了但没内容的文件夹与子夹都不出现", () => {
    const groups = groupNotesByFolder([{ id: "a", folder_id: "f1" }], FOLDERS);

    expect(groups.map((group) => group.name)).toEqual(["生活"]);
    // 「空的」没内容 → 不在；「旅行」没内容 → 也不作为二级组出现
    expect(groups[0]?.children).toEqual([]);
  });

  it("组内保持传入顺序（调用方给的是最近编辑倒序）", () => {
    const items: Item[] = [
      { id: "newer", folder_id: "f1" },
      { id: "older", folder_id: "f1" },
    ];

    const groups = groupNotesByFolder(items, FOLDERS);

    expect(groups[0]?.items.map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("一条都没有时返回空数组（交给空状态处理）", () => {
    expect(groupNotesByFolder([], FOLDERS)).toEqual([]);
  });

  it("孤儿条目（folder_id 指向已不存在的文件夹）落在「未分类」之外但不炸：按原 folder_id 归入无组", () => {
    // 现实里不会出现（服务端把删掉的文件夹里的条目移回根），这里只保证"不因为查不到文件夹而丢条目或抛错"
    const groups = groupNotesByFolder([{ id: "a", folder_id: "已删除的夹" }], FOLDERS);
    expect(groups).toEqual([]);
  });
});

describe("groupNotesByFolder（选中某个笔记本）", () => {
  it("只返回一组：自己的条目 + 子夹二级组，不递归进子夹", () => {
    const items: Item[] = [
      { id: "own", folder_id: "f2" },
      { id: "child", folder_id: "f2a" },
      { id: "other", folder_id: "f1" },
    ];

    const groups = groupNotesByFolder(items, FOLDERS, { rootFolderId: "f2" });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.folderId).toBe("f2");
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["own"]);
    expect(groups[0]?.children.map((child) => child.folderId)).toEqual(["f2a"]);
    // 别的夹的条目不混进来
    expect(groups[0]?.items.some((item) => item.id === "other")).toBe(false);
  });

  it("自己没有条目但有子夹 → 仍然返回一组（子夹要能点到）", () => {
    const groups = groupNotesByFolder([{ id: "child", folder_id: "f2a" }], FOLDERS, {
      rootFolderId: "f2",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toEqual([]);
    expect(groups[0]?.children[0]?.items.map((item) => item.id)).toEqual(["child"]);
  });

  it("自己与子夹都空 → 空数组（整屏走空状态）", () => {
    expect(groupNotesByFolder([], FOLDERS, { rootFolderId: "f2" })).toEqual([]);
  });

  it("传了不存在的文件夹 id → 空数组（不抛错）", () => {
    expect(groupNotesByFolder([{ id: "a", folder_id: "f1" }], FOLDERS, { rootFolderId: "nope" })).toEqual(
      [],
    );
  });
});

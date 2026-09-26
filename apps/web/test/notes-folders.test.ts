import { describe, expect, it } from "vitest";
import type { LocalFolder } from "../src/data/db";
import {
  canCreateChildFolder,
  folderDepthFor,
  folderMoveTargets,
  MAX_FOLDER_DEPTH,
} from "../src/features/notes/folders";

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

/** 学习（第 1 层，有子夹 英语）· 工作（第 1 层，空）· 英语（学习之下，第 2 层） */
const TREE = [
  folder("f1", "学习", null, 1),
  folder("f2", "英语", "f1", 2),
  folder("f3", "工作", null, 1),
];

describe("两层限制", () => {
  it("深度：根下为第 1 层，第 1 层之下为第 2 层", () => {
    expect(folderDepthFor(null)).toBe(1);
    expect(folderDepthFor({ depth: 1 })).toBe(2);
    expect(MAX_FOLDER_DEPTH).toBe(2);
  });

  it("第 2 层不能再建子文件夹（第 3 层非法）", () => {
    expect(canCreateChildFolder(null)).toBe(true);
    expect(canCreateChildFolder({ depth: 1 })).toBe(true);
    expect(canCreateChildFolder({ depth: 2 })).toBe(false);
  });
});

describe("文件夹的移动目标", () => {
  it("空文件夹可以移到另一个第 1 层文件夹下", () => {
    const targets = folderMoveTargets(TREE, "f3");
    const work = targets.find((target) => target.parentId === "f1");
    expect(work?.allowed).toBe(true);
  });

  it("已经有子文件夹的第 1 层：不能再移到别的第 1 层下面（会把子夹顶到第 3 层）", () => {
    const targets = folderMoveTargets(TREE, "f1");
    const intoWork = targets.find((target) => target.parentId === "f3");
    expect(intoWork?.allowed).toBe(false);
    expect(intoWork?.reason).toContain("超过两层");
  });

  it("不能移到自己的子文件夹里（成环）", () => {
    const targets = folderMoveTargets(
      [folder("f9", "父", null, 1), folder("fa", "子", "f9", 2)],
      "f9",
    );
    // 第 2 层不出现在候选里（移到第 2 层下就是第 3 层）；换个角度验证 f1 的场景：
    const deeper = folderMoveTargets(TREE, "f1");
    expect(deeper.some((target) => target.parentId === "f2")).toBe(false);
    expect(targets).toHaveLength(1); // 只剩根目录
  });

  it("已经在这个文件夹里：置灰并说明", () => {
    const targets = folderMoveTargets(TREE, "f2");
    const current = targets.find((target) => target.parentId === "f1");
    expect(current?.allowed).toBe(false);
    expect(current?.reason).toContain("已经在这个文件夹里");
  });

  it("第 2 层文件夹不能当父级：候选里不出现第 2 层", () => {
    const targets = folderMoveTargets(TREE, "f1");
    expect(targets.some((target) => target.parentId === "f2")).toBe(false);
  });

  it("候选里始终包含根目录；已在根目录时根目录项置灰", () => {
    const root = folderMoveTargets(TREE, "f1").find((target) => target.parentId === null);
    expect(root?.allowed).toBe(false);
    expect(root?.reason).toContain("已经在根目录");

    const fromChild = folderMoveTargets(TREE, "f2").find((target) => target.parentId === null);
    expect(fromChild?.allowed).toBe(true);
  });

  it("找不到的文件夹返回空候选", () => {
    expect(folderMoveTargets(TREE, "不存在")).toEqual([]);
  });
});

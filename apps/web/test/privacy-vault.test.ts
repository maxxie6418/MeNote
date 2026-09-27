// @vitest-environment node
/**
 * 加密空间在本地文件夹树里的位置（M3-6）。
 *
 * 最重要的一条不变量：**空间不能出现在笔记本树里**——它是导航底部的贴底节点。
 * 这条以前没人管，`ensureEncSpace` 补建之后空间行会直接混进根目录文件夹，所以这里钉死。
 */
import { describe, expect, it } from "vitest";
import {
  findVaultRoot,
  isInVault,
  isVaultRoot,
  notebookFolders,
  vaultChildFolders,
  vaultSubtree,
} from "../src/features/privacy/vault";
import type { LocalFolder } from "../src/data/db";

function folder(id: string, extra: Partial<LocalFolder> = {}): LocalFolder {
  return {
    id,
    parent_id: null,
    is_enc_space: 0,
    in_enc_space: 0,
    name: id,
    depth: 0,
    position: 0,
    meta_rev: 1,
    sync_seq: 1,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    deleted: false,
    pending: null,
    ...extra,
  };
}

const VAULT = folder("vault", { is_enc_space: 1, name: "加密空间" });
const VAULT_CHILD = folder("vc1", { parent_id: "vault", in_enc_space: 1, depth: 1 });
const VAULT_CHILD2 = folder("vc2", { parent_id: "vault", in_enc_space: 1, depth: 1 });
const NB_ROOT = folder("nb1", { name: "工作" });
const NB_CHILD = folder("nb2", { parent_id: "nb1", depth: 1 });

const ALL = [VAULT, VAULT_CHILD, VAULT_CHILD2, NB_ROOT, NB_CHILD];

describe("空间根与子树", () => {
  it("认得空间根，且只认一行", () => {
    expect(isVaultRoot(VAULT)).toBe(true);
    expect(isVaultRoot(NB_ROOT)).toBe(false);
    expect(findVaultRoot(ALL)?.id).toBe("vault");
    expect(findVaultRoot([NB_ROOT])).toBeNull();
  });

  it("子树 = 根 + 空间内子夹", () => {
    expect(vaultSubtree(ALL).map((row) => row.id)).toEqual(["vault", "vc1", "vc2"]);
  });

  it("空间内子夹只列根的直接子级（根自己不算子夹）", () => {
    expect(vaultChildFolders(ALL).map((row) => row.id)).toEqual(["vc1", "vc2"]);
  });
});

describe("笔记本树", () => {
  it("**排除整个空间子树**（这是 M3-6 的关键不变量）", () => {
    expect(notebookFolders(ALL).map((row) => row.id)).toEqual(["nb1", "nb2"]);
  });

  it("没有空间时原样返回", () => {
    expect(notebookFolders([NB_ROOT, NB_CHILD]).map((row) => row.id)).toEqual(["nb1", "nb2"]);
  });
});

describe("归属判断", () => {
  it("空间根与空间内文件夹都算「在空间里」", () => {
    expect(isInVault(ALL, "vault")).toBe(true);
    expect(isInVault(ALL, "vc1")).toBe(true);
    expect(isInVault(ALL, "nb1")).toBe(false);
  });

  it("null / undefined / 不存在的 id 一律不算", () => {
    expect(isInVault(ALL, null)).toBe(false);
    expect(isInVault(ALL, undefined)).toBe(false);
    expect(isInVault(ALL, "不存在")).toBe(false);
  });
});

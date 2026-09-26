import "fake-indexeddb/auto";
// @vitest-environment jsdom
/**
 * 冲突关联与处理（M2-9 对比 UI 的数据面）：
 * - 关联靠本地 `conflicts` 表（副本 id → 原条目 id），**不依赖标题**——改名或重名都不会指错；
 * - 打开的原条目若有副本 → hook 暴露 `conflictCopy`；
 * - 「保留我的版本」把副本内容写回原条目并清掉关联；「保留服务端版本」只清关联（副本留作普通笔记）。
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearConflict,
  createLocalNote,
  db,
  findConflictForOriginal,
  getDraft,
  listConflicts,
  recordConflict,
} from "../src/data/db";
import { useNotesWorkspace } from "../src/features/notes/useNotesWorkspace";

const ORIGINAL = "01JCX000000000000000000AA";
const COPY = "01JCX000000000000000000BB";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("冲突关联的仓储", () => {
  it("记录、按原条目查、清掉", async () => {
    await recordConflict(COPY, ORIGINAL, 100);
    expect(await listConflicts()).toHaveLength(1);

    const found = await findConflictForOriginal(ORIGINAL);
    expect(found?.copy_id).toBe(COPY);

    await clearConflict(COPY);
    expect(await findConflictForOriginal(ORIGINAL)).toBeUndefined();
  });

  it("同一原条目有多条副本时取最新的一条", async () => {
    await recordConflict("copy-old", ORIGINAL, 100);
    await recordConflict("copy-new", ORIGINAL, 200);
    expect((await findConflictForOriginal(ORIGINAL))?.copy_id).toBe("copy-new");
  });
});

describe("工作区的冲突提示与处理", () => {
  async function seedConflict() {
    await createLocalNote(ORIGINAL, "原条目", "服务端版本的正文", 1000);
    await createLocalNote(COPY, "原条目（冲突副本 09-26 12:00 · 本机）", "我的版本的正文", 1001);
    await recordConflict(COPY, ORIGINAL, 1002);
  }

  it("打开有副本的条目 → 暴露 conflictCopy（带副本标题）", async () => {
    await seedConflict();

    const { result } = renderHook(() => useNotesWorkspace());
    await act(async () => {
      await result.current.open(ORIGINAL);
    });

    await waitFor(() => expect(result.current.conflictCopy).not.toBeNull());
    expect(result.current.conflictCopy?.copyId).toBe(COPY);
    expect(result.current.conflictCopy?.copyTitle).toContain("冲突副本");
  });

  it("「保留我的版本」：副本内容写回原条目并清掉关联", async () => {
    await seedConflict();

    const { result } = renderHook(() => useNotesWorkspace());
    await act(async () => {
      await result.current.open(ORIGINAL);
    });
    await waitFor(() => expect(result.current.conflictCopy).not.toBeNull());

    await act(async () => {
      await result.current.resolveConflict("mine");
    });

    // 原条目的草稿变成了副本的内容（走草稿 + 入队，等于"这一条的新版本"）
    expect((await getDraft(ORIGINAL))?.body).toBe("我的版本的正文");
    // 关联清掉，提示消失
    expect(await findConflictForOriginal(ORIGINAL)).toBeUndefined();
    await waitFor(() => expect(result.current.conflictCopy).toBeNull());
  });

  it("「保留服务端版本」：只清关联，原条目正文不动，副本仍在", async () => {
    await seedConflict();

    const { result } = renderHook(() => useNotesWorkspace());
    await act(async () => {
      await result.current.open(ORIGINAL);
    });
    await waitFor(() => expect(result.current.conflictCopy).not.toBeNull());

    await act(async () => {
      await result.current.resolveConflict("server");
    });

    expect(await findConflictForOriginal(ORIGINAL)).toBeUndefined();
    // 原条目正文保持服务端版本（没被副本内容改写）
    expect((await getDraft(ORIGINAL))?.body).toBe("服务端版本的正文");
    // 副本作为普通笔记保留（删除要等 M4 的回收站）
    expect(await db.items.get(COPY)).toBeDefined();
  });
});

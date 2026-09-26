import "fake-indexeddb/auto";
// @vitest-environment jsdom
/**
 * 客户端批量推送（M2-9）：队首连续 ≥2 个条目操作合并成一次 `/api/batch`。
 *
 * 验的是接线：一次请求带多个操作、逐条结果正确落库（成功清队列、冲突走副本路径）、
 * 以及 API 不支持批量时退回逐条。
 */
import { BATCH_MAX_OPS, type BatchOp, type BatchResponse } from "@menote/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalNote, db, getLocalItem, listOutbox } from "../src/data/db";
import { pushQueue, type PushApi } from "../src/data/sync/push";

const ITEM_A = "01JCX000000000000000000AA";
const ITEM_B = "01JCX000000000000000000BB";

function okResult(index: number, op: BatchOp, rev: number): BatchResponse["results"][number] {
  return {
    ok: true,
    index,
    kind: op.kind,
    id: op.id,
    rev,
    bytes: 3,
    chars: 3,
  };
}

function fakeApi(batch?: PushApi["batch"]): PushApi {
  return {
    // 逐条路径也要可用：冲突副本就是单条上传的（不足 2 条不进批量）
    createItem: vi.fn(async (id: string) => ({ id, rev: 1, bytes: 3, chars: 3 })),
    saveBody: vi.fn(async (id: string, baseRev: number) => ({
      id,
      rev: baseRev + 1,
      bytes: 3,
      chars: 3,
    })),
    patchMeta: vi.fn(async (id: string) => ({ id, meta_rev: 1 })),
    createFolder: vi.fn(),
    patchFolder: vi.fn(),
    putSettings: vi.fn(),
    ...(batch ? { batch } : {}),
  } as unknown as PushApi;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("批量推送", () => {
  it("队首两个 create 合并成一次请求，逐条落库并清空队列", async () => {
    await createLocalNote(ITEM_A, "A", "A 的正文", 1000);
    await createLocalNote(ITEM_B, "B", "B 的正文", 1001);

    const batch = vi.fn(async (ops: BatchOp[]) => ({
      results: ops.map((op, index) => okResult(index, op, 1)),
    }));
    const api = fakeApi(batch);

    const result = await pushQueue({ api, now: () => 2000, deviceLabel: null });

    expect(batch).toHaveBeenCalledTimes(1);
    expect((batch.mock.calls[0]?.[0] as BatchOp[]).map((op) => op.kind)).toEqual([
      "create",
      "create",
    ]);
    expect(result).toMatchObject({ processed: 2, succeeded: 2, failed: 0, conflicted: 0 });
    expect(await listOutbox()).toHaveLength(0);
    expect((await getLocalItem(ITEM_A))?.rev).toBe(1);
    expect((await getLocalItem(ITEM_B))?.rev).toBe(1);
  });

  it("批内一条冲突不牵连另一条：冲突走副本路径，另一条照常成功", async () => {
    await createLocalNote(ITEM_A, "A", "A 的正文", 1000);
    await createLocalNote(ITEM_B, "B", "B 的正文", 1001);

    let call = 0;
    const batch = vi.fn(async (ops: BatchOp[]) => {
      call += 1;
      // 只有第一次请求的第 0 条冲突；冲突副本随后的上传是正常成功
      return {
        results: ops.map((op, index) =>
          call === 1 && index === 0
            ? {
                ok: false as const,
                index,
                kind: op.kind,
                id: op.id,
                code: "rev_conflict",
                message: "版本冲突",
                detail: { rev: 7 },
              }
            : okResult(index, op, 1),
        ),
      };
    });

    const result = await pushQueue({ api: fakeApi(batch), now: () => 2000, deviceLabel: null });

    // 冲突 1 条（本地留下副本）+ 原本另一条成功 + 副本自己也上传成功
    expect(result).toMatchObject({ succeeded: 2, conflicted: 1 });
    expect(result.processed).toBe(3);

    // 冲突那条：服务端版本被收下（标为已同步）
    expect((await getLocalItem(ITEM_A))?.rev).toBe(7);
    // 队列清空
    expect(await listOutbox()).toHaveLength(0);
  });

  it("单条操作不批量（走原来的逐条路径）", async () => {
    await createLocalNote(ITEM_A, "A", "A 的正文", 1000);

    const batch = vi.fn();
    const api = fakeApi(batch);
    (api.createItem as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: ITEM_A,
      rev: 1,
      bytes: 3,
      chars: 3,
    });

    const result = await pushQueue({ api, now: () => 2000, deviceLabel: null });

    expect(batch).not.toHaveBeenCalled();
    expect(api.createItem).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ processed: 1, succeeded: 1 });
  });

  it("超过单批上限时分多次请求（每批 ≤ BATCH_MAX_OPS）", async () => {
    for (let index = 0; index < BATCH_MAX_OPS + 2; index += 1) {
      await createLocalNote(
        `01JCX0000000000000000${String(index).padStart(4, "0")}`,
        `笔记 ${index}`,
        `正文 ${index}`,
        1000 + index,
      );
    }

    const sizes: number[] = [];
    const batch = vi.fn(async (ops: BatchOp[]) => {
      sizes.push(ops.length);
      return { results: ops.map((op, index) => okResult(index, op, 1)) };
    });

    const result = await pushQueue({ api: fakeApi(batch), now: () => 9000, deviceLabel: null });

    expect(sizes.every((size) => size <= BATCH_MAX_OPS)).toBe(true);
    expect(batch.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.succeeded).toBe(BATCH_MAX_OPS + 2);
    expect(await listOutbox()).toHaveLength(0);
  });
});

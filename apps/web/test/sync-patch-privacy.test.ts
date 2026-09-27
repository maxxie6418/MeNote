// @vitest-environment jsdom
/**
 * **隐私标记必须真的发到服务端**（2026-09-27 修的真 bug）。
 *
 * 发现经过：实现"降级改 `items.type`"时，顺手核对 `pushMetaPatch` 到底发了哪些字段——
 * 它只发 `title` / `folder_id` / `tags` / `pinned` / `starred`，**`enc_self` 与 `in_enc_space` 一个都没发**
 * （`OutboxRow` 也没有 payload 字段，补丁是推送时从**本地行**重建的）。
 *
 * 后果不是"显示不对"，而是**隐私保护失效**：
 * 在界面上切换「单篇加密」或把条目移入加密空间，只改了本地；服务端那份始终是 0；
 * 下一次同步拉回时 `applySyncItems` 把本地标记覆盖回去 → **加密标记自己消失**，
 * 而门禁在前端——标记一丢，正文就直接明文呈现。
 *
 * 本文件把"补丁里必须带这两列"钉住（回退就会红）。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemMetaPatch } from "@menote/shared";
import { db, applySyncItems } from "../src/data/db";
import { pushQueue } from "../src/data/sync/push";
import type { PushApi } from "../src/data/sync/push";

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

beforeEach(async () => {
  await db.delete();
  await db.open();
});

/** 只关心 `patchMeta` 的最小替身（其余方法不会被这条用例触发） */
function apiWithPatch(patchMeta: PushApi["patchMeta"]): PushApi {
  return {
    createItem: vi.fn(),
    saveBody: vi.fn(),
    patchMeta,
    createFolder: vi.fn(),
    patchFolder: vi.fn(),
    putSettings: vi.fn(),
  } as unknown as PushApi;
}

async function seedItemWithPatch(id: string): Promise<void> {
  // 服务端先有这一条（meta_rev = 1），客户端随后在本地改了隐私标记
  await applySyncItems([
    {
      id,
      type: "note",
      folder_id: null,
      title: "加密的笔记",
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
    } as never,
  ]);
  await db.items.update(id, { enc_self: 1, in_enc_space: 1, pending: "patch_meta" });
  await db.outbox.add({
    entity: "item",
    entity_id: id,
    op: "patch_meta",
    base_rev: 0,
    base_meta_rev: 1,
    retries: 0,
    next_retry_at: 0,
    last_error: null,
    queued_at: 0,
  });
}

describe("元数据补丁里的隐私标记", () => {
  it("`enc_self` 与 `in_enc_space` 会随补丁一起发上去", async () => {
    const patchMeta = vi.fn(async (itemId: string) => ({ id: itemId, meta_rev: 2 }));
    await seedItemWithPatch("01J00000000000000000000001");

    const result = await pushQueue({ api: apiWithPatch(patchMeta), now: () => NOW });

    expect(result.succeeded).toBe(1);
    expect(patchMeta).toHaveBeenCalledTimes(1);
    const call = patchMeta.mock.calls[0] as unknown as [string, ItemMetaPatch] | undefined;
    expect(call?.[1]).toMatchObject({ enc_self: 1, in_enc_space: 1, base_meta_rev: 1 });
  });

  it("取消加密（改回 0）同样要发上去——否则服务端会一直以为它还锁着", async () => {
    const patchMeta = vi.fn(async (itemId: string) => ({ id: itemId, meta_rev: 3 }));
    await seedItemWithPatch("01J00000000000000000000002");
    // 界面上"取消单篇加密"：本地改回 0
    await db.items.update("01J00000000000000000000002", { enc_self: 0 });

    await pushQueue({ api: apiWithPatch(patchMeta), now: () => NOW });

    const call = patchMeta.mock.calls[0] as unknown as [string, ItemMetaPatch] | undefined;
    expect(call?.[1]).toMatchObject({ enc_self: 0 });
  });
});

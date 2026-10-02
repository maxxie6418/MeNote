import "fake-indexeddb/auto";
import { DEFAULT_USER_SETTINGS, newUlid, type ItemMeta, type SyncResponse } from "@menote/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySyncItems,
  createLocalNote,
  db,
  getCachedBody,
  getSyncState,
  listLocalItems,
  putCachedBody,
  SYNC_STATE_KEY,
} from "../src/data/db";
import { createSyncEngine, type SyncStatus } from "../src/data/sync/engine";
import { pullOnce, type PullApi } from "../src/data/sync/pull";
import type { PushApi } from "../src/data/sync/push";

function serverItem(partial: Partial<ItemMeta> & { id: string }): ItemMeta {
  return {
    type: "note",
    folder_id: null,
    title: "标题",
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 1,
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
    created_at: 100,
    updated_at: 100,
    last_edit_at: null,
    last_device: null,
    deleted_at: null,
    deleted: false,
    ...partial,
  };
}

function page(partial: Partial<SyncResponse> = {}): SyncResponse {
  return {
    items: [],
    folders: [],
    tombstones: [],
    settings: { settings: DEFAULT_USER_SETTINGS, rev: 0, updated_at: 0 },
    next_cursor: 0,
    has_more: false,
    full_resync: false,
    ...partial,
  };
}

function fakePushApi(): PushApi {
  return {
    createItem: vi.fn(async (id: string) => ({ id, rev: 1, bytes: 1, chars: 1 })),
    saveBody: vi.fn(async (id: string, baseRev: number) => ({ id, rev: baseRev + 1, bytes: 1, chars: 1 })),
    patchMeta: vi.fn(async (id: string) => ({ id, meta_rev: 2 })),
    trashItem: vi.fn(async (id: string) => ({ id, meta_rev: 2, deleted_at: 1_000, folder_id: null })),
    createFolder: vi.fn(async (input: { id: string }) => ({ id: input.id, meta_rev: 1 })),
    patchFolder: vi.fn(async (id: string) => ({ id, meta_rev: 2 })),
    putSettings: vi.fn(async (input: { settings: unknown }) => ({
      settings: input.settings as never,
      rev: 1,
      updated_at: 1,
    })),
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("拉取", () => {
  it("应用条目与文件夹并推进游标", async () => {
    const first = newUlid();
    const second = newUlid();
    const api: PullApi = {
      pull: vi.fn(async () =>
        page({
          items: [serverItem({ id: first }), serverItem({ id: second })],
          folders: [
            {
              id: "f1",
              parent_id: null,
              is_enc_space: 0,
              in_enc_space: 0,
              name: "工作",
              depth: 1,
              position: 0,
              meta_rev: 1,
              sync_seq: 3,
              created_at: 1,
              updated_at: 1,
              deleted_at: null,
              deleted: false,
            },
          ],
          next_cursor: 7,
        }),
      ),
    };

    const result = await pullOnce(api, () => 5000);

    expect(result).toMatchObject({ applied: 3, cursor: 7, pages: 1, fullResync: false });
    expect((await listLocalItems()).map((row) => row.id).sort()).toEqual([first, second].sort());
    expect((await getSyncState()).cursor).toBe(7);
    expect((await getSyncState()).last_sync_at).toBe(5000);
  });

  it("has_more 时按 next_cursor 继续翻页", async () => {
    const first = newUlid();
    const second = newUlid();
    const api: PullApi = {
      pull: vi.fn(async (cursor: number) => {
        if (cursor === 0) {
          return page({ items: [serverItem({ id: first })], next_cursor: 5, has_more: true });
        }
        return page({ items: [serverItem({ id: second })], next_cursor: 9 });
      }),
    };

    const result = await pullOnce(api, () => 1000);

    expect(result).toMatchObject({ applied: 2, cursor: 9, pages: 2 });
    expect(api.pull).toHaveBeenNthCalledWith(1, 0);
    expect(api.pull).toHaveBeenNthCalledWith(2, 5);
  });

  it("full_resync：清掉已同步内容、保留未上传改动、从 0 重建", async () => {
    const synced = newUlid();
    const localOnly = newUlid();
    await applySyncItems([serverItem({ id: synced })]);
    await putCachedBody(synced, "服务端正文", 1, "h", 1000);
    await createLocalNote(localOnly, "本地新建", "还没上传", 1000);

    const fresh = newUlid();
    let calls = 0;
    const api: PullApi = {
      pull: vi.fn(async () => {
        calls += 1;
        if (calls === 1) return page({ next_cursor: 0, full_resync: true });
        return page({ items: [serverItem({ id: fresh })], next_cursor: 3 });
      }),
    };

    const result = await pullOnce(api, () => 2000);

    expect(result.fullResync).toBe(true);
    const ids = (await listLocalItems()).map((row) => row.id);
    expect(ids).toContain(localOnly); // 未上传的必须在
    expect(ids).toContain(fresh);
    expect(ids).not.toContain(synced); // 已同步的被清掉
    expect(await getCachedBody(synced)).toBeUndefined();
    expect((await getSyncState()).cursor).toBe(3);
  });

  it("重复拉取同一页不产生重复行（按 id 幂等）", async () => {
    const id = newUlid();
    const api: PullApi = { pull: vi.fn(async () => page({ items: [serverItem({ id })], next_cursor: 1 })) };

    await pullOnce(api, () => 1);
    await db.syncState.put({
      key: SYNC_STATE_KEY,
      cursor: 0,
      last_sync_at: null,
      device_id: "device",
    });
    await pullOnce(api, () => 1);

    expect(await db.items.count()).toBe(1);
  });
});

describe("引擎编排", () => {
  it("runOnce 依次推送与拉取，并上报 syncing → idle", async () => {
    const statuses: SyncStatus[] = [];
    const engine = createSyncEngine({
      api: fakePushApi(),
      pullApi: { pull: vi.fn(async () => page({ next_cursor: 0 })) },
      now: () => 1000,
      onStatus: (status) => statuses.push(status),
    });

    const result = await engine.runOnce();

    expect(result.ran).toBe(true);
    expect(result.pushed).toMatchObject({ processed: 0 });
    expect(result.pulled).toMatchObject({ cursor: 0 });
    expect(statuses).toEqual(["syncing", "idle"]);
  });

  it("离线时不发起请求，只上报 offline", async () => {
    const statuses: SyncStatus[] = [];
    const pull = vi.fn(async () => page());
    const engine = createSyncEngine({
      pullApi: { pull },
      onStatus: (status) => statuses.push(status),
    });

    const originalNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", { onLine: false });
    const result = await engine.runOnce();
    vi.stubGlobal("navigator", originalNavigator);

    expect(result).toMatchObject({ ran: false, reason: "offline" });
    expect(pull).not.toHaveBeenCalled();
    expect(statuses).toEqual(["offline"]);
  });

  it("写入成功后的触发是防抖的：连续多次只同步一次", async () => {
    vi.useFakeTimers();
    const pull = vi.fn(async () => page({ next_cursor: 1 }));
    const engine = createSyncEngine({
      api: fakePushApi(),
      pullApi: { pull },
      now: () => 1000,
    });

    engine.notifyLocalWrite();
    engine.notifyLocalWrite();
    engine.notifyLocalWrite();
    await vi.advanceTimersByTimeAsync(500);

    expect(pull).toHaveBeenCalledTimes(1);
  });

  it("同时只跑一轮：进行中再次触发直接返回 busy", async () => {
    let resolvePull: ((value: SyncResponse) => void) | undefined;
    const pull = vi.fn(
      () =>
        new Promise<SyncResponse>((resolve) => {
          resolvePull = resolve;
        }),
    );
    const engine = createSyncEngine({ api: fakePushApi(), pullApi: { pull }, now: () => 1000 });

    const first = engine.runOnce();
    const second = await engine.runOnce();
    expect(second).toMatchObject({ ran: false, reason: "busy" });

    // 推送阶段先跑（Dexie 是异步的），要等拉取真的发起后再放行，否则 promise 会一直悬着
    await vi.waitFor(() => expect(pull).toHaveBeenCalled());
    resolvePull?.(page({ next_cursor: 0 }));
    await first;
  });
});

describe("墓碑（M4-7：物理删除的传播）", () => {
  /** 造一条"本地有全套痕迹"的条目：本体 + 正文缓存 + 草稿 + 索引 + 冲突关联 */
  async function seedLocalNoteWithTraces(id: string): Promise<void> {
    await createLocalNote(id, "被删的", "正文", 100);
    await putCachedBody(id, "正文", 1, "h", 100);
    await db.searchIndex.put({
      item_id: id,
      sync_seq: 1,
      title_text: "被删的",
      title_haystack: "被删的",
      title_tokens: "",
      body_text: "正文",
      body_haystack: "正文",
      body_tokens: "",
      updated_at: 100,
      indexed_at: 100,
    });
    await db.conflicts.put({ copy_id: id, original_id: "other", created_at: 100 });
  }

  it("墓碑删除本地 items 与正文缓存", async () => {
    const id = newUlid();
    await seedLocalNoteWithTraces(id);

    const { applied } = await pullOnce({
      pull: vi.fn(async () =>
        page({
          tombstones: [{ entity: "item", entity_id: id, sync_seq: 9, deleted_at: 500 }],
          next_cursor: 9,
        }),
      ),
    });

    expect(applied).toBe(1); // 墓碑也算"落库了一行"
    expect(await db.items.get(id)).toBeUndefined();
    expect(await getCachedBody(id)).toBeUndefined();
    expect(await getSyncState()).toMatchObject({ cursor: 9 });
  });

  it("墓碑同时清 searchIndex 与 drafts", async () => {
    const id = newUlid();
    await seedLocalNoteWithTraces(id);
    expect(await db.searchIndex.get(id)).toBeDefined();
    expect(await db.drafts.get(id)).toBeDefined();

    await pullOnce({
      pull: vi.fn(async () =>
        page({
          tombstones: [{ entity: "item", entity_id: id, sync_seq: 9, deleted_at: 500 }],
          next_cursor: 9,
        }),
      ),
    });

    expect(await db.searchIndex.get(id)).toBeUndefined();
    expect(await db.drafts.get(id)).toBeUndefined();
  });

  it("墓碑清 conflicts 关联（副本指向了不存在的行会变成幽灵）", async () => {
    const id = newUlid();
    await seedLocalNoteWithTraces(id);
    expect(await db.conflicts.get(id)).toBeDefined();

    await pullOnce({
      pull: vi.fn(async () =>
        page({
          tombstones: [{ entity: "item", entity_id: id, sync_seq: 9, deleted_at: 500 }],
          next_cursor: 9,
        }),
      ),
    });

    expect(await db.conflicts.get(id)).toBeUndefined();
  });

  it("墓碑顺带清掉本地待上传的同 id 操作（否则会一直重试报 404）", async () => {
    const id = newUlid();
    await createLocalNote(id, "刚建就被别处删了", "正文", 100);
    expect(await db.outbox.count()).toBeGreaterThan(0);

    await pullOnce({
      pull: vi.fn(async () =>
        page({
          tombstones: [{ entity: "item", entity_id: id, sync_seq: 9, deleted_at: 500 }],
          next_cursor: 9,
        }),
      ),
    });

    const left = await db.outbox.filter((row) => row.entity_id === id).toArray();
    expect(left).toEqual([]);
  });

  it("文件夹墓碑删本地文件夹行", async () => {
    await db.folders.put({
      id: "f1",
      parent_id: null,
      is_enc_space: 0,
      in_enc_space: 0,
      name: "工作",
      depth: 1,
      position: 0,
      meta_rev: 1,
      sync_seq: 1,
      created_at: 1,
      updated_at: 1,
      deleted_at: null,
      deleted: false,
      pending: null,
    });

    await pullOnce({
      pull: vi.fn(async () =>
        page({
          tombstones: [{ entity: "folder", entity_id: "f1", sync_seq: 9, deleted_at: 500 }],
          next_cursor: 9,
        }),
      ),
    });

    expect(await db.folders.get("f1")).toBeUndefined();
  });

  it("未知实体的墓碑被忽略、不报错（将来加新实体时旧客户端不该崩）", async () => {
    const { applied } = await pullOnce({
      pull: vi.fn(async () =>
        page({
          // 故意绕过类型：模拟服务端将来新增的实体类型
          tombstones: [
            { entity: "attachment" as never, entity_id: "x", sync_seq: 9, deleted_at: 1 },
          ],
          next_cursor: 9,
        }),
      ),
    });

    expect(applied).toBe(1);
    expect(await getSyncState()).toMatchObject({ cursor: 9 });
  });
});

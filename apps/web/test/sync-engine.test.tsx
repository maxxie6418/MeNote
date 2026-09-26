import "fake-indexeddb/auto";
// @vitest-environment jsdom
/**
 * 引擎的跨标签页广播（M2-9）：
 * - 推送成功或拉取落库后有变化 → 广播一次（没有变化则不广播，别制造无谓刷新）；
 * - 收到别的标签页的事件 → 回调 `onRemoteChange`（本页据此刷新，**不再跑一轮同步**）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalNote, db } from "../src/data/db";
import { createSyncEngine } from "../src/data/sync/engine";
import type { PushApi } from "../src/data/sync/push";
import type { PullApi } from "../src/data/sync/pull";
import { createSyncChannel, type ChannelLike, type SyncBroadcastEvent } from "../src/data/sync/broadcast";

function fakeChannel() {
  const posted: SyncBroadcastEvent[] = [];
  let listener: ((event: { data: unknown }) => void) | null = null;
  const channel: ChannelLike = {
    postMessage: (data) => posted.push(data as SyncBroadcastEvent),
    close: () => undefined,
    addEventListener: (_type, next) => {
      listener = next;
    },
    removeEventListener: () => {
      listener = null;
    },
  };
  return {
    /** 引擎要的是高层包装（post/subscribe/close） */
    channel: createSyncChannel({ createChannel: () => channel }),
    posted,
    /** 模拟"别的标签页发来一条事件" */
    emit: (event: SyncBroadcastEvent) => listener?.({ data: event }),
    hasListener: () => listener !== null,
  };
}

function emptyPushApi(): PushApi {
  return {
    createItem: vi.fn(),
    saveBody: vi.fn(),
    patchMeta: vi.fn(),
    createFolder: vi.fn(),
    patchFolder: vi.fn(),
    putSettings: vi.fn(),
  };
}

function pullApi(applied: number, cursor = 0): PullApi {
  return {
    pull: vi.fn(async () => ({
      items: [],
      folders: [],
      settings: { settings: { start_view: "home", timezone: "UTC", editor_mode: "split", quick_menu: [] }, rev: 0, updated_at: 0 },
      next_cursor: cursor,
      has_more: false,
      full_resync: false,
    })),
  } as unknown as PullApi;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("引擎广播", () => {
  it("没有变化时不广播（避免无谓刷新）", async () => {
    const fake = fakeChannel();
    const engine = createSyncEngine({
      api: emptyPushApi(),
      pullApi: pullApi(0, 0),
      channel: fake.channel,
    });

    const result = await engine.runOnce();
    expect(result.ran).toBe(true);
    expect(fake.posted).toEqual([]);
  });

  it("推送成功后广播游标事件（别的标签页据此刷新）", async () => {
    await createLocalNote("01JCX0000000000000000000A", "标题", "正文", 1000);

    const fake = fakeChannel();
    const api = emptyPushApi();
    api.createItem = vi.fn(async (id: string) => ({ id, rev: 1, bytes: 3, chars: 3 }));

    const engine = createSyncEngine({ api, pullApi: pullApi(0, 5), channel: fake.channel });
    const result = await engine.runOnce();

    expect(result.pushed).toBeDefined();
    expect(fake.posted).toEqual([{ kind: "cursor-advanced", cursor: 5 }]);
  });

  it("收到别的标签页的事件时回调 onRemoteChange；stop 后不再收", async () => {
    const fake = fakeChannel();
    const onRemoteChange = vi.fn();
    const engine = createSyncEngine({
      api: emptyPushApi(),
      pullApi: pullApi(0, 0),
      channel: fake.channel,
      onRemoteChange,
    });

    engine.start();
    expect(fake.hasListener()).toBe(true);

    fake.emit({ kind: "item-updated", itemId: "a" });
    fake.emit({ kind: "cursor-advanced", cursor: 3 });
    expect(onRemoteChange.mock.calls).toEqual([["item-updated"], ["cursor-advanced"]]);

    engine.stop();
    expect(fake.hasListener()).toBe(false);
    fake.emit({ kind: "item-updated", itemId: "b" });
    expect(onRemoteChange).toHaveBeenCalledTimes(2);
  });
});

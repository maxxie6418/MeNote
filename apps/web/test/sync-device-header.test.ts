// @vitest-environment jsdom
/**
 * 设备标识上报（需求 §12.2-3 的"另一台设备改过"判断要用）。
 *
 * **发现经过**（"哑数据"审计）：服务端**一直**支持 `X-Menote-Device` 头并把它写进
 * `items.last_device`，但头名只在 `apps/worker/src/routes/items.ts` 里定义，
 * **客户端从没发过**——于是那一列永远是 null，"另一台设备改过"这件事无从判断
 * （M11-01 的 `session` 封存触发就卡在这里）。
 *
 * 本轮把线接上：头名提到共享包（两端同一个名字）、正文保存时带上本机 `syncState.device_id`。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ITEM_BASE_REV_HEADER,
  ITEM_DEVICE_HEADER,
  ITEM_HASH_HEADER,
} from "@menote/shared";
import { db, getSyncState } from "../src/data/db";
import { itemsApi } from "../src/data/api/endpoints";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("共享包里的头名", () => {
  it("`ITEM_DEVICE_HEADER` 就是服务端读的那个名字（两端同一份）", () => {
    expect(ITEM_DEVICE_HEADER).toBe("X-Menote-Device");
  });
});

describe("设备标识从哪来", () => {
  it("`getSyncState()` 首次调用就生成并持久化设备标识（26 位 ULID）", async () => {
    const first = await getSyncState();
    expect(first.device_id).toHaveLength(26);
    const second = await getSyncState();
    expect(second.device_id).toBe(first.device_id);
  });

  it("保存正文时**真的带上这个头**（直接看发出去的请求）", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "i1", rev: 2, bytes: 1, chars: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await itemsApi.saveBody("i1", 1, "hash-1", "正文", "device-abc");

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(calls[0]?.url).toBe("/api/items/i1/body");
    expect(headers[ITEM_DEVICE_HEADER]).toBe("device-abc");
    expect(headers[ITEM_BASE_REV_HEADER]).toBe("1");
    expect(headers[ITEM_HASH_HEADER]).toBe("hash-1");
    vi.unstubAllGlobals();
  });

  it("没给设备标识时不发这个头（保持既有请求形状）", async () => {
    const calls: Array<{ init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push({ init });
      return new Response(JSON.stringify({ id: "i1", rev: 2, bytes: 1, chars: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await itemsApi.saveBody("i1", 1, "hash-1", "正文");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers[ITEM_DEVICE_HEADER]).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

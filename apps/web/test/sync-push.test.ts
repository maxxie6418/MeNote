import "fake-indexeddb/auto";
import { newUlid, sha256Hex, type ItemMeta, type ItemWriteMeta } from "@menote/shared";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ApiError } from "../src/data/api/client";
import {
  applySyncItems,
  createLocalNote,
  db,
  enqueueBodySave,
  getCachedBody,
  getDraft,
  getLocalItem,
  headOutbox,
  listOutbox,
  saveDraft,
} from "../src/data/db";
import { FAILED_RETRY_AT, backoffDelayMs } from "../src/data/sync/backoff";
import { pushQueue, type PushApi } from "../src/data/sync/push";
import { createNoteEditor } from "../src/features/notes/model";

function serverItem(partial: Partial<ItemMeta> & { id: string }): ItemMeta {
  return {
    type: "note",
    folder_id: null,
    title: "标题",
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 1,
    content_hash: "server-hash",
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

function fakeApi(overrides: Partial<PushApi> = {}): PushApi {
  return {
    createItem: vi.fn(async (id: string, _meta: ItemWriteMeta, body: string) => ({
      id,
      rev: 1,
      bytes: new TextEncoder().encode(body).byteLength,
      chars: [...body].length,
    })),
    saveBody: vi.fn(async (id: string, baseRev: number, _hash: string, body: string) => ({
      id,
      rev: baseRev + 1,
      bytes: new TextEncoder().encode(body).byteLength,
      chars: [...body].length,
    })),
    patchMeta: vi.fn(async (id: string) => ({ id, meta_rev: 2 })),
    createFolder: vi.fn(async (input: { id: string }) => ({ id: input.id, meta_rev: 1 })),
    patchFolder: vi.fn(async (id: string) => ({ id, meta_rev: 2 })),
    putSettings: vi.fn(async (input: { settings: unknown }) => ({
      settings: input.settings as never,
      rev: 1,
      updated_at: 1,
    })),
    ...overrides,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("退避", () => {
  it("1/2/4/8… 指数增长，叠加上下抖动，封顶 60 秒", () => {
    const noJitter = (): number => 0.5;
    expect(backoffDelayMs(1, noJitter)).toBe(1_000);
    expect(backoffDelayMs(2, noJitter)).toBe(2_000);
    expect(backoffDelayMs(3, noJitter)).toBe(4_000);
    expect(backoffDelayMs(7, noJitter)).toBe(60_000);
    expect(backoffDelayMs(20, noJitter)).toBe(60_000);

    expect(backoffDelayMs(1, () => 0)).toBe(800);
    expect(backoffDelayMs(1, () => 1)).toBe(1_200);
    // 上抖动也不能越过 60 秒上限
    expect(backoffDelayMs(20, () => 1)).toBe(60_000);
  });
});

describe("推送：正文保存路径", () => {
  it("create 上传成功后出队、清 pending 与草稿、落地正文缓存", async () => {
    const id = newUlid();
    await createLocalNote(id, "标题", "正文", 1000);
    const api = fakeApi();

    const result = await pushQueue({ api, now: () => 1000, deviceLabel: "测试设备" });

    expect(result).toMatchObject({ processed: 1, succeeded: 1, conflicted: 0, failed: 0, more: false });
    expect(await listOutbox()).toEqual([]);

    const item = await getLocalItem(id);
    expect(item?.pending).toBeNull();
    expect(item?.rev).toBe(1);
    expect(await getDraft(id)).toBeUndefined();
    expect((await getCachedBody(id))?.content_hash).toBe(await sha256Hex("正文"));
    expect(api.createItem).toHaveBeenCalledTimes(1);
  });

  it("上传期间用户又改了：新内容不丢，会被紧接着再上传一次", async () => {
    const id = newUlid();
    await createLocalNote(id, "标题", "旧内容", 1000);

    const api = fakeApi({
      createItem: vi.fn(async (itemId: string, _meta: ItemWriteMeta, body: string) => {
        // 模拟"上传途中用户又敲了字"：草稿在这期间被改写
        await saveDraft(itemId, `${body} + 新字`, 1500);
        return { id: itemId, rev: 1, bytes: 3, chars: 2 };
      }),
    });

    const result = await pushQueue({ api, now: () => 2000 });

    // 第一轮 create、第二轮 save_body：新内容确实被上传，而不是停在草稿里
    expect(result).toMatchObject({ processed: 2, succeeded: 2, failed: 0 });
    expect(api.saveBody).toHaveBeenCalledWith(id, 1, await sha256Hex("旧内容 + 新字"), "旧内容 + 新字");
    expect(await getDraft(id)).toBeUndefined();
    expect(await listOutbox()).toEqual([]);
  });

  it("save_body 用队列里的基版本上传，成功后推进本地 rev", async () => {
    const id = newUlid();
    await applySyncItems([serverItem({ id, rev: 3, content_hash: "old" })]);
    await saveDraft(id, "改过的正文", 2000);
    await enqueueBodySave(id, 3, 2000);

    const api = fakeApi();
    const result = await pushQueue({ api, now: () => 3000 });

    expect(result.succeeded).toBe(1);
    expect(api.saveBody).toHaveBeenCalledWith(id, 3, await sha256Hex("改过的正文"), "改过的正文");
    const item = await getLocalItem(id);
    expect(item?.rev).toBe(4);
    expect(item?.pending).toBeNull();
    expect(await listOutbox()).toEqual([]);
  });

  it("网络错误：退避重试且不出队，到点后可再次被选中", async () => {
    const id = newUlid();
    await createLocalNote(id, "标题", "正文", 1000);

    const api = fakeApi({
      createItem: vi.fn(async () => {
        throw new ApiError("retry_later", "无法连接服务器", 0);
      }),
    });

    const result = await pushQueue({ api, now: () => 10_000, random: () => 0.5 });

    expect(result).toMatchObject({ processed: 1, succeeded: 0, failed: 1 });
    const [row] = await listOutbox();
    expect(row?.retries).toBe(1);
    expect(row?.next_retry_at).toBe(11_000);
    expect(row?.last_error).toContain("无法连接");

    expect(await headOutbox(10_500)).toBeUndefined();
    expect((await headOutbox(11_000))?.seq).toBe(row?.seq);
  });

  it("422 这类不可重试的错误移入失败列表：不阻塞后续项", async () => {
    const blocked = newUlid();
    const healthy = newUlid();
    await createLocalNote(blocked, "坏条目", "x", 1000);
    await createLocalNote(healthy, "好条目", "y", 1000);

    const api = fakeApi({
      createItem: vi.fn(async (itemId: string, _meta: ItemWriteMeta, body: string) => {
        if (itemId === blocked) throw new ApiError("invalid", "请求内容不合法", 422);
        return { id: itemId, rev: 1, bytes: body.length, chars: body.length };
      }),
    });

    const result = await pushQueue({ api, now: () => 1000 });

    expect(result).toMatchObject({ processed: 2, succeeded: 1, failed: 1 });
    const rows = await listOutbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entity_id).toBe(blocked);
    expect(rows[0]?.last_error).toContain("不合法");
    expect(rows[0]?.next_retry_at).toBe(FAILED_RETRY_AT);
    // 队首不会再选中它（真实时间远小于哨兵值）
    expect(await headOutbox(2_000_000_000_000)).toBeUndefined();

    const synced = await getLocalItem(healthy);
    expect(synced?.pending).toBeNull();
  });
});

describe("推送：冲突处理", () => {
  it("409 且哈希与本地一致 → 视为上次已成功（不离队、生成副本）", async () => {
    const id = newUlid();
    const body = "我的正文";
    const hash = await sha256Hex(body);
    await applySyncItems([serverItem({ id, rev: 3, content_hash: "old" })]);
    await saveDraft(id, body, 2000);
    await enqueueBodySave(id, 3, 2000);

    const api = fakeApi({
      saveBody: vi.fn(async () => {
        throw new ApiError("rev_conflict", "版本冲突", 409, { rev: 5, content_hash: hash });
      }),
    });

    const result = await pushQueue({ api, now: () => 3000 });

    expect(result).toMatchObject({ conflicted: 0, succeeded: 1, failed: 0 });
    expect(await listOutbox()).toEqual([]);
    const items = await db.items.toArray();
    expect(items).toHaveLength(1);
    expect(items[0]?.rev).toBe(5);
    expect(items[0]?.pending).toBeNull();
    expect(await getDraft(id)).toBeUndefined();
  });

  it("409 且内容不同 → 本地内容另存冲突副本，原条目采纳服务端版本", async () => {
    const id = newUlid();
    await applySyncItems([serverItem({ id, title: "原标题", rev: 3, content_hash: "server-old" })]);
    await saveDraft(id, "我的版本", 2000);
    await enqueueBodySave(id, 3, 2000);

    const api = fakeApi({
      saveBody: vi.fn(async () => {
        throw new ApiError("rev_conflict", "版本冲突", 409, {
          rev: 5,
          content_hash: "server-new",
        });
      }),
    });

    // 副本自己也会被排队上传，跑完一整轮后：原条目采纳服务端版本，副本上传成功
    const result = await pushQueue({ api, now: () => 1_700_000_000_000, deviceLabel: "手机" });

    expect(result).toMatchObject({ processed: 2, conflicted: 1, failed: 0 });
    expect(await listOutbox()).toEqual([]);

    const items = await db.items.toArray();
    const original = items.find((row) => row.id === id);
    expect(original?.rev).toBe(5);
    expect(original?.content_hash).toBe("server-new");
    expect(original?.pending).toBeNull();

    const copy = items.find((row) => row.id !== id);
    expect(copy?.title).toContain("原标题（冲突副本");
    expect(copy?.title).toContain("手机");

    const createCalls = (api.createItem as Mock).mock.calls;
    const copyCall = createCalls.find((args) =>
      String((args[1] as ItemWriteMeta).title).includes("冲突副本"),
    );
    expect(copyCall?.[2]).toBe("我的版本");
  });

  it("打字 → tick → 推送成功后队列清空、草稿清掉、状态回到已同步", async () => {
    const id = newUlid();
    await applySyncItems([serverItem({ id, rev: 3, content_hash: "old" })]);

    const editor = createNoteEditor({ itemId: id, now: () => 1000 });
    await editor.load();

    editor.onInput("新内容");
    await editor.tick(3500); // 写草稿 + 入队（模拟 2 秒空闲）

    expect((await listOutbox()).map((row) => row.op)).toEqual(["save_body"]);

    await pushQueue({ api: fakeApi(), now: () => 4000 });
    await editor.refreshState(); // 同步引擎跑完一轮后问状态

    expect(await listOutbox()).toEqual([]);
    expect(await getDraft(id)).toBeUndefined();
    expect(editor.getSnapshot().saveState).toBe("synced");
  });

  it("推送成功后本地 rev 与哈希跟着更新（否则下一轮会用过期基版本）", async () => {
    const id = newUlid();
    await applySyncItems([serverItem({ id, rev: 3, content_hash: "old" })]);
    const editor = createNoteEditor({ itemId: id, now: () => 1000 });
    await editor.load();
    editor.onInput("第二版正文");
    await editor.tick(3500);
    await pushQueue({ api: fakeApi(), now: () => 4000 });

    const item = await getLocalItem(id);
    expect(item?.rev).toBe(4);
    expect(item?.content_hash).toBe(await sha256Hex("第二版正文"));
    expect(item?.pending).toBeNull();
  });

  it("推送一轮 + refreshState 之后再 tick 不应再排队（否则会每 2 秒无限重传）", async () => {
    const id = newUlid();
    await applySyncItems([serverItem({ id, rev: 3, content_hash: "old" })]);

    const api = fakeApi();
    const editor = createNoteEditor({ itemId: id, now: () => 1000 });
    await editor.load();

    editor.onInput("只该上传一次的内容");
    await editor.tick(3500); // 写草稿 + 入队

    await pushQueue({ api, now: () => 4000 }); // 推送成功
    await editor.refreshState(); // 引擎跑完一轮后问状态

    expect(await listOutbox()).toEqual([]);
    expect(editor.getSnapshot().saveState).toBe("synced");

    // 再来几轮 tick（模拟不断到来的 2 秒节奏）：不该再产生任何队列项
    await editor.tick(6000);
    await editor.tick(8000);
    await editor.refreshState();

    expect(await listOutbox()).toEqual([]);
    expect(api.saveBody).toHaveBeenCalledTimes(1);
    expect(editor.getSnapshot().saveState).toBe("synced");
  });

  it("只靠 tick 自愈：推送成功后不再重传（不依赖引擎回调，M1-11 无限重传的回归）", async () => {
    const id = newUlid();
    await applySyncItems([serverItem({ id, rev: 3, content_hash: "old" })]);
    const api = fakeApi();
    const editor = createNoteEditor({ itemId: id, now: () => 1000 });
    await editor.load();

    editor.onInput("只该上传一次的内容");
    await editor.tick(3500);
    await pushQueue({ api, now: () => 4000 });

    // 关键：**不调用** refreshState，只让 tick 自己跑（真实浏览器里引擎回调可能静默失败）
    await editor.tick(6000);
    expect(editor.getSnapshot().saveState).toBe("synced");
    expect(await listOutbox()).toEqual([]);

    await editor.tick(8000);
    await editor.tick(10000);

    expect(api.saveBody).toHaveBeenCalledTimes(1); // 没有重传
    expect(await listOutbox()).toEqual([]);
    expect(editor.getSnapshot().saveState).toBe("synced");
  });

  it("meta_conflict 不生成副本：服务端版本胜出、条目出队", async () => {
    const id = newUlid();
    await applySyncItems([serverItem({ id, rev: 1, meta_rev: 1 })]);
    await db.items.update(id, { pending: "patch_meta" });
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

    const api = fakeApi({
      patchMeta: vi.fn(async () => {
        throw new ApiError("meta_conflict", "条目已在其他设备更新", 409, { meta_rev: 4 });
      }),
    });

    const result = await pushQueue({ api, now: () => 1000 });

    expect(result).toMatchObject({ conflicted: 1, failed: 0 });
    const items = await db.items.toArray();
    expect(items).toHaveLength(1);
    expect(items[0]?.pending).toBeNull();
    expect(items[0]?.meta_rev).toBe(4);
    expect(await listOutbox()).toEqual([]);
  });
});

import "fake-indexeddb/auto";
import { newUlid, type ItemMeta } from "@menote/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applySyncFolders,
  applySyncItems,
  countUnfinishedAttachments,
  createLocalNote,
  db,
  enqueueBodySave,
  findAttachment,
  getCachedBody,
  getEditableBody,
  getSyncState,
  headOutbox,
  listItemAttachments,
  listLocalFolders,
  listLocalItems,
  listOutbox,
  listUnfinishedAttachments,
  markAttachmentFailed,
  markAttachmentUploaded,
  markItemSynced,
  markOutboxFailure,
  putAttachmentMeta,
  putCachedBody,
  removeAttachmentMeta,
  removeItemAttachments,
  saveDraft,
  setSyncCursor,
  type LocalAttachment,
} from "../src/data/db";

function serverItem(partial: Partial<ItemMeta> & { id: string }): ItemMeta {
  return {
    type: "note",
    folder_id: null,
    title: "标题",
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 1,
    content_hash: "h-public",
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

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("本地新建与草稿", () => {
  it("本地新建笔记同时写 items / bodies / drafts，并入队一条 create", async () => {
    const id = newUlid();
    const item = await createLocalNote(id, "未命名笔记", "正文", 1000);

    expect(item.pending).toBe("create");
    expect((await listLocalItems()).map((row) => row.id)).toEqual([id]);

    const editable = await getEditableBody(id);
    expect(editable).toEqual({ body: "正文", fromDraft: true });

    const outbox = await listOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ op: "create", entity_id: id, base_rev: 0, retries: 0 });
  });

  it("本地草稿可按 2 秒节奏反复覆盖，且不产生 outbox 行", async () => {
    const id = newUlid();
    await createLocalNote(id, "标题", "v1", 1000);

    await saveDraft(id, "v2", 2000);
    await saveDraft(id, "v3", 3000);

    expect((await getEditableBody(id)).body).toBe("v3");
    expect(await listOutbox()).toHaveLength(1);
  });
});

describe("入站：拉取结果落库", () => {
  it("保留本地 pending，且不覆盖本地草稿", async () => {
    const id = newUlid();
    await createLocalNote(id, "本地标题", "本地正文", 1000);

    await applySyncItems([serverItem({ id, title: "服务端标题", updated_at: 2000 })]);

    const [row] = await listLocalItems();
    expect(row?.pending).toBe("create");
    expect(row?.title).toBe("服务端标题");
    expect((await getEditableBody(id)).body).toBe("本地正文");
  });

  it("无待上传改动且哈希变化时正文缓存失效；哈希相同则保留", async () => {
    const sameHashId = newUlid();
    const changedId = newUlid();
    await applySyncItems([
      serverItem({ id: sameHashId, content_hash: "same" }),
      serverItem({ id: changedId, content_hash: "old" }),
    ]);
    await putCachedBody(sameHashId, "缓存", 1, "same", 1000);
    await putCachedBody(changedId, "缓存", 1, "old", 1000);

    await applySyncItems([
      serverItem({ id: sameHashId, content_hash: "same", updated_at: 2000 }),
      serverItem({ id: changedId, content_hash: "new", updated_at: 2000 }),
    ]);

    expect(await getCachedBody(sameHashId)).toBeDefined();
    expect(await getCachedBody(changedId)).toBeUndefined();
  });

  it("有待上传改动时不失效正文缓存（否则会冲掉未上传的编辑）", async () => {
    const id = newUlid();
    await createLocalNote(id, "标题", "本地正文", 1000);
    await applySyncItems([serverItem({ id, content_hash: "server-new" })]);

    expect(await getCachedBody(id)).toBeDefined();
    expect((await getEditableBody(id)).body).toBe("本地正文");
  });

  it("软删的条目不出现在列表里，但仍落库（还有待上传改动时要能恢复）", async () => {
    const id = newUlid();
    await applySyncItems([serverItem({ id, deleted_at: 5000, deleted: true })]);

    expect(await listLocalItems()).toEqual([]);
    expect((await db.items.get(id))?.deleted_at).toBe(5000);
  });

  it("文件夹落库并保留 pending", async () => {
    await applySyncFolders([
      {
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
      },
    ]);

    const folders = await listLocalFolders();
    expect(folders.map((folder) => folder.name)).toEqual(["工作"]);
    expect(folders[0]?.pending).toBeNull();
  });
});

describe("outbox 合并规则", () => {
  it("该条目还没上传过（队列里有 create）时，正文保存不再排新行", async () => {
    const id = newUlid();
    await createLocalNote(id, "标题", "v1", 1000);

    await enqueueBodySave(id, 0, 1500);

    const outbox = await listOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.op).toBe("create");
    expect((await db.items.get(id))?.pending).toBe("create");
  });

  it("已有 save_body 时复用该行并保留最早的 base_rev", async () => {
    const id = newUlid();
    await applySyncItems([serverItem({ id, rev: 3 })]);

    await enqueueBodySave(id, 3, 1000);
    await enqueueBodySave(id, 4, 2000);
    await enqueueBodySave(id, 5, 3000);

    const outbox = await listOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.base_rev).toBe(3);
    expect((await db.items.get(id))?.pending).toBe("save_body");
  });

  it("失败次数与下次重试时间可记录，队首只看已到时间的行", async () => {
    const id = newUlid();
    await createLocalNote(id, "标题", "正文", 1000);
    const seq = (await listOutbox())[0]?.seq;
    expect(seq).toBeDefined();

    expect((await headOutbox(1500))?.seq).toBe(seq);
    await markOutboxFailure(seq as number, "网络错误", 3000);

    expect(await headOutbox(2000)).toBeUndefined();
    expect((await headOutbox(3000))?.retries).toBe(1);
  });
});

describe("同步状态与结清", () => {
  it("首次生成设备标识并持久化；游标可推进", async () => {
    const first = await getSyncState();
    expect(first.cursor).toBe(0);
    expect(first.device_id).toHaveLength(26);

    await setSyncCursor(42, 9999);
    const second = await getSyncState();
    expect(second.cursor).toBe(42);
    expect(second.last_sync_at).toBe(9999);
    expect(second.device_id).toBe(first.device_id);
  });

  it("上传成功后清 pending 并更新 rev", async () => {
    const id = newUlid();
    await createLocalNote(id, "标题", "正文", 1000);

    await markItemSynced(id, { rev: 1, content_hash: "server-hash", sync_seq: 7 });

    const row = await db.items.get(id);
    expect(row?.pending).toBeNull();
    expect(row?.rev).toBe(1);
    expect(row?.sync_seq).toBe(7);
  });
});

describe("附件元数据（M4-10 / Dexie v7）", () => {
  const meta = (overrides: Partial<LocalAttachment> = {}): LocalAttachment => ({
    attachment_id: "att-1",
    item_id: "item-1",
    sha256: "a".repeat(64),
    filename: "照片.png",
    mime: "image/png",
    size_bytes: 2048,
    width: 1200,
    height: 800,
    has_thumb: true,
    status: "pending",
    error: null,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  });

  it("升级到 v7 后新增 attachmentsMeta 表，既有表仍在", async () => {
    // `beforeEach` 已经 open 过：库版本就是 schema 里声明的最高版本
    expect(db.verno).toBe(7);
    expect(db.tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(["items", "bodies", "folders", "outbox", "privacyState", "attachmentsMeta"]),
    );
  });

  it("落一行、按条目查得回来；同条目同哈希能反查到", async () => {
    await putAttachmentMeta(meta());
    await putAttachmentMeta(meta({ attachment_id: "att-2", sha256: "b".repeat(64), status: "uploaded" }));

    const forItem = await listItemAttachments("item-1");
    expect(forItem).toHaveLength(2);

    const found = await findAttachment("item-1", "a".repeat(64));
    expect(found?.attachment_id).toBe("att-1");
    expect(await findAttachment("item-2", "a".repeat(64))).toBeUndefined();
  });

  it("上传成功后状态转 uploaded；失败带原因（都进未完成清单）", async () => {
    await putAttachmentMeta(meta({ attachment_id: "att-1" }));
    await putAttachmentMeta(meta({ attachment_id: "att-2" }));
    await putAttachmentMeta(meta({ attachment_id: "att-3", status: "uploaded" }));

    // 初始：两条待上传
    expect(await countUnfinishedAttachments()).toBe(2);

    await markAttachmentUploaded("att-1", 2000);
    expect(await countUnfinishedAttachments()).toBe(1);

    await markAttachmentFailed("att-2", "网络断了", 3000);
    const unfinished = await listUnfinishedAttachments();
    expect(unfinished.map((row) => row.attachment_id)).toEqual(["att-2"]);
    expect(unfinished[0]?.error).toBe("网络断了");

    // 失败后再传成功 → 不再是未完成项
    await markAttachmentUploaded("att-2", 4000);
    expect(await countUnfinishedAttachments()).toBe(0);
  });

  it("移除引用清本地行；条目被删时连带清掉它的附件行", async () => {
    await putAttachmentMeta(meta({ attachment_id: "att-1" }));
    await putAttachmentMeta(meta({ attachment_id: "att-2" }));

    await removeAttachmentMeta("att-1");
    expect(await listItemAttachments("item-1")).toHaveLength(1);

    const removed = await removeItemAttachments("item-1");
    expect(removed).toBe(1);
    expect(await listItemAttachments("item-1")).toEqual([]);
  });
});

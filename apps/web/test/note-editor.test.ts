import "fake-indexeddb/auto";
import { BODY_HARD_LIMIT_BYTES, newUlid, type ItemMeta } from "@menote/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySyncItems, createLocalNote, db, getDraft, listOutbox } from "../src/data/db";
import { createNoteEditor } from "../src/features/notes/model";

function serverItem(id: string, rev: number): ItemMeta {
  return {
    id,
    type: "note",
    folder_id: null,
    title: "标题",
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 4,
    content_hash: "server-hash",
    tags: [],
    memo_at: null,
    is_task: 0,
    task_status: null,
    task_due: null,
    task_priority: null,
    pinned: 0,
    starred: 0,
    rev,
    meta_rev: 1,
    sealed_rev: null,
    sync_seq: 1,
    created_at: 100,
    updated_at: 100,
    last_edit_at: null,
    last_device: null,
    deleted_at: null,
    deleted: false,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("编辑器自动保存控制器", () => {
  it("load 优先读未上传草稿，并按 pending 给出初始状态", async () => {
    const id = newUlid();
    await createLocalNote(id, "标题", "初始化正文", 1000);

    const editor = createNoteEditor({ itemId: id, now: () => 1000 });
    const text = await editor.load();

    expect(text).toBe("初始化正文");
    expect(editor.getSnapshot().saveState).toBe("pending");
  });

  it("本地新建条目：编辑合并进那条 create，不额外排队；tick 恒写草稿", async () => {
    const id = newUlid();
    await createLocalNote(id, "标题", "旧", 1000);
    const notifySync = vi.fn();
    const snaps: string[] = [];
    const editor = createNoteEditor({
      itemId: id,
      now: () => 1000,
      notifySync,
      onSnapshot: (snapshot) => snaps.push(snapshot.saveState),
    });
    await editor.load();

    editor.onInput("新内容");
    expect(editor.getSnapshot().saveState).toBe("pending");

    // 第 1 次 tick：有改动就写草稿，但还没到 2 秒空闲
    await editor.tick(1500);
    expect((await getDraft(id))?.body).toBe("新内容");
    expect(notifySync).not.toHaveBeenCalled();

    // 到 2 秒空闲：触发同步（正文随那条尚未上传的 create 一起走，合并规则不新增行）
    await editor.tick(3500);
    expect(notifySync).toHaveBeenCalledTimes(1);
    expect((await listOutbox()).map((row) => row.op)).toEqual(["create"]);
    expect(snaps).toContain("pending");
  });

  it("已同步条目：编辑在空闲阈值后新增一条 save_body", async () => {
    const id = newUlid();
    await applySyncItems([serverItem(id, 3)]);
    const notifySync = vi.fn();
    const editor = createNoteEditor({ itemId: id, now: () => 1000, notifySync });
    await editor.load();
    expect(editor.getSnapshot().saveState).toBe("synced");

    editor.onInput("改了内容");

    await editor.tick(1500);
    expect(await listOutbox()).toHaveLength(0); // 还没到空闲阈值
    expect(notifySync).not.toHaveBeenCalled();

    await editor.tick(3500);
    const rows = await listOutbox();
    expect(rows.map((row) => row.op)).toEqual(["save_body"]);
    expect(rows[0]?.base_rev).toBe(3); // 用本地的当前版本作为基版本
    expect(notifySync).toHaveBeenCalledTimes(1);
  });

  it("达到硬上限：草稿继续写、不入队，状态为 blocked", async () => {
    const id = newUlid();
    await createLocalNote(id, "标题", "旧", 1000);
    const notifySync = vi.fn();
    const editor = createNoteEditor({ itemId: id, now: () => 1000, notifySync });
    await editor.load();

    editor.onInput("a".repeat(BODY_HARD_LIMIT_BYTES));
    expect(editor.getSnapshot().saveState).toBe("blocked");
    expect(editor.getSnapshot().sizeLevel).toBe("hard");

    await editor.tick(60_000);

    expect((await getDraft(id))?.body).toHaveLength(BODY_HARD_LIMIT_BYTES);
    expect((await listOutbox()).map((row) => row.op)).toEqual(["create"]);
    expect(notifySync).not.toHaveBeenCalled();
  });

  it("flush 立即落盘并入队；已同步后再无改动则不重复入队", async () => {
    const id = newUlid();
    await applySyncItems([serverItem(id, 3)]);
    const notifySync = vi.fn();
    const editor = createNoteEditor({ itemId: id, now: () => 1000, notifySync });
    await editor.load();

    editor.onInput("改了点东西");
    await editor.flush(1200);

    expect((await getDraft(id))?.body).toBe("改了点东西");
    expect((await listOutbox()).map((row) => row.op)).toEqual(["save_body"]);
    expect(notifySync).toHaveBeenCalledTimes(1);

    editor.notifyUploaded();
    expect(editor.getSnapshot().saveState).toBe("synced");

    await editor.flush(9999);
    expect(notifySync).toHaveBeenCalledTimes(1);
  });

  it("refreshState 不会把还没落盘的内容误判成已同步（M1-11 实测踩到的坑）", async () => {
    const id = newUlid();
    await applySyncItems([serverItem(id, 3)]);
    const editor = createNoteEditor({ itemId: id, now: () => 1000 });
    await editor.load();
    expect(editor.getSnapshot().saveState).toBe("synced");

    editor.onInput("刚敲的内容");
    // 模拟"同步引擎刚跑完一轮来问状态"——此时草稿（2 秒节奏）还没写
    await editor.refreshState();

    expect(editor.getSnapshot().saveState).toBe("pending"); // 绝不能是 synced
    expect((await getDraft(id))?.body).toBe("刚敲的内容"); // 内存内容已落盘，不会丢
  });

  it("失败与冲突会反映到状态栏状态上", async () => {    const id = newUlid();
    await createLocalNote(id, "标题", "旧", 1000);
    const editor = createNoteEditor({ itemId: id, now: () => 1000 });
    await editor.load();

    editor.notifyFailed();
    expect(editor.getSnapshot().saveState).toBe("failed");
    editor.notifyConflict();
    expect(editor.getSnapshot().saveState).toBe("conflict");
  });
});

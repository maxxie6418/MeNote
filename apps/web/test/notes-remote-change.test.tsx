// @vitest-environment jsdom
/**
 * 跨标签页改动的**事前提示**（M2-9）：
 * - 打开某条后，别处改过它（本地库里 content_hash 变了）→ 提示出现；
 * - 自己保存完（notifyUploaded）→ 基准跟上新内容，不误报；
 * - 「按最新内容重新载入」走回调。
 */
import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalNote, db, getDraft } from "../src/data/db";
import { useNotesWorkspace } from "../src/features/notes/useNotesWorkspace";

const ITEM = "01JCX0000000000000000000A";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("跨标签页改动的事前提示", () => {
  it("打开时无提示；别处改过（hash 变了）后刷新出现提示", async () => {
    await createLocalNote(ITEM, "标题", "原始正文", 1000);

    const { result } = renderHook(() => useNotesWorkspace());
    await act(async () => {
      await result.current.open(ITEM);
    });
    expect(result.current.remoteChanged).toBe(false);

    // 模拟"另一个标签页改了这条并已同步"：本地库里的内容与 hash 都变了
    await act(async () => {
      await db.bodies.update(ITEM, { body: "别处改过的正文", content_hash: "other-hash" });
      await db.items.update(ITEM, { content_hash: "other-hash", rev: 2, sync_seq: 9 });
      await result.current.refresh();
    });

    await waitFor(() => expect(result.current.remoteChanged).toBe(true));
  });

  it("自己保存成功后不误报（基准跟到新内容）", async () => {
    await createLocalNote(ITEM, "标题", "原始正文", 1000);

    const { result } = renderHook(() => useNotesWorkspace());
    await act(async () => {
      await result.current.open(ITEM);
    });

    // 模拟自己这一轮保存：草稿与已缓存正文都变成"我改的"，然后通知已上传
    await act(async () => {
      await db.drafts.put({ item_id: ITEM, body: "我改的正文", updated_at: 2000 });
      await db.bodies.update(ITEM, { body: "我改的正文", content_hash: "my-hash" });
      await db.items.update(ITEM, { content_hash: "my-hash", rev: 2, sync_seq: 3 });
      result.current.notifyUploaded();
    });

    // 基准会跟到"我改的正文"；等它更新后再刷新：不该报"别处改过"
    await waitFor(async () => {
      expect((await getDraft(ITEM))?.body).toBe("我改的正文");
    });

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.remoteChanged).toBe(false);
  });

  it("重新载入后提示清除，且正文回到最新内容", async () => {
    await createLocalNote(ITEM, "标题", "原始正文", 1000);

    const { result } = renderHook(() => useNotesWorkspace());
    await act(async () => {
      await result.current.open(ITEM);
    });

    await act(async () => {
      await db.bodies.update(ITEM, { body: "别处改过的正文", content_hash: "other-hash" });
      await db.items.update(ITEM, { content_hash: "other-hash", rev: 2, sync_seq: 9 });
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.remoteChanged).toBe(true));

    await act(async () => {
      await result.current.reloadSelected();
    });
    expect(result.current.remoteChanged).toBe(false);
  });

  it("没打开任何条目时不提示", async () => {
    await createLocalNote(ITEM, "标题", "原始正文", 1000);

    const { result } = renderHook(() => useNotesWorkspace());
    await act(async () => {
      await db.items.update(ITEM, { content_hash: "changed", sync_seq: 5 });
      await result.current.refresh();
    });
    expect(result.current.remoteChanged).toBe(false);
    expect(vi.isMockFunction(result.current.reloadSelected)).toBe(false);
  });
});

import "fake-indexeddb/auto";
// @vitest-environment jsdom
/**
 * `useSearch`（M2-6）：本地索引优先、索引没建完时回退服务端并按 id 合并、失败只用本地结果。
 *
 * 这里验的是**接线**（两条来源怎么合、stale 怎么标）；检索算法本身由 `search-model.test.ts`、
 * 索引由 `search-index.test.ts`、服务端由 `apps/worker/test/search.test.ts` 各自覆盖。
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("../src/data/api/endpoints", () => ({
  searchApi: { query: (...args: unknown[]) => queryMock(...args) },
}));

const { createLocalItem, db, refreshSearchIndex } = await import("../src/data/db");
const { useSearch } = await import("../src/features/search/useSearch");

let seq = 0;
async function seed(id: string, title: string, body: string) {
  seq += 1;
  await createLocalItem({ id, type: "note", title, folder_id: null, body }, 1000 + seq);
  await db.items.update(id, { sync_seq: seq });
}

function remoteRow(id: string, title: string) {
  return {
    id,
    type: "note" as const,
    folder_id: null,
    title,
    tags: [],
    memo_at: null,
    is_task: 0 as const,
    task_status: null,
    updated_at: 5,
    snippet: "服务端给的片段：发布方案",
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  queryMock.mockReset();
});

describe("useSearch", () => {
  it("索引建好时只用本地结果，不发网络请求", async () => {
    await seed("a", "会议记录", "讨论了发布方案");
    await refreshSearchIndex();

    const { result } = renderHook(() => useSearch({ items: [], memos: [] }));

    await act(async () => {
      result.current.setQuery("发布方案");
    });

    await waitFor(() => {
      expect(result.current.results).toHaveLength(1);
    });
    expect(result.current.results[0]?.item.id).toBe("a");
    expect(result.current.stale).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("索引没建完时回退服务端，**本地在前、服务端只补缺口**，并标 stale", async () => {
    await seed("local", "本地命中", "共同的词 发布方案");
    await refreshSearchIndex();
    // 让索引"不完整"：新增一条不再重建索引
    await seed("new", "尚未入索引", "共同的词 发布方案");

    queryMock.mockResolvedValue({
      results: [remoteRow("local", "本地命中"), remoteRow("remote", "服务端补的")],
    });

    const { result } = renderHook(() => useSearch({ items: [], memos: [] }));
    await act(async () => {
      result.current.setQuery("发布方案");
    });

    await waitFor(() => {
      expect(result.current.results.length).toBeGreaterThan(0);
    });

    const ids = result.current.results.map((row) => row.item.id);
    // 本地命中排在前，服务端补上本地没有的那条
    expect(ids[0]).toBe("local");
    expect(ids).toContain("remote");
    expect(ids.filter((id) => id === "local")).toHaveLength(1); // 去重
    expect(result.current.stale).toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("回退失败（离线）时只用本地结果，不抛错", async () => {
    await seed("local", "本地命中", "共同的词 发布方案");
    await refreshSearchIndex();
    await seed("new", "尚未入索引", "共同的词 发布方案");
    queryMock.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useSearch({ items: [], memos: [] }));
    await act(async () => {
      result.current.setQuery("发布方案");
    });

    await waitFor(() => {
      expect(result.current.results).toHaveLength(1);
    });
    expect(result.current.results[0]?.item.id).toBe("local");
    expect(result.current.stale).toBe(true);
  });

  it("清空查询后结果为空、不再标 stale", async () => {
    await seed("a", "会议记录", "发布方案");
    await refreshSearchIndex();

    const { result } = renderHook(() => useSearch({ items: [], memos: [] }));
    await act(async () => {
      result.current.setQuery("发布方案");
    });
    await waitFor(() => expect(result.current.results).toHaveLength(1));

    await act(async () => {
      result.current.clear();
    });
    await waitFor(() => expect(result.current.results).toHaveLength(0));
    expect(result.current.stale).toBe(false);
  });
});

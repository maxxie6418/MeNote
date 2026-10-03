import "fake-indexeddb/auto";
/**
 * 推送时携带附件引用集合（M6 第一批 · 批 2a）。
 *
 * 客户端只负责**把正文里引用的 sha 如实报上去**——服务端在保存正文的**同一次写**里对齐
 * `attachment_refs`。拆成两次请求会留下「正文已存、引用未跟上」的窗口：那张仍在正文里
 * 显示的图会被当孤儿，30 天后由每日维护真删掉 R2 对象。
 *
 * 两条路径都要覆盖，缺一不可：
 * - **单条** `saveBody`（直连时的推送）
 * - **批量** `save_body` op（**离线主路径**——本应用离线优先，正文大多经 `POST /api/batch`
 *   落库；只改直连端点等于「正常时对齐、断网重连后不对齐」，而后者恰是引用最容易漂的场合）
 *
 * 单列一个文件的原因与 worker 侧同理：`sync-push.test.ts` 已贴着 500 行的 ESLint 预算
 * （架构 §2.3.3）。
 */
import { newUlid, type BatchOp, type ItemMeta, type ItemWriteMeta } from "@menote/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, applySyncItems, enqueueBodySave, saveDraft } from "../src/data/db";
import { pushQueue, type PushApi } from "../src/data/sync/push";

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
    trashItem: vi.fn(async (id: string) => ({ id, meta_rev: 2, deleted_at: 1_000, folder_id: null })),
    createFolder: vi.fn(async (input: { id: string }) => ({ id: input.id, meta_rev: 1 })),
    patchFolder: vi.fn(async (id: string) => ({ id, meta_rev: 1 })),
    putSettings: vi.fn(async (input: { settings: unknown }) => ({
      settings: input.settings as never,
      rev: 1,
      updated_at: 1,
    })),
    ...overrides,
  };
}

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

/** 造一条「服务端已有 rev=1 的条目」+ 草稿 + 显式入队一条 save_body op */
async function setupSaveBody(id: string, body: string): Promise<void> {
  await applySyncItems([serverItem({ id, rev: 1, content_hash: "old" })]);
  await saveDraft(id, body, 2000);
  await enqueueBodySave(id, 1, 2000);
}

function lastSaveBodyCall(api: PushApi): unknown[] {
  const calls = (api.saveBody as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as unknown[];
}

/** 参数顺序同 `itemsApi.saveBody`：第 5 参是 deviceId、**第 6 参才是引用集合** */
function refsOfLastSaveBodyCall(api: PushApi): unknown {
  return lastSaveBodyCall(api)[5];
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("推送携带附件引用集合", () => {
  it("单条路径：正文里的图按 sha 报给 saveBody", async () => {
    const id = newUlid();
    await setupSaveBody(id, `![甲](/api/attachments/h/${SHA_A})\n\n![乙](/api/attachments/h/${SHA_B})`);
    const api = fakeApi();

    await pushQueue({ api, now: () => 4000 });

    expect(refsOfLastSaveBodyCall(api)).toEqual([SHA_A, SHA_B]);
  });

  it("正文里没有图：传空数组（表示「当前稿没有引用」，不是「不知道」）", async () => {
    const id = newUlid();
    await setupSaveBody(id, "没有图");
    const api = fakeApi();

    await pushQueue({ api, now: () => 4000 });

    expect(refsOfLastSaveBodyCall(api)).toEqual([]);
  });

  it("批量路径：save_body op 本身带 refs（离线主路径）", async () => {
    const id = newUlid();
    await setupSaveBody(id, `![甲](/api/attachments/h/${SHA_A})\n\n![丙](/api/attachments/h/${SHA_C})`);
    // 队列里只有一条时走的是单条路径；批量要两条以上才会成批
    await setupSaveBody(newUlid(), `![丁](/api/attachments/h/${"d".repeat(64)})`);

    // 用 `vi.fn<PushApi["batch"]>` 定住签名：断言从 `batch.mock.calls[0][0]` 读，
    // 写成零参 mock 会让 `calls[0]` 的元组长度为 0，索引取不到
    const batch = vi.fn<NonNullable<PushApi["batch"]>>(async () => ({ results: [] }));
    const api = fakeApi({ batch });

    await pushQueue({ api, now: () => 4000 });

    expect(batch).toHaveBeenCalled();
    const ops = batch.mock.calls[0]![0] as BatchOp[];
    const op = ops.find((o) => o.kind === "save_body" && o.id === id);
    expect(op).toBeDefined();
    expect(op && "refs" in op ? op.refs : undefined).toEqual([SHA_A, SHA_C]);
  });
});

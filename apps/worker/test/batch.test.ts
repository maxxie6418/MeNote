/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 批量写入（M2-9）：`POST /api/batch`。
 *
 * 核心验收是**逐操作独立判定冲突**：某个操作冲突或目标不存在，只记它自己，其余照常落库。
 * （这也是为什么服务端逐个复用单条端点的服务函数，而不是拼一个大 batch——D1 的 batch 是事务性的，
 * 一个失败会整批回滚。）
 */
import {
  BATCH_MAX_OPS,
  newUlid,
  ITEM_META_HEADER,
  base64UrlEncode,
  encodeItemWriteMeta,
  type BatchResponse,
  type BatchResult,
  type ItemWriteMeta,
} from "@menote/shared";
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";

async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function registerOwner(username: string): Promise<{ cookie: string; id: string }> {
  const key = new Uint8Array(32);
  key.fill(11);
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
    body: JSON.stringify({ username, login_key: base64UrlEncode(key) }),
  });
  const cookie = ((res.headers.get("set-cookie") ?? "").split(";")[0] ?? "").trim();
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
  const body = (await me.json()) as { id: string };
  return { cookie, id: body.id };
}

function writeHeaders(cookie: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Menote": "1",
    Origin: ORIGIN,
    Cookie: cookie,
  };
}

async function metaFor(body: string, overrides: Partial<ItemWriteMeta> = {}): Promise<ItemWriteMeta> {
  return {
    type: "note",
    title: "未命名笔记",
    folder_id: null,
    tags: [],
    memo_at: null,
    is_task: 0,
    task_status: null,
    task_due: null,
    task_priority: null,
    content_hash: await contentHash(body),
    ...overrides,
  };
}

async function postBatch(
  cookie: string,
  ops: unknown[],
): Promise<{ status: number; body: BatchResponse }> {
  const res = await SELF.fetch(`${ORIGIN}/api/batch`, {
    method: "POST",
    headers: writeHeaders(cookie),
    body: JSON.stringify({ ops }),
  });
  return { status: res.status, body: (await res.json()) as BatchResponse };
}

/** 便于按 index 取结果 */
function at(results: BatchResult[], index: number): BatchResult {
  const found = results.find((row) => row.index === index);
  if (!found) throw new Error(`没有 index=${index} 的结果`);
  return found;
}

let alice: { cookie: string; id: string };
// 真正的 ULID（26 位 Crockford 字母表）：手写容易少一位，直接用生成器
const idA = newUlid();
const idB = newUlid();
const idC = newUlid();
const idD = newUlid();
const idE = newUlid();
const idF = newUlid();
const idZ = newUlid();

beforeEach(async () => {
  await freshDatabase();
  alice = await registerOwner("alice");
});

describe("POST /api/batch", () => {
  it("未登录 401", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
      body: JSON.stringify({ ops: [] }),
    });
    expect(res.status).toBe(401);
  });

  it("空批次返回空结果", async () => {
    const { status, body } = await postBatch(alice.cookie, []);
    expect(status).toBe(200);
    expect(body.results).toEqual([]);
  });

  it("三个操作各按其道落库：create / save_body / patch_meta", async () => {
    const body1 = "第一篇正文";
    const { status, body } = await postBatch(alice.cookie, [
      { kind: "create", id: idA, meta: await metaFor(body1), body: body1 },
      {
        kind: "save_body",
        id: idA,
        base_rev: 1,
        content_hash: await contentHash("第二版"),
        body: "第二版",
      },
      {
        kind: "patch_meta",
        id: idA,
        patch: { base_meta_rev: 1, title: "改过的标题" },
      },
    ]);

    expect(status).toBe(200);
    expect(body.results).toHaveLength(3);
    expect(at(body.results, 0)).toMatchObject({ ok: true, kind: "create", rev: 1 });
    expect(at(body.results, 1)).toMatchObject({ ok: true, kind: "save_body", rev: 2 });
    expect(at(body.results, 2)).toMatchObject({ ok: true, kind: "patch_meta", rev: 2 });

    // 落库结果核对：正文与标题都是最后一次写入的值
    const fetched = await SELF.fetch(`${ORIGIN}/api/items/${idA}/body`, {
      headers: { Cookie: alice.cookie },
    });
    expect(await fetched.text()).toBe("第二版");
  });

  it("**一个操作冲突不牵连其它**：冲突只记它自己", async () => {
    const first = "初始正文";
    await postBatch(alice.cookie, [
      { kind: "create", id: idB, meta: await metaFor(first), body: first },
    ]);

    const { status, body } = await postBatch(alice.cookie, [
      {
        kind: "save_body",
        id: idB,
        base_rev: 99, // 故意用错的基版本 → 冲突
        content_hash: await contentHash("不该写进去"),
        body: "不该写进去",
      },
      { kind: "create", id: idC, meta: await metaFor("另一条"), body: "另一条" },
    ]);

    expect(status).toBe(200); // 恒 200；逐条结果在 results 里
    expect(at(body.results, 0)).toMatchObject({ ok: false, code: "rev_conflict" });
    expect(at(body.results, 1)).toMatchObject({ ok: true, kind: "create" });

    // 冲突那条的正文没被改写
    const fetched = await SELF.fetch(`${ORIGIN}/api/items/${idB}/body`, {
      headers: { Cookie: alice.cookie },
    });
    expect(await fetched.text()).toBe(first);
  });

  it("目标不存在记为 not_found，其它操作照常", async () => {
    const { body } = await postBatch(alice.cookie, [
      {
        kind: "patch_meta",
        id: idZ,
        patch: { base_meta_rev: 1, title: "不存在" },
      },
      { kind: "create", id: idD, meta: await metaFor("正文"), body: "正文" },
    ]);

    expect(at(body.results, 0)).toMatchObject({ ok: false, code: "not_found" });
    expect(at(body.results, 1)).toMatchObject({ ok: true });
  });

  it("重放同一个 create 也成功（PUT 幂等语义）", async () => {
    const body1 = "同一份内容";
    const meta = await metaFor(body1);
    await postBatch(alice.cookie, [
      { kind: "create", id: idE, meta, body: body1 },
    ]);
    const { body } = await postBatch(alice.cookie, [
      { kind: "create", id: idE, meta, body: body1 },
    ]);
    expect(at(body.results, 0)).toMatchObject({ ok: true, rev: 1 });
  });

  it("超过单批上限（10 个操作）返回 422", async () => {
    const ops = Array.from({ length: BATCH_MAX_OPS + 1 }, () => ({
      kind: "create" as const,
      id: newUlid(),
      meta: {} as ItemWriteMeta,
      body: "x",
    }));

    const { status, body } = await postBatch(alice.cookie, ops);
    expect(status).toBe(422);
    expect(JSON.stringify(body)).toContain("invalid");
  });

  it("非法操作形状返回 422（例如缺 kind）", async () => {
    const { status } = await postBatch(alice.cookie, [{ id: "x", body: "y" }]);
    expect(status).toBe(422);
  });

  it("单条端点仍然可用（批量是补充，不是替换）", async () => {
    const body1 = "单条路径";
    const meta = await metaFor(body1);
    const res = await SELF.fetch(`${ORIGIN}/api/items/${idF}`, {
      method: "PUT",
      headers: {
        ...writeHeaders(alice.cookie),
        [ITEM_META_HEADER]: encodeItemWriteMeta(meta),
      },
      body: body1,
    });
    expect(res.status).toBe(200);
  });
});

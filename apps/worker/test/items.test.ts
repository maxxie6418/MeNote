/// <reference types="@cloudflare/vitest-pool-workers/types" />
import {
  BODY_HARD_LIMIT_BYTES,
  ITEM_HASH_HEADER,
  ITEM_META_HEADER,
  base64UrlEncode,
  encodeItemWriteMeta,
  newUlid,
  type ItemWriteMeta,
} from "@menote/shared";
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SQL_BUMP_SYNC_SEQ_ON_ITEM_BODY,
  SQL_UPDATE_ITEM_BODY,
  SQL_UPSERT_ITEM_BODY,
} from "../src/db/tables";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";

async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function loginKey(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return base64UrlEncode(bytes);
}

function headers(cookie: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Menote": "1",
    Origin: ORIGIN,
    Cookie: cookie,
    ...extra,
  };
}

async function registerUser(username: string, seed: number): Promise<{ cookie: string; id: string }> {
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
    body: JSON.stringify({ username, login_key: loginKey(seed) }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = (setCookie.split(";")[0] ?? "").trim();
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
  const body = (await me.json()) as { id: string };
  return { cookie, id: body.id };
}

async function openRegistration(cookie: string): Promise<void> {
  const res = await SELF.fetch(`${ORIGIN}/api/admin/registration`, {
    method: "PUT",
    headers: headers(cookie),
    body: JSON.stringify({ open: true }),
  });
  if (res.status !== 200) throw new Error(`打开注册开关失败：${res.status}`);
}

async function defaultMeta(body: string, overrides: Partial<ItemWriteMeta> = {}): Promise<ItemWriteMeta> {
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

async function createNote(
  cookie: string,
  id: string,
  body: string,
  overrides: Partial<ItemWriteMeta> = {},
): Promise<Response> {
  const meta = await defaultMeta(body, overrides);
  return SELF.fetch(`${ORIGIN}/api/items/${id}`, {
    method: "PUT",
    headers: headers(cookie, { [ITEM_META_HEADER]: encodeItemWriteMeta(meta) }),
    body,
  });
}

async function saveBody(
  cookie: string,
  id: string,
  baseRev: number,
  body: string,
  hash?: string,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/items/${id}/body`, {
    method: "PUT",
    headers: headers(cookie, {
      "If-Match": String(baseRev),
      [ITEM_HASH_HEADER]: hash ?? (await contentHash(body)),
    }),
    body,
  });
}

async function getBody(cookie: string, id: string, ifNoneMatch?: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/items/${id}/body`, {
    headers: ifNoneMatch ? { Cookie: cookie, "If-None-Match": ifNoneMatch } : { Cookie: cookie },
  });
}

async function readStoredBody(id: string): Promise<string> {
  const row = await env.DB.prepare("SELECT body FROM item_bodies WHERE item_id = ?")
    .bind(id)
    .first<{ body: string }>();
  return row?.body ?? "";
}

async function readItemRow(id: string): Promise<{ rev: number; content_hash: string; sync_seq: number }> {
  const row = await env.DB.prepare(
    "SELECT rev, content_hash, sync_seq FROM items WHERE id = ?",
  )
    .bind(id)
    .first<{ rev: number; content_hash: string; sync_seq: number }>();
  if (!row) throw new Error("条目不存在");
  return row;
}

async function readUserSyncSeq(userId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT sync_seq FROM users WHERE id = ?")
    .bind(userId)
    .first<{ sync_seq: number }>();
  return row?.sync_seq ?? 0;
}

beforeEach(async () => {
  await freshDatabase();
});

describe("条目：新建与取正文", () => {
  it("新建笔记返回 rev=1 与实测大小；取正文一致；ETag 命中返回 304", async () => {
    const user = await registerUser("Alice", 1);
    const id = newUlid();
    const body = "# 标题\n\n正文内容";

    const created = await createNote(user.cookie, id, body);
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { rev: number; bytes: number; chars: number };
    expect(createdBody.rev).toBe(1);
    expect(createdBody.bytes).toBe(new TextEncoder().encode(body).byteLength);
    expect(createdBody.chars).toBe([...body].length);

    const fetched = await getBody(user.cookie, id);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("content-type")).toContain("text/markdown");
    expect(await fetched.text()).toBe(body);

    const etag = fetched.headers.get("etag") ?? "";
    expect(etag).not.toBe("");
    const notModified = await getBody(user.cookie, id, etag);
    expect(notModified.status).toBe(304);
  });

  it("同 id 同内容重复提交幂等（rev 不变）；同 id 不同内容返回 409 并带服务端哈希", async () => {
    const user = await registerUser("Alice", 1);
    const id = newUlid();

    const first = await createNote(user.cookie, id, "第一版");
    expect(first.status).toBe(200);

    const replay = await createNote(user.cookie, id, "第一版");
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { rev: number }).rev).toBe(1);

    const conflict = await createNote(user.cookie, id, "第二版");
    expect(conflict.status).toBe(409);
    const detail = (await conflict.json()) as { code: string; detail?: { content_hash?: string } };
    expect(detail.code).toBe("rev_conflict");
    expect(detail.detail?.content_hash).toBe(await contentHash("第一版"));
  });

  it("Memo 允许无标题；但不得带文件夹、必须有时间戳；笔记不得无标题", async () => {
    const user = await registerUser("Alice", 1);

    const memo = await createNote(user.cookie, newUlid(), "随手记", {
      type: "memo",
      title: null,
      memo_at: 1_700_000_000_000,
    });
    expect(memo.status).toBe(200);

    const memoWithFolder = await createNote(user.cookie, newUlid(), "x", {
      type: "memo",
      title: null,
      memo_at: 1_700_000_000_000,
      folder_id: newUlid(),
    });
    expect(memoWithFolder.status).toBe(422);

    const badMemo = await createNote(user.cookie, newUlid(), "x", {
      type: "memo",
      title: "有标题",
      memo_at: 1_700_000_000_000,
    });
    expect(badMemo.status).toBe(422);

    const badNote = await createNote(user.cookie, newUlid(), "x", { title: null });
    expect(badNote.status).toBe(422);
  });

  it("超过硬上限返回 413 too_large", async () => {
    const user = await registerUser("Alice", 1);
    const huge = "a".repeat(BODY_HARD_LIMIT_BYTES + 1);
    const res = await createNote(user.cookie, newUlid(), huge);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe("too_large");
  });
});

describe("条目：全文保存与冲突", () => {
  it("基版本一致则推进 rev 并更新正文；旧基版本返回 409", async () => {
    const user = await registerUser("Alice", 1);
    const id = newUlid();
    await createNote(user.cookie, id, "v1");

    const saved = await saveBody(user.cookie, id, 1, "v2");
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { rev: number }).rev).toBe(2);
    expect(await readStoredBody(id)).toBe("v2");

    const stale = await saveBody(user.cookie, id, 1, "v3");
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe("rev_conflict");
    expect(await readStoredBody(id)).toBe("v2");
  });

  it("响应丢失重放：旧基版本但内容与当前一致 → 视为已成功（200，rev 不变）", async () => {
    const user = await registerUser("Alice", 1);
    const id = newUlid();
    await createNote(user.cookie, id, "v1");
    await saveBody(user.cookie, id, 1, "v2");

    const replay = await saveBody(user.cookie, id, 1, "v2");
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { rev: number }).rev).toBe(2);
  });

  it("并发同基版本保存：只有一个成功，落败者不得覆盖胜者正文", async () => {
    const user = await registerUser("Alice", 1);
    const id = newUlid();
    await createNote(user.cookie, id, "v1");

    const [first, second] = await Promise.all([
      saveBody(user.cookie, id, 1, "来自A"),
      saveBody(user.cookie, id, 1, "来自B"),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winnerBody = first.status === 200 ? "来自A" : "来自B";
    expect(await readStoredBody(id)).toBe(winnerBody);

    const row = await readItemRow(id);
    expect(row.rev).toBe(2);
    expect(row.content_hash).toBe(await contentHash(winnerBody));
  });

  it("条件 batch 在基版本过期时整批无改动（正文与计数器都不动）", async () => {
    const user = await registerUser("Alice", 1);
    const id = newUlid();
    await createNote(user.cookie, id, "v1");
    await saveBody(user.cookie, id, 1, "v2");

    const seqBefore = await readUserSyncSeq(user.id);
    const staleHash = await contentHash("过期内容");

    const results = await env.DB.batch([
      env.DB.prepare(SQL_UPDATE_ITEM_BODY).bind(
        4,
        staleHash,
        1,
        1,
        null,
        user.id,
        id,
        user.id,
        1, // 基版本已过期：当前 rev 是 2
      ),
      env.DB.prepare(SQL_UPSERT_ITEM_BODY).bind(id, "过期内容", id, user.id, 2, staleHash),
      env.DB.prepare(SQL_BUMP_SYNC_SEQ_ON_ITEM_BODY).bind(user.id, id, 2, staleHash),
    ]);

    expect(results[0]?.meta.changes ?? 0).toBe(0);
    expect(await readStoredBody(id)).toBe("v2");
    expect((await readItemRow(id)).content_hash).toBe(await contentHash("v2"));
    expect(await readUserSyncSeq(user.id)).toBe(seqBefore);
  });

  it("不存在的条目保存返回 404", async () => {
    const user = await registerUser("Alice", 1);
    const res = await saveBody(user.cookie, newUlid(), 1, "x");
    expect(res.status).toBe(404);
  });
});

describe("条目：元数据补丁", () => {
  it("标题与置顶更新推进 meta_rev；旧 meta_rev 返回 409", async () => {
    const user = await registerUser("Alice", 1);
    const id = newUlid();
    await createNote(user.cookie, id, "正文");

    const patched = await SELF.fetch(`${ORIGIN}/api/items/${id}/meta`, {
      method: "PATCH",
      headers: headers(user.cookie),
      body: JSON.stringify({ base_meta_rev: 1, title: "新标题", pinned: 1 }),
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { meta_rev: number }).meta_rev).toBe(2);

    const stale = await SELF.fetch(`${ORIGIN}/api/items/${id}/meta`, {
      method: "PATCH",
      headers: headers(user.cookie),
      body: JSON.stringify({ base_meta_rev: 1, title: "又改" }),
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe("meta_conflict");
  });

  it("笔记不允许把标题设为 null；目标文件夹不存在返回 422", async () => {
    const user = await registerUser("Alice", 1);
    const id = newUlid();
    await createNote(user.cookie, id, "正文");

    const noTitle = await SELF.fetch(`${ORIGIN}/api/items/${id}/meta`, {
      method: "PATCH",
      headers: headers(user.cookie),
      body: JSON.stringify({ base_meta_rev: 1, title: null }),
    });
    expect(noTitle.status).toBe(422);

    const badFolder = await SELF.fetch(`${ORIGIN}/api/items/${id}/meta`, {
      method: "PATCH",
      headers: headers(user.cookie),
      body: JSON.stringify({ base_meta_rev: 1, folder_id: newUlid() }),
    });
    expect(badFolder.status).toBe(422);
  });
});

describe("文件夹", () => {
  it("创建两级文件夹成功，第三级被拒", async () => {
    const user = await registerUser("Alice", 1);
    const root = newUlid();
    const child = newUlid();

    const created = await SELF.fetch(`${ORIGIN}/api/folders`, {
      method: "POST",
      headers: headers(user.cookie),
      body: JSON.stringify({ id: root, parent_id: null, name: "工作" }),
    });
    expect(created.status).toBe(200);

    const createdChild = await SELF.fetch(`${ORIGIN}/api/folders`, {
      method: "POST",
      headers: headers(user.cookie),
      body: JSON.stringify({ id: child, parent_id: root, name: "子文件夹" }),
    });
    expect(createdChild.status).toBe(200);

    const tooDeep = await SELF.fetch(`${ORIGIN}/api/folders`, {
      method: "POST",
      headers: headers(user.cookie),
      body: JSON.stringify({ id: newUlid(), parent_id: child, name: "第三级" }),
    });
    expect(tooDeep.status).toBe(422);
  });

  it("改名推进 meta_rev；移动到自身或自己的子文件夹被拒", async () => {
    const user = await registerUser("Alice", 1);
    const root = newUlid();
    const child = newUlid();
    for (const [id, parent, name] of [
      [root, null, "工作"],
      [child, root, "子文件夹"],
    ] as const) {
      await SELF.fetch(`${ORIGIN}/api/folders`, {
        method: "POST",
        headers: headers(user.cookie),
        body: JSON.stringify({ id, parent_id: parent, name }),
      });
    }

    const renamed = await SELF.fetch(`${ORIGIN}/api/folders/${child}`, {
      method: "PATCH",
      headers: headers(user.cookie),
      body: JSON.stringify({ base_meta_rev: 1, name: "改名了" }),
    });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { meta_rev: number }).meta_rev).toBe(2);

    const toSelf = await SELF.fetch(`${ORIGIN}/api/folders/${root}`, {
      method: "PATCH",
      headers: headers(user.cookie),
      body: JSON.stringify({ base_meta_rev: 1, parent_id: root }),
    });
    expect(toSelf.status).toBe(422);

    const toOwnChild = await SELF.fetch(`${ORIGIN}/api/folders/${root}`, {
      method: "PATCH",
      headers: headers(user.cookie),
      body: JSON.stringify({ base_meta_rev: 1, parent_id: child }),
    });
    expect(toOwnChild.status).toBe(422);
  });
});

describe("多用户隔离与鉴权", () => {
  it("取不到他人的正文，也不能保存他人的条目（404）", async () => {
    const alice = await registerUser("Alice", 1);
    await openRegistration(alice.cookie);
    const bob = await registerUser("Bob", 2);
    const id = newUlid();
    await createNote(alice.cookie, id, "Alice 的正文");

    expect((await getBody(bob.cookie, id)).status).toBe(404);
    expect((await saveBody(bob.cookie, id, 1, "篡改")).status).toBe(404);
  });

  it("未登录访问条目接口返回 401", async () => {
    const id = newUlid();
    const res = await SELF.fetch(`${ORIGIN}/api/items/${id}/body`);
    expect(res.status).toBe(401);
  });

  it("ID 格式非法返回 422", async () => {
    const user = await registerUser("Alice", 1);
    const res = await SELF.fetch(`${ORIGIN}/api/items/not-a-ulid/body`, {
      headers: { Cookie: user.cookie },
    });
    expect(res.status).toBe(422);
  });
});

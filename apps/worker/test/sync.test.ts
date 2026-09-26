/// <reference types="@cloudflare/vitest-pool-workers/types" />
import {
  SYNC_PAGE_LIMIT,
  base64UrlEncode,
  encodeItemWriteMeta,
  ITEM_META_HEADER,
  newUlid,
  type ItemWriteMeta,
  type SyncResponse,
} from "@menote/shared";
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";

function headers(cookie: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Menote": "1",
    Origin: ORIGIN,
    Cookie: cookie,
    ...extra,
  };
}

function loginKey(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return base64UrlEncode(bytes);
}

async function registerUser(username: string, seed: number): Promise<{ cookie: string; id: string }> {
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
    body: JSON.stringify({ username, login_key: loginKey(seed) }),
  });
  const cookie = ((res.headers.get("set-cookie") ?? "").split(";")[0] ?? "").trim();
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
  return { cookie, id: ((await me.json()) as { id: string }).id };
}

async function openRegistration(cookie: string): Promise<void> {
  const res = await SELF.fetch(`${ORIGIN}/api/admin/registration`, {
    method: "PUT",
    headers: headers(cookie),
    body: JSON.stringify({ open: true }),
  });
  if (res.status !== 200) throw new Error(`打开注册开关失败：${res.status}`);
}

async function createNote(cookie: string, body: string): Promise<string> {
  const id = newUlid();
  const meta: ItemWriteMeta = {
    type: "note",
    title: "未命名笔记",
    folder_id: null,
    tags: [],
    memo_at: null,
    is_task: 0,
    task_status: null,
    task_due: null,
    task_priority: null,
    content_hash: `hash-${body}`,
  };
  const res = await SELF.fetch(`${ORIGIN}/api/items/${id}`, {
    method: "PUT",
    headers: headers(cookie, { [ITEM_META_HEADER]: encodeItemWriteMeta(meta) }),
    body,
  });
  if (res.status !== 200) throw new Error(`新建条目失败：${res.status}`);
  return id;
}

async function createFolder(cookie: string, name: string, parentId: string | null = null): Promise<string> {
  const id = newUlid();
  const res = await SELF.fetch(`${ORIGIN}/api/folders`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({ id, parent_id: parentId, name }),
  });
  if (res.status !== 200) throw new Error(`新建文件夹失败：${res.status}`);
  return id;
}

async function pull(cookie: string, cursor = 0): Promise<{ status: number; body: SyncResponse }> {
  const res = await SELF.fetch(`${ORIGIN}/api/sync?cursor=${cursor}`, { headers: { Cookie: cookie } });
  return { status: res.status, body: (await res.json()) as SyncResponse };
}

/** 直接灌数据：批量插入同步序号可控的条目行（跳过 API，便于构造分页与同组场景） */
async function seedItems(
  userId: string,
  count: number,
  syncSeqOf: (index: number) => number,
  startAt = 0,
): Promise<void> {
  const chunkSize = 40;
  for (let offset = 0; offset < count; offset += chunkSize) {
    const statements = [];
    for (let i = offset; i < Math.min(offset + chunkSize, count); i += 1) {
      const index = startAt + i;
      statements.push(
        env.DB.prepare(
          `INSERT INTO items (id, user_id, type, title, size_bytes, content_hash, sync_seq, created_at, updated_at)
           VALUES (?, ?, 'note', ?, 1, ?, ?, 1, 1)`,
        ).bind(newUlid(), userId, `第 ${index} 条`, `h${index}`, syncSeqOf(index)),
      );
    }
    await env.DB.batch(statements);
  }
}

beforeEach(async () => {
  await freshDatabase();
});

describe("增量拉取", () => {
  it("空库：空数组、游标不动、无更多", async () => {
    const user = await registerUser("Alice", 1);
    const { status, body } = await pull(user.cookie);
    expect(status).toBe(200);
    expect(body).toEqual({
      items: [],
      folders: [],
      next_cursor: 0,
      has_more: false,
      full_resync: false,
    });
  });

  it("新建条目与文件夹后可按游标拉到，且再拉为空", async () => {
    const user = await registerUser("Alice", 1);
    const noteId = await createNote(user.cookie, "第一版");
    const folderId = await createFolder(user.cookie, "工作");

    const first = await pull(user.cookie, 0);
    expect(first.body.items.map((item) => item.id)).toEqual([noteId]);
    expect(first.body.folders.map((folder) => folder.id)).toEqual([folderId]);
    expect(first.body.has_more).toBe(false);
    expect(first.body.next_cursor).toBeGreaterThan(0);
    expect(first.body.items[0]?.deleted).toBe(false);
    expect(first.body.items[0]?.rev).toBe(1);

    const second = await pull(user.cookie, first.body.next_cursor);
    // 游标取两类末端较小值时，落在中间的另一类会在下一轮重复返回（upsert 按 id 幂等，无害）
    expect(second.body.has_more).toBe(false);

    const third = await pull(user.cookie, second.body.next_cursor);
    expect(third.body.items).toEqual([]);
    expect(third.body.folders).toEqual([]);
    expect(third.body.next_cursor).toBe(second.body.next_cursor);
  });

  it("超过每类上限时分页，且游标取两类末端较小值（不漏拉）", async () => {
    const user = await registerUser("Alice", 1);
    // items 有 250 行；folders 先放 1 行（序号 1），制造"两类截断点不同"
    await createFolder(user.cookie, "工作");
    await seedItems(user.id, 250, (index) => index + 2);

    const page1 = await pull(user.cookie, 0);
    expect(page1.body.items).toHaveLength(SYNC_PAGE_LIMIT);
    expect(page1.body.has_more).toBe(true);
    // folders 只有 1 行（seq=1），items 末端是 201 → 取较小值 1
    expect(page1.body.next_cursor).toBe(1);

    const page2 = await pull(user.cookie, page1.body.next_cursor);
    expect(page2.body.items).toHaveLength(SYNC_PAGE_LIMIT);
    expect(page2.body.next_cursor).toBe(1 + SYNC_PAGE_LIMIT);

    const page3 = await pull(user.cookie, page2.body.next_cursor);
    expect(page3.body.items).toHaveLength(50);
    expect(page3.body.has_more).toBe(false);

    // 全量核对：三次拉取的条目并集 = 250 条且不重不漏
    const ids = new Set([
      ...page1.body.items.map((item) => item.id),
      ...page2.body.items.map((item) => item.id),
      ...page3.body.items.map((item) => item.id),
    ]);
    expect(ids.size).toBe(250);
  });

  it("某一类没有新行时不把游标拖回原地（否则客户端原地打转）", async () => {
    const user = await registerUser("Alice", 1);
    await seedItems(user.id, 250, (index) => index + 1);

    const page1 = await pull(user.cookie, 0);
    expect(page1.body.folders).toEqual([]);
    expect(page1.body.next_cursor).toBe(SYNC_PAGE_LIMIT);

    const page2 = await pull(user.cookie, page1.body.next_cursor);
    expect(page2.body.items).toHaveLength(50);
    expect(page2.body.has_more).toBe(false);
    expect(page2.body.next_cursor).toBe(250);
  });

  it("同一 sync_seq 的组不被切开：单组超过上限时返回 413 而不是死循环", async () => {
    const user = await registerUser("Alice", 1);
    await seedItems(user.id, SYNC_PAGE_LIMIT + 1, () => 1);

    const res = await SELF.fetch(`${ORIGIN}/api/sync?cursor=0`, {
      headers: { Cookie: user.cookie },
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe("too_large");
  });

  it("组被截断时整组回退，下一次从该组之前继续（不丢行）", async () => {
    const user = await registerUser("Alice", 1);
    // 1..199 单行一组，第 200、201 行同组（组跨过上限边界）
    await seedItems(user.id, 199, (index) => index + 1);
    await seedItems(user.id, 2, () => 200, 199);

    const page1 = await pull(user.cookie, 0);
    expect(page1.body.items).toHaveLength(199);
    expect(page1.body.next_cursor).toBe(199);
    expect(page1.body.has_more).toBe(true);

    const page2 = await pull(user.cookie, page1.body.next_cursor);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.items.every((item) => item.sync_seq === 200)).toBe(true);
  });

  it("软删随增量下发（deleted 标记）", async () => {
    const user = await registerUser("Alice", 1);
    const noteId = await createNote(user.cookie, "待删");
    const first = await pull(user.cookie, 0);
    const cursor = first.body.next_cursor;

    await env.DB.prepare("UPDATE items SET deleted_at = 123, sync_seq = sync_seq + 1 WHERE id = ?")
      .bind(noteId)
      .run();

    const second = await pull(user.cookie, cursor);
    const row = second.body.items.find((item) => item.id === noteId);
    expect(row?.deleted).toBe(true);
    expect(row?.deleted_at).toBe(123);
  });

  it("full_resync 只在游标大于 0 且早于 tombstone_floor 时给出（游标 0 不死循环）", async () => {
    const user = await registerUser("Alice", 1);
    await env.DB.prepare("UPDATE users SET tombstone_floor = 5 WHERE id = ?").bind(user.id).run();

    const atZero = await pull(user.cookie, 0);
    expect(atZero.body.full_resync).toBe(false);

    const stale = await pull(user.cookie, 3);
    expect(stale.body.full_resync).toBe(true);
    expect(stale.body.next_cursor).toBe(0);

    const fresh = await pull(user.cookie, 9);
    expect(fresh.body.full_resync).toBe(false);
  });

  it("多用户隔离：只看到自己的行", async () => {
    const alice = await registerUser("Alice", 1);
    await openRegistration(alice.cookie);
    const bob = await registerUser("Bob", 2);

    const aliceNote = await createNote(alice.cookie, "Alice 的");
    await createNote(bob.cookie, "Bob 的");

    const view = await pull(alice.cookie, 0);
    expect(view.body.items.map((item) => item.id)).toEqual([aliceNote]);
  });

  it("游标非法返回 422；未登录返回 401", async () => {
    const user = await registerUser("Alice", 1);
    const bad = await SELF.fetch(`${ORIGIN}/api/sync?cursor=-1`, { headers: { Cookie: user.cookie } });
    expect(bad.status).toBe(422);

    const anonymous = await SELF.fetch(`${ORIGIN}/api/sync?cursor=0`);
    expect(anonymous.status).toBe(401);
  });
});

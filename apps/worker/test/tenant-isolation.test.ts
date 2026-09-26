/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 多用户隔离（越权）回归测试。
 *
 * 威胁模型：两个家庭成员共用同一个自托管实例，**彼此不该看到、更不该改到对方的笔记**。
 * 这里用"另一个用户拿到同一个条目 id"这条最强攻击路径来验：条目 id 是全局主键，
 * 服务端的建条目语句只判 `id` 是否存在（有意为之，见 tables.ts 注释），因此
 * 真正的防线必须是**每条读写语句都带 user_id 条件**，以及错误响应里**不得回显对方的数据**。
 *
 * 这几条一旦被改坏，表现是"用户 A 的数据被 B 覆盖"或"B 能探到 A 的版本号"，属于最高危问题，
 * 所以用测试钉死。
 */
import {
  ITEM_HASH_HEADER,
  ITEM_META_HEADER,
  base64UrlEncode,
  encodeItemWriteMeta,
  newUlid,
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

async function registerUser(username: string, seed: number): Promise<string> {
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
    body: JSON.stringify({ username, login_key: loginKey(seed) }),
  });
  return ((res.headers.get("set-cookie") ?? "").split(";")[0] ?? "").trim();
}

async function openRegistration(cookie: string): Promise<void> {
  await SELF.fetch(`${ORIGIN}/api/admin/registration`, {
    method: "PUT",
    headers: headers(cookie),
    body: JSON.stringify({ open: true }),
  });
}

function metaHeaders(cookie: string, meta: ItemWriteMeta): Record<string, string> {
  return headers(cookie, { [ITEM_META_HEADER]: encodeItemWriteMeta(meta) });
}

function noteMeta(title: string, hash: string, folderId: string | null = null): ItemWriteMeta {
  return {
    type: "note",
    title,
    folder_id: folderId,
    tags: [],
    memo_at: null,
    is_task: 0,
    task_status: null,
    task_due: null,
    task_priority: null,
    content_hash: hash,
  };
}

beforeEach(async () => {
  await freshDatabase();
});

describe("多用户隔离：知道对方的条目 id 也动不了", () => {
  it("建条目 / 读正文 / 保存正文 / 改元数据 四条路径都越不过去，且不泄露对方的版本与哈希", async () => {
    const alice = await registerUser("alice", 1);
    await openRegistration(alice);
    const bob = await registerUser("bob", 2);

    // A 建一篇笔记
    const id = newUlid();
    const aliceBody = "A 的私人正文";
    const aliceHash = await contentHash(aliceBody);
    const created = await SELF.fetch(`${ORIGIN}/api/items/${id}`, {
      method: "PUT",
      headers: metaHeaders(alice, noteMeta("A 的笔记", aliceHash)),
      body: aliceBody,
    });
    expect(created.status).toBe(200);

    // B 用同一个 id 想创建自己的条目：必须失败，且错误详情里不得出现 A 的 rev / 哈希
    const bobBody = "B 想覆盖的内容";
    const bobHash = await contentHash(bobBody);
    const collide = await SELF.fetch(`${ORIGIN}/api/items/${id}`, {
      method: "PUT",
      headers: metaHeaders(bob, noteMeta("B 的笔记", bobHash)),
      body: bobBody,
    });
    expect(collide.status).toBe(409);
    const collideBody = (await collide.json()) as { code: string; detail?: Record<string, unknown> };
    expect(collideBody.code).toBe("rev_conflict");
    expect(collideBody.detail?.content_hash).toBe("");
    expect(collideBody.detail?.rev).toBe(0);

    // B 读正文：404（存在与不存在对 B 不可区分）
    const read = await SELF.fetch(`${ORIGIN}/api/items/${id}/body`, { headers: headers(bob) });
    expect(read.status).toBe(404);

    // B 保存正文（带上他猜到的基版本）：同样 404，不能改到 A 的正文
    const save = await SELF.fetch(`${ORIGIN}/api/items/${id}/body`, {
      method: "PUT",
      headers: headers(bob, { "If-Match": "1", [ITEM_HASH_HEADER]: bobHash }),
      body: bobBody,
    });
    expect(save.status).toBe(404);

    // B 改元数据：404
    const patch = await SELF.fetch(`${ORIGIN}/api/items/${id}/meta`, {
      method: "PATCH",
      headers: headers(bob),
      body: JSON.stringify({ base_meta_rev: 1, title: "被 B 改过" }),
    });
    expect(patch.status).toBe(404);

    // A 这边一切未变：正文、标题、版本都没被动过
    const aliceRead = await SELF.fetch(`${ORIGIN}/api/items/${id}/body`, { headers: headers(alice) });
    expect(aliceRead.status).toBe(200);
    expect(await aliceRead.text()).toBe(aliceBody);

    const sync = await (
      await SELF.fetch(`${ORIGIN}/api/sync?cursor=0`, { headers: headers(alice) })
    ).json() as { items: Array<{ id: string; title: string; rev: number }> };
    const seen = sync.items.find((item) => item.id === id);
    expect(seen?.title).toBe("A 的笔记");
    expect(seen?.rev).toBe(1);
  });

  it("B 的拉取里看不到 A 的任何行（游标从 0 拉到底）", async () => {
    const alice = await registerUser("alice", 1);
    await openRegistration(alice);
    const bob = await registerUser("bob", 2);

    const id = newUlid();
    const body = "只有 A 能看到";
    await SELF.fetch(`${ORIGIN}/api/items/${id}`, {
      method: "PUT",
      headers: metaHeaders(alice, noteMeta("A 的笔记", await contentHash(body))),
      body,
    });

    const bobSync = await (
      await SELF.fetch(`${ORIGIN}/api/sync?cursor=0`, { headers: headers(bob) })
    ).json() as { items: unknown[]; folders: unknown[] };
    expect(bobSync.items).toEqual([]);
    expect(bobSync.folders).toEqual([]);
  });
});

/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 条目的隐私标记：单篇加密（M3-7）与移入/移出加密空间（M3-8）。
 *
 * 与 `items.test.ts` 分开是因为这两组都只跟"隐私标记的自洽性"有关，而且条目的通用用例文件
 * 已经到了行数预算。这里验的都是**服务端必须挡住的事**（客户端也有同样的前置校验，
 * 但客户端只是提前给反馈，权威在服务端）：
 * - 没启用隐私锁 → 不能加密、不能移入；
 * - Memo 不能单篇加密、不能放进空间；
 * - 移入/移出的**标记与目标文件夹必须自洽**（不能出现"标记在空间、行却在普通文件夹"）。
 */
import {
  ITEM_HASH_HEADER,
  ITEM_META_HEADER,
  base64UrlEncode,
  encodeItemWriteMeta,
  newUlid,
  type ItemWriteMeta,
} from "@menote/shared";
import { SELF, env } from "cloudflare:test";
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

/** 造一段"形状合法"的字节：首字节是 BLOB 版本 1（服务端只校验长度与版本） */
function base64UrlOf(bytes: number, seed: number): string {
  const data = new Uint8Array(bytes).fill(seed);
  if (bytes > 0) data[0] = 1;
  return base64UrlEncode(data);
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

async function createItem(
  cookie: string,
  id: string,
  body: string,
  overrides: Partial<ItemWriteMeta> = {},
): Promise<Response> {
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
    content_hash: await contentHash(body),
    ...overrides,
  };
  return SELF.fetch(`${ORIGIN}/api/items/${id}`, {
    method: "PUT",
    headers: headers(cookie, { [ITEM_META_HEADER]: encodeItemWriteMeta(meta) }),
    body,
  });
}

/** 给这个用户启用隐私锁（材料形状合法即可，服务端不看内容） */
async function enablePrivacy(cookie: string): Promise<void> {
  const res = await SELF.fetch(`${ORIGIN}/api/crypto`, {
    method: "PUT",
    headers: headers(cookie),
    body: JSON.stringify({
      materials: {
        kdf: "PBKDF2-SHA-256",
        kdf_iterations: 600_000,
        kdf_salt: base64UrlOf(16, 1),
        verifier: base64UrlOf(47, 2),
        k_wrapped_pw: base64UrlOf(61, 3),
      },
      k: base64UrlOf(32, 4),
    }),
  });
  if (res.status !== 200) throw new Error(`启用隐私锁失败：${res.status}`);
}

function patchMeta(cookie: string, id: string, patch: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/items/${id}/meta`, {
    method: "PATCH",
    headers: headers(cookie),
    body: JSON.stringify(patch),
  });
}

/** 该用户的空间行 id（注册时由自愈补建负责） */
async function vaultIdOf(userId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM folders WHERE user_id = ? AND is_enc_space = 1")
    .bind(userId)
    .first<{ id: string }>();
  if (!row) throw new Error("空间行不存在");
  return row.id;
}

let alice: { cookie: string; id: string };

beforeEach(async () => {
  await freshDatabase();
  alice = await registerUser("Alice", 1);
});

describe("单篇加密（M3-7）", () => {
  it("没启用隐私锁时拒绝并给出原因；启用后可开可关", async () => {
    const id = newUlid();
    await createItem(alice.cookie, id, "正文");

    const before = await patchMeta(alice.cookie, id, { base_meta_rev: 1, enc_self: 1 });
    expect(before.status).toBe(422);
    expect(((await before.json()) as { detail?: { reason?: string } }).detail?.reason).toBe(
      "privacy_not_enabled",
    );

    await enablePrivacy(alice.cookie);

    const on = await patchMeta(alice.cookie, id, { base_meta_rev: 1, enc_self: 1 });
    expect(on.status).toBe(200);
    expect(((await on.json()) as { meta_rev: number }).meta_rev).toBe(2);

    // 关掉总是允许的（服务端不看会话里的解锁态）
    const off = await patchMeta(alice.cookie, id, { base_meta_rev: 2, enc_self: 0 });
    expect(off.status).toBe(200);
  });

  it("Memo 一律拒绝（Memo 的门禁由隐私锁负责）", async () => {
    const memoId = newUlid();
    const created = await createItem(alice.cookie, memoId, "随手一记", {
      type: "memo",
      title: null,
      memo_at: 1_700_000_000_000,
    });
    expect(created.status).toBe(200);

    const res = await patchMeta(alice.cookie, memoId, { base_meta_rev: 1, enc_self: 1 });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { message: string }).message).toContain("Memo");
  });
});

describe("移入 / 移出加密空间（M3-8）", () => {
  it("目标与标记必须自洽，且要启用隐私锁", async () => {
    const id = newUlid();
    await createItem(alice.cookie, id, "正文");
    const spaceId = await vaultIdOf(alice.id);

    // ① 没启用隐私锁 → 拒绝并给出原因
    const notEnabled = await patchMeta(alice.cookie, id, {
      base_meta_rev: 1,
      folder_id: spaceId,
      in_enc_space: 1,
    });
    expect(notEnabled.status).toBe(422);
    expect(((await notEnabled.json()) as { detail?: { reason?: string } }).detail?.reason).toBe(
      "privacy_not_enabled",
    );

    await enablePrivacy(alice.cookie);

    // 建一个普通文件夹当"移出目标"
    const normalId = newUlid();
    await SELF.fetch(`${ORIGIN}/api/folders`, {
      method: "POST",
      headers: headers(alice.cookie),
      body: JSON.stringify({ id: normalId, parent_id: null, name: "工作" }),
    });

    // ② 目标不是空间里的文件夹 → 拒绝（避免"标记在空间、行却在普通文件夹"）
    const wrongTarget = await patchMeta(alice.cookie, id, {
      base_meta_rev: 1,
      folder_id: normalId,
      in_enc_space: 1,
    });
    expect(wrongTarget.status).toBe(422);

    // ③ 只给标记不给目标 → 拒绝（两条必须一起写）
    const missingTarget = await patchMeta(alice.cookie, id, { base_meta_rev: 1, in_enc_space: 1 });
    expect(missingTarget.status).toBe(422);

    // ④ 正规移入
    const moved = await patchMeta(alice.cookie, id, {
      base_meta_rev: 1,
      folder_id: spaceId,
      in_enc_space: 1,
    });
    expect(moved.status).toBe(200);

    const row = await env.DB.prepare("SELECT folder_id, in_enc_space FROM items WHERE id = ?")
      .bind(id)
      .first<{ folder_id: string; in_enc_space: number }>();
    expect(row?.folder_id).toBe(spaceId);
    expect(row?.in_enc_space).toBe(1);

    // ⑤ 移出到普通文件夹
    const out = await patchMeta(alice.cookie, id, {
      base_meta_rev: 2,
      folder_id: normalId,
      in_enc_space: 0,
    });
    expect(out.status).toBe(200);

    // ⑥ 移出到空间内的文件夹 → 拒绝（否则等于没移出）
    const badOut = await patchMeta(alice.cookie, id, {
      base_meta_rev: 3,
      folder_id: spaceId,
      in_enc_space: 0,
    });
    expect(badOut.status).toBe(422);
  });

  it("Memo 不能放进加密空间", async () => {
    await enablePrivacy(alice.cookie);
    const memoId = newUlid();
    await createItem(alice.cookie, memoId, "随手一记", {
      type: "memo",
      title: null,
      memo_at: 1_700_000_000_000,
    });
    const spaceId = await vaultIdOf(alice.id);

    const res = await patchMeta(alice.cookie, memoId, {
      base_meta_rev: 1,
      folder_id: spaceId,
      in_enc_space: 1,
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { message: string }).message).toContain("Memo");
  });
});

describe("单篇标记与移入的组合", () => {
  it("同一条可以既单篇加密又在空间里（两条标记互不干扰）", async () => {
    await enablePrivacy(alice.cookie);
    const id = newUlid();
    await createItem(alice.cookie, id, "正文");
    const spaceId = await vaultIdOf(alice.id);

    const enc = await patchMeta(alice.cookie, id, { base_meta_rev: 1, enc_self: 1 });
    expect(enc.status).toBe(200);

    const moved = await patchMeta(alice.cookie, id, {
      base_meta_rev: 2,
      folder_id: spaceId,
      in_enc_space: 1,
    });
    expect(moved.status).toBe(200);

    const row = await env.DB.prepare("SELECT enc_self, in_enc_space FROM items WHERE id = ?")
      .bind(id)
      .first<{ enc_self: number; in_enc_space: number }>();
    expect(row).toEqual({ enc_self: 1, in_enc_space: 1 });
  });
});

// 让 lint 知道这些导入是刻意保留的（与 items.test.ts 用同一套请求头约定）
void ITEM_HASH_HEADER;

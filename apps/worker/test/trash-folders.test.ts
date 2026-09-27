/**
 * 回收站里的**文件夹**：永久删除与清空（2026-09-27 按用户拍板补齐服务端能力）。
 *
 * 从 `trash.test.ts` 拆出来单独一份：那个文件已经接近全局 500 行上限（`eslint` 的 `max-lines`
 * 会拦），而"文件夹的永久删除"本身也自成一组用例。
 *
 * 各测试文件自带一份最小助手（与 `trash.test.ts` / `items.test.ts` 的写法一致）。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import {
  ITEM_META_HEADER,
  base64UrlEncode,
  encodeItemWriteMeta,
  newUlid,
  type ItemWriteMeta,
} from "@menote/shared";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";

let seq = 1;

function nextDevice(): number {
  seq += 1;
  return seq;
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
  const response = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
    body: JSON.stringify({ username, login_key: loginKey(seed) }),
  });
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookie = (setCookie.split(";")[0] ?? "").trim();
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
  const body = (await me.json()) as { id: string };
  return { cookie, id: body.id };
}

/** 打开注册开关（第一个账号之后需要它，否则第二个人注册不了） */
async function openRegistration(cookie: string): Promise<void> {
  const response = await SELF.fetch(`${ORIGIN}/api/admin/registration`, {
    method: "PUT",
    headers: headers(cookie),
    body: JSON.stringify({ open: true }),
  });
  if (response.status !== 200) throw new Error(`打开注册开关失败：${response.status}`);
}

async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createNote(cookie: string, title: string): Promise<string> {
  const id = newUlid();
  const body = `---\nmenote:\n  type: note\n---\n\n# ${title}\n`;
  const meta: ItemWriteMeta = {
    type: "note",
    title,
    folder_id: null,
    tags: [],
    memo_at: null,
    is_task: 0,
    task_status: null,
    task_due: null,
    task_priority: null,
    content_hash: await contentHash(body),
  };
  const response = await SELF.fetch(`${ORIGIN}/api/items/${id}`, {
    method: "PUT",
    headers: headers(cookie, { [ITEM_META_HEADER]: encodeItemWriteMeta(meta) }),
    body,
  });
  if (response.status !== 200) throw new Error(`建笔记失败：${response.status}`);
  return id;
}

async function createFolder(cookie: string, name: string): Promise<string> {
  const id = newUlid();
  const response = await SELF.fetch(`${ORIGIN}/api/folders`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({ id, name, parent_id: null }),
  });
  if (response.status !== 200) throw new Error(`建文件夹失败：${response.status}`);
  return id;
}

async function trashFolder(cookie: string, id: string): Promise<void> {
  const response = await SELF.fetch(`${ORIGIN}/api/folders/${id}`, {
    method: "DELETE",
    headers: headers(cookie),
  });
  if (response.status !== 200) throw new Error(`软删文件夹失败：${response.status}`);
}

async function permanentDelete(cookie: string, ids: string[]): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/trash/permanent`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({ ids }),
  });
}

async function emptyTrashRequest(cookie: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/trash/empty`, {
    method: "POST",
    headers: headers(cookie),
    body: "{}",
  });
}

beforeEach(async () => {
  await freshDatabase();
});

describe("文件夹的永久删除与清空", () => {
  it("永久删除文件夹：删 `folders` 行 + 写 `entity='folder'` 墓碑", async () => {
    const user = await registerUser("Alice", nextDevice());
    await openRegistration(user.cookie);
    const folderId = await createFolder(user.cookie, "要删的文件夹");
    await trashFolder(user.cookie, folderId);

    const response = await permanentDelete(user.cookie, [folderId]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { deleted: number; sync_seq: number };
    expect(body.deleted).toBe(1);

    const tombstone = await env.DB.prepare(
      "SELECT entity, sync_seq FROM tombstones WHERE user_id = ? AND entity_id = ?",
    )
      .bind(user.id, folderId)
      .first<{ entity: string; sync_seq: number }>();
    expect(tombstone?.entity).toBe("folder");
    expect(tombstone?.sync_seq).toBe(body.sync_seq);

    expect(
      await env.DB.prepare("SELECT 1 AS x FROM folders WHERE id = ?").bind(folderId).first(),
    ).toBeNull();
  });

  it("条目与文件夹混在同一批：各写各的墓碑、**共用同一个 `sync_seq`**", async () => {
    const user = await registerUser("Alice", nextDevice());
    await openRegistration(user.cookie);
    const noteId = await createNote(user.cookie, "甲");
    const folderId = await createFolder(user.cookie, "夹");
    await SELF.fetch(`${ORIGIN}/api/items/${noteId}`, {
      method: "DELETE",
      headers: headers(user.cookie),
    });
    await trashFolder(user.cookie, folderId);

    const response = await permanentDelete(user.cookie, [noteId, folderId]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { deleted: number; sync_seq: number };
    expect(body.deleted).toBe(2);

    const rows = await env.DB.prepare(
      "SELECT entity, sync_seq FROM tombstones WHERE user_id = ? ORDER BY entity",
    )
      .bind(user.id)
      .all<{ entity: string; sync_seq: number }>();
    expect(rows.results.map((row) => row.entity)).toEqual(["folder", "item"]);
    expect(new Set(rows.results.map((row) => row.sync_seq))).toEqual(new Set([body.sync_seq]));
  });

  it("清空回收站也清文件夹（两类实体各取各的批）", async () => {
    const user = await registerUser("Alice", nextDevice());
    await openRegistration(user.cookie);
    const noteId = await createNote(user.cookie, "条目");
    const folderId = await createFolder(user.cookie, "文件夹");
    await SELF.fetch(`${ORIGIN}/api/items/${noteId}`, {
      method: "DELETE",
      headers: headers(user.cookie),
    });
    await trashFolder(user.cookie, folderId);

    const response = await emptyTrashRequest(user.cookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { deleted: number };
    expect(body.deleted).toBe(2);

    expect(
      await env.DB.prepare("SELECT 1 AS x FROM items WHERE id = ?").bind(noteId).first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT 1 AS x FROM folders WHERE id = ?").bind(folderId).first(),
    ).toBeNull();
    const byEntity = await env.DB.prepare(
      "SELECT entity, COUNT(*) AS n FROM tombstones WHERE user_id = ? GROUP BY entity ORDER BY entity",
    )
      .bind(user.id)
      .all<{ entity: string; n: number }>();
    expect(byEntity.results.map((row) => `${row.entity}:${row.n}`)).toEqual(["folder:1", "item:1"]);
  });
});

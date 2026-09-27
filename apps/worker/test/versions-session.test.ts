/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * `session` 封存触发（《M4 设计》§4.1；服务端在保存正文时自动判定）。
 *
 * 走真路由（`PUT /api/items/:id/body`）而不是直接打服务层：这一条的关键就在**请求带的设备头**与
 * **条目上记录的 `last_edit_at` / `last_device`** 的比对，HTTP 这条线才是它的真实入口。
 * 桶用 miniflare 的真实 R2（封存要写正文快照）。
 *
 * 四种情形：换设备 → 封；同设备且 1 小时内 → 不封；同设备但距上次编辑超 1 小时 → 封；
 * 还没有正文的条目 → 不封空版本。另外顺带盯住"冲突（409）不白封一条"。
 */
import {
  ITEM_BASE_REV_HEADER,
  ITEM_DEVICE_HEADER,
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
const HOUR_MS = 60 * 60 * 1000;
const DEVICE_A = "web-a";
const DEVICE_B = "web-b";

async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
    body: JSON.stringify({ username, login_key: base64UrlEncode(bytes) }),
  });
  if (!res.ok) throw new Error(`注册失败：${res.status} ${await res.text()}`);
  const cookie = ((res.headers.get("set-cookie") ?? "").split(";")[0] ?? "").trim();
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
  const body = (await me.json()) as { id: string };
  return { cookie, id: body.id };
}

/** 新建一条笔记，并把设备头写进 `items.last_device` */
async function createNote(
  cookie: string,
  id: string,
  body: string,
  device: string,
): Promise<Response> {
  const meta: ItemWriteMeta = {
    type: "note",
    title: "会话用例",
    folder_id: null,
    tags: [],
    memo_at: null,
    is_task: 0,
    task_status: null,
    task_due: null,
    task_priority: null,
    content_hash: await contentHash(body),
  };
  return SELF.fetch(`${ORIGIN}/api/items/${id}`, {
    method: "PUT",
    headers: headers(cookie, {
      [ITEM_META_HEADER]: encodeItemWriteMeta(meta),
      [ITEM_DEVICE_HEADER]: device,
    }),
    body,
  });
}

/** 保存正文（`If-Match` + `X-Menote-Hash` + 设备头，与真实客户端一致） */
async function saveBody(
  cookie: string,
  id: string,
  baseRev: number,
  body: string,
  device: string,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/items/${id}/body`, {
    method: "PUT",
    headers: headers(cookie, {
      [ITEM_BASE_REV_HEADER]: String(baseRev),
      [ITEM_HASH_HEADER]: await contentHash(body),
      [ITEM_DEVICE_HEADER]: device,
    }),
    body,
  });
}

interface VersionRow {
  id: string;
  rev: number;
  reason: string;
  label: string | null;
  keep: number;
  content_hash: string;
}

/** 该条目的版本列表（新的在前）；服务端返回的 `created_at` 不参与断言 */
async function versionsOf(cookie: string, id: string): Promise<VersionRow[]> {
  const res = await SELF.fetch(`${ORIGIN}/api/items/${id}/versions`, {
    headers: { Cookie: cookie },
  });
  if (res.status !== 200) throw new Error(`取版本列表失败：${res.status}`);
  const page = (await res.json()) as { versions: VersionRow[] };
  return page.versions;
}

async function sessionVersions(cookie: string, id: string): Promise<VersionRow[]> {
  return (await versionsOf(cookie, id)).filter((version) => version.reason === "session");
}

async function storedBody(id: string): Promise<string> {
  const row = await env.DB.prepare("SELECT body FROM item_bodies WHERE item_id = ?")
    .bind(id)
    .first<{ body: string }>();
  return row?.body ?? "";
}

beforeEach(async () => {
  await freshDatabase();
});

describe("session 封存触发", () => {
  it("换设备保存：先封旧正文为 session 版本，再写入新正文", async () => {
    const user = await registerUser("Alice", 1);
    const id = newUlid();
    const oldBody = "第一段会话写的";
    const newBody = "换台设备接着写";

    expect((await createNote(user.cookie, id, oldBody, DEVICE_A)).status).toBe(200);

    const saved = await saveBody(user.cookie, id, 1, newBody, DEVICE_B);
    expect(saved.status).toBe(200);

    const sessions = await sessionVersions(user.cookie, id);
    expect(sessions).toHaveLength(1);
    // 封的是**保存前**那一版：rev / content_hash 都是旧的，且不保留、无备注
    expect(sessions[0]?.rev).toBe(1);
    expect(sessions[0]?.content_hash).toBe(await contentHash(oldBody));
    expect(sessions[0]?.keep).toBe(0);
    expect(sessions[0]?.label).toBeNull();
    // 正文快照里是旧正文（不是这次要写的新正文）
    const snapshot = await SELF.fetch(`${ORIGIN}/api/versions/${sessions[0]?.id ?? ""}`, {
      headers: { Cookie: user.cookie },
    });
    expect(snapshot.status).toBe(200);
    expect(((await snapshot.json()) as { body: string }).body).toBe(oldBody);
    // 当前稿是新正文
    expect(await storedBody(id)).toBe(newBody);

    // 同一台新设备继续改：已经不"换设备"了，不再封
    expect((await saveBody(user.cookie, id, 2, "同一台设备继续", DEVICE_B)).status).toBe(200);
    expect(await sessionVersions(user.cookie, id)).toHaveLength(1);

    // 冲突（409）不白封：判定在预检之后，基版本不匹配时连封存都不会发生
    const conflict = await saveBody(user.cookie, id, 1, "基于过期版本", "web-c");
    expect(conflict.status).toBe(409);
    expect(await sessionVersions(user.cookie, id)).toHaveLength(1);
  });

  it("同设备、1 小时内连续保存：不产生 session 版本", async () => {
    const user = await registerUser("Alice", 1);
    const id = newUlid();

    expect((await createNote(user.cookie, id, "开头", DEVICE_A)).status).toBe(200);
    expect((await saveBody(user.cookie, id, 1, "紧接着改", DEVICE_A)).status).toBe(200);
    expect((await saveBody(user.cookie, id, 2, "还在同一段会话里", DEVICE_A)).status).toBe(200);

    expect(await sessionVersions(user.cookie, id)).toHaveLength(0);
    expect(await versionsOf(user.cookie, id)).toHaveLength(0);
    expect(await storedBody(id)).toBe("还在同一段会话里");
  });

  it("同设备、距上次编辑超过 1 小时：产生一条 session 版本", async () => {
    const user = await registerUser("Alice", 1);
    const id = newUlid();

    expect((await createNote(user.cookie, id, "一小时前写的", DEVICE_A)).status).toBe(200);
    // 把"上次编辑"推到 2 小时前（真实场景是用户离开了一会儿再回来）
    await env.DB.prepare("UPDATE items SET last_edit_at = ? WHERE id = ?")
      .bind(Date.now() - 2 * HOUR_MS, id)
      .run();

    expect((await saveBody(user.cookie, id, 1, "两小时后回来再写", DEVICE_A)).status).toBe(200);

    const sessions = await sessionVersions(user.cookie, id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.content_hash).toBe(await contentHash("一小时前写的"));

    // 保存本身把 last_edit_at 刷新成"现在"，所以紧接着再存不会又封一条
    expect((await saveBody(user.cookie, id, 2, "紧接着再改一行", DEVICE_A)).status).toBe(200);
    expect(await sessionVersions(user.cookie, id)).toHaveLength(1);
  });

  it("还没有正文的条目（刚建 / 正文行缺失）不产生空版本", async () => {
    const user = await registerUser("Alice", 1);
    const id = newUlid();

    expect((await createNote(user.cookie, id, "正文先没了", DEVICE_A)).status).toBe(200);
    // 造出"条目在、正文行不在"的状态：内连接查不出旧正文，就没有可封的东西
    await env.DB.prepare("DELETE FROM item_bodies WHERE item_id = ?").bind(id).run();

    expect((await saveBody(user.cookie, id, 1, "换设备补上正文", DEVICE_B)).status).toBe(200);
    expect(await sessionVersions(user.cookie, id)).toHaveLength(0);
    expect(await storedBody(id)).toBe("换设备补上正文");
  });

  it("批量端点的 save_body 也走同一判定（离线队列攒下的改动一样封得住）", async () => {
    const user = await registerUser("Alice", 1);
    const id = newUlid();
    const oldBody = "离线队列里的旧稿";

    expect((await createNote(user.cookie, id, oldBody, DEVICE_A)).status).toBe(200);

    const response = await SELF.fetch(`${ORIGIN}/api/batch`, {
      method: "POST",
      headers: headers(user.cookie, { [ITEM_DEVICE_HEADER]: DEVICE_B }),
      body: JSON.stringify({
        ops: [
          {
            kind: "save_body",
            id,
            base_rev: 1,
            content_hash: await contentHash("另一台设备补传"),
            body: "另一台设备补传",
          },
        ],
      }),
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { results: { ok: boolean }[] }).results[0]?.ok).toBe(true);

    const sessions = await sessionVersions(user.cookie, id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.content_hash).toBe(await contentHash(oldBody));
  });
});

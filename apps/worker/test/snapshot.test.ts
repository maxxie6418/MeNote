/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 快照物化（M7 第 4 项 批 2；架构 §12.4 / §7.3）。
 *
 * 这组用例盯的是**四条很容易"看起来在跑、其实没做事"**的口径：
 *
 * 1. **普通条目出站是明文、隐私条目出站是信封**——两条都断言。只断言"有加密"的话，
 *    一个把所有条目都加密的实现也能过；只断言"没加密"的话，隐私条目明文出站也能过。
 * 2. **信封真的能解回原文**。这是"真加密"与"把字节搅乱"的区别：不信实现，
 *    用 K 独立解一遍，拿回原文才算数。
 * 3. **`COMPLETE` 与 manifest 哈希对得上**——直接用 `verifySnapshot` 整包校验，
 *    它是 M5 已在用的那个函数（半截包被当完整包是最糟的失败方式）。
 * 4. **没东西变时一个字节都不写**；改了之后**只写变化的那条**。
 *    "物化是增量的"这条不钉住，就会退回每轮全量——一天 4.8 万次 R2 写。
 */
import {
  ENVELOPE_MAGIC,
  ENVELOPE_OVERHEAD_BYTES,
  ITEM_BASE_REV_HEADER,
  ITEM_HASH_HEADER,
  ITEM_META_HEADER,
  base64UrlEncode,
  completePath,
  encodeItemWriteMeta,
  manifestPath,
  newUlid,
  notePath,
  parseBackupEnvelope,
  verifySnapshot,
  type ItemWriteMeta,
} from "@menote/shared";
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { materializeSnapshot, SNAP_PREFIX } from "../src/jobs/snapshot";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";
const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);

/** 条目 id 必须是**真 ULID**（服务端会拒编出来的 id）；固定两个，断言路径时好写 */
const PLAIN_ID = newUlid();
const PRIVATE_ID = newUlid();

async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function loginKey(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return base64UrlEncode(bytes);
}

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
  const cookie = ((res.headers.get("set-cookie") ?? "").split(";")[0] ?? "").trim();
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
  return { cookie, id: ((await me.json()) as { id: string }).id };
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
    headers: headers(cookie, {
      [ITEM_META_HEADER]: encodeItemWriteMeta(meta),
      [ITEM_HASH_HEADER]: meta.content_hash ?? "",
    }),
    body,
  });
}

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

const bucket = (): R2Bucket => env.ATTACHMENTS as R2Bucket;

async function readKey(userId: string): Promise<string> {
  const res = await SELF.fetch(`${ORIGIN}/api/crypto/reset`, {
    method: "POST",
    headers: { "X-Menote": "1", Origin: ORIGIN, Cookie: await cookieFor(userId) },
  });
  if (res.status !== 200) throw new Error(`取内容密钥失败：${res.status}`);
  return ((await res.json()) as { k: string }).k;
}

const cookies = new Map<string, string>();
function remember(userId: string, cookie: string): void {
  cookies.set(userId, cookie);
}
async function cookieFor(userId: string): Promise<string> {
  const cookie = cookies.get(userId);
  if (!cookie) throw new Error("测试内部错误：没有这个用户的会话");
  return cookie;
}

async function readObject(userId: string, path: string): Promise<Uint8Array> {
  const object = await bucket().get(`${SNAP_PREFIX}/${userId}/${path}`);
  if (!object) throw new Error(`R2 里没有 ${path}`);
  return new Uint8Array(await object.arrayBuffer());
}

/** 改正文要走 `/body` 端点（`PUT /api/items/:id` 是**新建**、重复提交幂等） */
async function updateBody(cookie: string, id: string, body: string, baseRev: number): Promise<void> {
  const res = await SELF.fetch(`${ORIGIN}/api/items/${id}/body`, {
    method: "PUT",
    headers: headers(cookie, {
      [ITEM_BASE_REV_HEADER]: String(baseRev),
      [ITEM_HASH_HEADER]: await contentHash(body),
    }),
    body,
  });
  if (res.status !== 200) {
    throw new Error(`改正文失败：${res.status} ${await res.text()}`);
  }
}

/** 把一个条目加上单篇加密标记（`base_meta_rev` 是必填的乐观锁） */
async function markEncSelf(cookie: string, id: string): Promise<void> {
  const res = await SELF.fetch(`${ORIGIN}/api/items/${id}/meta`, {
    method: "PATCH",
    headers: headers(cookie),
    body: JSON.stringify({ base_meta_rev: 1, enc_self: 1 }),
  });
  if (res.status !== 200) throw new Error(`设单篇加密失败：${res.status} ${await res.text()}`);
}

beforeEach(async () => {
  cookies.clear();
  await freshDatabase();
});

describe("快照物化 · 基本落点", () => {
  it("写入 manifest + COMPLETE，且 verifySnapshot 整包校验通过", async () => {
    const { cookie, id } = await registerUser("owner", 1);
    remember(id, cookie);
    await createItem(cookie, PLAIN_ID, "# 一篇笔记\n正文在这里。");

    const result = await materializeSnapshot(env, id, NOW);
    expect(result.skipped).toBeUndefined();
    expect(result.items).toBe(1);

    const complete = new TextDecoder().decode(await readObject(id, completePath()));
    const manifestText = new TextDecoder().decode(await readObject(id, manifestPath()));
    const manifest = await verifySnapshot({ completeText: complete, manifestText });
    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0]?.id).toBe(PLAIN_ID);
    // 附件数组为空：**不声称自己没有存的东西**（理由见 jobs/snapshot.ts 文件头第 3 条）
    expect(manifest.attachments).toEqual([]);
    expect(manifest.include_trashed).toBe(true);
  });

  it("普通条目的文件就是正文原样（明文出站）", async () => {
    const { cookie, id } = await registerUser("owner", 1);
    remember(id, cookie);
    const body = "# 明文笔记\n这一行必须能被直接读到。";
    await createItem(cookie, PLAIN_ID, body);

    await materializeSnapshot(env, id, NOW);
    const bytes = await readObject(id, notePath(PLAIN_ID));
    expect(new TextDecoder().decode(bytes)).toBe(body);
  });

  it("没绑对象存储时如实说跳过，不假装跑过", async () => {
    const { id } = await registerUser("owner", 1);
    const result = await materializeSnapshot(
      { DB: env.DB, ATTACHMENTS: undefined, AUTH_PEPPER: env.AUTH_PEPPER as string },
      id,
      NOW,
    );
    expect(result.skipped).toContain("未绑定对象存储");
    expect(result.files).toBe(0);
  });
});

describe("快照物化 · 出站加密（架构 §7.3）", () => {
  it("隐私条目出站是信封，普通条目仍是明文（两条都断言）", async () => {
    const { cookie, id } = await registerUser("owner", 1);
    remember(id, cookie);
    await enablePrivacy(cookie);
    await createItem(cookie, PLAIN_ID, "普通条目：这行应当明文。");
    await createItem(cookie, PRIVATE_ID, "隐私条目：绝不能明文出站。");
    await markEncSelf(cookie, PRIVATE_ID);

    const result = await materializeSnapshot(env, id, NOW);
    expect(result.encrypted).toBe(1);

    const plain = new TextDecoder().decode(await readObject(id, notePath(PLAIN_ID)));
    expect(plain).toContain("应当明文");

    const sealedBytes = await readObject(id, notePath(PRIVATE_ID));
    // ① 文本里读不出原文
    expect(new TextDecoder().decode(sealedBytes)).not.toContain("绝不能明文出站");
    // ② 真的是信封：魔数 + 固定开销
    expect([...sealedBytes.slice(0, 8)]).toEqual([...ENVELOPE_MAGIC]);
    expect(sealedBytes.byteLength).toBeGreaterThan(ENVELOPE_OVERHEAD_BYTES);
  });

  it("信封能被独立解回原文（真加密，不是把字节搅乱）", async () => {
    const { cookie, id } = await registerUser("owner", 1);
    remember(id, cookie);
    await enablePrivacy(cookie);
    const secret = "隐私条目：这一句必须能被解回来。";
    await createItem(cookie, PRIVATE_ID, secret);
    await markEncSelf(cookie, PRIVATE_ID);

    await materializeSnapshot(env, id, NOW);
    const bytes = await readObject(id, notePath(PRIVATE_ID));
    const parts = parseBackupEnvelope(bytes);

    // **不信实现**：自己去 `/api/crypto/reset` 拿 K，独立解一遍
    const rawK = base64UrlToBytes(await readKey(id));
    const key = await crypto.subtle.importKey("raw", rawK, { name: "AES-GCM" }, false, ["decrypt"]);
    const payload = new Uint8Array(parts.contentCiphertext.length + parts.contentTag.length);
    payload.set(parts.contentCiphertext, 0);
    payload.set(parts.contentTag, parts.contentCiphertext.length);
    const opened = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: parts.contentIv, tagLength: 128 }, key, payload),
    );
    expect(new TextDecoder().decode(opened)).toBe(secret);
    expect(parts.kdfIterations).toBe(600_000);
  });

  it("同一份正文两次物化的信封不同（内容 IV 每次现生成）", async () => {
    const { cookie, id } = await registerUser("owner", 1);
    remember(id, cookie);
    await enablePrivacy(cookie);
    await createItem(cookie, PRIVATE_ID, "同一句");
    await markEncSelf(cookie, PRIVATE_ID);

    await materializeSnapshot(env, id, NOW);
    const first = await readObject(id, notePath(PRIVATE_ID));
    // 改正文让 sync_seq 前进 → 重新物化。**base_rev 随每次保存 +1**
    await updateBody(cookie, PRIVATE_ID, "换一句", 1);
    await updateBody(cookie, PRIVATE_ID, "同一句", 2);
    await materializeSnapshot(env, id, NOW + 1000);
    const second = await readObject(id, notePath(PRIVATE_ID));

    // 内容 IV 每次现生成 → 同一份明文两次封出的信封不同
    expect([...first]).not.toEqual([...second]);
    expect(parseBackupEnvelope(first).contentIv).not.toEqual(parseBackupEnvelope(second).contentIv);
  });
});

describe("快照物化 · 增量", () => {
  it("没东西变时一个字节都不写（连 manifest 都不重写）", async () => {
    const { cookie, id } = await registerUser("owner", 1);
    remember(id, cookie);
    await createItem(cookie, PLAIN_ID, "一次就够");

    const first = await materializeSnapshot(env, id, NOW);
    expect(first.items).toBe(1);
    const before = await bucket().head(`${SNAP_PREFIX}/${id}/${manifestPath()}`);

    const second = await materializeSnapshot(env, id, NOW + 60_000);
    expect(second.items).toBe(0);
    expect(second.files).toBe(0);
    const after = await bucket().head(`${SNAP_PREFIX}/${id}/${manifestPath()}`);
    // uploaded 时间戳不变 = 真的没重写
    expect(after?.uploaded.getTime()).toBe(before?.uploaded.getTime());
  });

  it("改了哪条就只写哪条，游标跟着前进", async () => {
    const { cookie, id } = await registerUser("owner", 1);
    remember(id, cookie);
    await createItem(cookie, PLAIN_ID, "第一条");
    await createItem(cookie, PRIVATE_ID, "第二条");
    await materializeSnapshot(env, id, NOW);

    await updateBody(cookie, PRIVATE_ID, "第二条改过了", 1);
    const result = await materializeSnapshot(env, id, NOW + 60_000);
    expect(result.items).toBe(1);

    const text = new TextDecoder().decode(await readObject(id, notePath(PRIVATE_ID)));
    expect(text).toBe("第二条改过了");
  });

  it("单轮文件配额生效：超出部分留到下一轮", async () => {
    const { cookie, id } = await registerUser("owner", 1);
    remember(id, cookie);
    for (let i = 0; i < 5; i += 1) {
      await createItem(cookie, newUlid(), `第 ${i} 条`);
    }
    const first = await materializeSnapshot(env, id, NOW, 2);
    expect(first.items).toBe(2);
    const second = await materializeSnapshot(env, id, NOW + 1000, 2);
    expect(second.items).toBe(2);
  });
});

/** base64url 文本 → 字节（`cryptoBlobFromBase64Url` 在别处已有，这里只测这一处用得上） */
function base64UrlToBytes(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

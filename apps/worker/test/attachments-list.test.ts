/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 附件列表接口 `GET /api/attachments`（M6 批 2c；M4 只给了 check/blob/finalize/h/refs/gc）。
 *
 * 这个接口是**附件管理页唯一的读入口**，所以盯住的是四件容易错的事：
 * 1. **只列本用户**——这份列表是直接可枚举的元数据，漏一个 `user_id` 就是跨租户泄漏（红线）；
 * 2. **过滤真的生效**——`kind` / `state` 拼错时按"不过滤"处理，但拼对时必须筛出对的那批；
 * 3. **引用条目数按 `item_id` 去重**——同一个条目可以同时有「当前稿引用」和「某个封存版本的引用」，
 *    那在界面上仍然是「被 1 条笔记引用」，数成 2 会让人以为附件被复用了；
 * 4. **`has_more` 与 `limit` 对得上**——按 `limit + 1` 多取一行判定，契约以后加分页不用改形状。
 *
 * 单列一个文件的实操原因同 `attachment-refs.test.ts`：`attachments.test.ts` 已贴着 500 行的
 * ESLint 预算（架构 §2.3.3）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import { base64UrlEncodeUtf8, newUlid, sha256Hex } from "@menote/shared";
import { SQL_INSERT_ATTACHMENT_REF, SQL_UPSERT_ITEM_BODY } from "../src/db/tables";
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

let seed = 60;
async function registerUser(username: string): Promise<{ cookie: string; id: string }> {
  seed += 1;
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: headers(""),
    body: JSON.stringify({ username, login_key: base64UrlEncodeUtf8(String.fromCharCode(...bytes)) }),
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: headers(cookie) });
  const { id } = (await me.json()) as { id: string };
  return { cookie, id };
}

/** 第二个及以后的账号要先开注册（首位注册者即 owner，注册默认关） */
async function openRegistration(cookie: string): Promise<void> {
  await SELF.fetch(`${ORIGIN}/api/admin/registration`, {
    method: "PUT",
    headers: headers(cookie),
    body: JSON.stringify({ open: true }),
  });
}

/** 造一个"哈希对得上"的假文件（内容随便，哈希由测试给） */
function fakeSha(seedText: string): string {
  return seedText.repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, "a");
}

/** 上传 + finalize（含缩略图时多落一行）；给了 `itemId` 就挂一条「当前稿引用」 */
async function upload(
  cookie: string,
  input: {
    sha256: string;
    filename: string;
    size?: number;
    width?: number | null;
    itemId?: string | null;
    thumb?: boolean;
  },
): Promise<{ attachmentId: string; thumbId: string | null }> {
  const size = input.size ?? 3;
  const put = async (kind: string, payload: Uint8Array): Promise<void> => {
    const res = await SELF.fetch(
      `${ORIGIN}/api/attachments/blob?sha256=${input.sha256}&kind=${kind}`,
      { method: "PUT", headers: headers(cookie, { "Content-Type": "image/png" }), body: payload },
    );
    expect(res.status).toBe(200);
  };
  await put("original", new Uint8Array(size));
  if (input.thumb) await put("thumb", new Uint8Array([9]));

  const res = await SELF.fetch(`${ORIGIN}/api/attachments/finalize`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({
      sha256: input.sha256,
      size,
      mime: "image/png",
      width: input.width ?? 10,
      height: 20,
      filename: input.filename,
      itemId: input.itemId ?? null,
      thumb: input.thumb ? { size: 1, mime: "image/webp", width: 4, height: 4 } : null,
    }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { attachmentId: string; thumbId: string | null };
}

/** 直接落库造一条条目（只需要 `items` 行能被 `attachment_refs` 指向） */
async function insertItem(userId: string, id: string): Promise<void> {
  const body = `样例 ${id}`;
  const hash = await sha256Hex(body);
  await env.DB.prepare(
    `INSERT INTO items (id, user_id, type, title, enc_self, in_enc_space, size_bytes, content_hash, tags, is_task, pinned, starred, rev, meta_rev, sync_seq, created_at, updated_at)
     VALUES (?, ?, 'note', '列表样例', 0, 0, ?, ?, '[]', 0, 0, 0, 1, 1, 1, 1, 1)`,
  )
    .bind(id, userId, body.length, hash)
    .run();
  await env.DB.prepare(SQL_UPSERT_ITEM_BODY).bind(id, body, id, userId, 1, hash).run();
}

interface ListBody {
  attachments: Array<{
    id: string;
    sha256: string;
    kind: "original" | "thumb";
    filename: string | null;
    mime: string | null;
    size_bytes: number;
    width: number | null;
    height: number | null;
    created_at: number;
    updated_at: number;
    orphaned_at: number | null;
    ref_count: number;
  }>;
  has_more: boolean;
}

async function list(cookie: string, query = ""): Promise<ListBody> {
  const res = await SELF.fetch(`${ORIGIN}/api/attachments${query}`, {
    headers: headers(cookie),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ListBody;
}

beforeEach(async () => {
  await freshDatabase();
});

describe("租户隔离", () => {
  it("只列本用户的附件（跨租户不泄漏）", async () => {
    const alice = await registerUser("Alice");
    await openRegistration(alice.cookie);
    const bob = await registerUser("Bob");

    await upload(alice.cookie, { sha256: fakeSha("a1"), filename: "alice-1.png" });
    await upload(alice.cookie, { sha256: fakeSha("a2"), filename: "alice-2.png" });
    await upload(bob.cookie, { sha256: fakeSha("b1"), filename: "bob-1.png" });

    const aliceView = await list(alice.cookie);
    const bobView = await list(bob.cookie);

    // 同毫秒上传的两行 `updated_at` 会撞在一起，这里只关心**成员**不关心顺序（顺序另有一条用例）
    expect(aliceView.attachments.map((row) => row.filename).sort()).toEqual([
      "alice-1.png",
      "alice-2.png",
    ]);
    expect(bobView.attachments.map((row) => row.filename)).toEqual(["bob-1.png"]);
  });

  it("未登录 401", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/attachments`);
    expect(res.status).toBe(401);
  });
});

describe("过滤", () => {
  it("kind 过滤：只回原图或只回缩略图；省掉就两类都给", async () => {
    const user = await registerUser("Alice");
    await upload(user.cookie, { sha256: fakeSha("k1"), filename: "one.png", thumb: true });

    const all = await list(user.cookie);
    expect(all.attachments).toHaveLength(2);

    const originals = await list(user.cookie, "?kind=original");
    expect(originals.attachments).toHaveLength(1);
    expect(originals.attachments[0]?.kind).toBe("original");

    const thumbs = await list(user.cookie, "?kind=thumb");
    expect(thumbs.attachments).toHaveLength(1);
    expect(thumbs.attachments[0]?.kind).toBe("thumb");
    // 缩略图沿用原图的哈希：拿到的是同一份内容的派生行
    expect(thumbs.attachments[0]?.sha256).toBe(fakeSha("k1"));
  });

  it("state 过滤：active / orphaned 各回各的；省掉就两类都给", async () => {
    const user = await registerUser("Alice");
    await upload(user.cookie, { sha256: fakeSha("s1"), filename: "used.png" });
    await upload(user.cookie, { sha256: fakeSha("s2"), filename: "free.png" });

    // 手工标一个孤儿（与 `POST /api/attachments/gc` 的标记同一条语句的等价效果）
    await env.DB.prepare(
      "UPDATE attachments SET orphaned_at = 111 WHERE user_id = ? AND sha256 = ?",
    )
      .bind(user.id, fakeSha("s2"))
      .run();

    const active = await list(user.cookie, "?state=active");
    expect(active.attachments.map((row) => row.sha256)).toEqual([fakeSha("s1")]);

    const orphaned = await list(user.cookie, "?state=orphaned");
    expect(orphaned.attachments).toHaveLength(1);
    expect(orphaned.attachments[0]?.filename).toBe("free.png");
    expect(orphaned.attachments[0]?.orphaned_at).toBe(111);

    // 两个过滤能叠加：state 限定之后 kind 仍然生效
    const both = await list(user.cookie, "?state=orphaned&kind=thumb");
    expect(both.attachments).toHaveLength(0);
  });
});

describe("limit 与 has_more", () => {
  it("按 limit 截断，多出来的那行只用来判定 has_more（不进响应）", async () => {
    const user = await registerUser("Alice");
    for (const name of ["a.png", "b.png", "c.png"]) {
      await upload(user.cookie, { sha256: fakeSha(name), filename: name });
    }

    const two = await list(user.cookie, "?limit=2");
    expect(two.attachments).toHaveLength(2);
    expect(two.has_more).toBe(true);

    const exact = await list(user.cookie, "?limit=3");
    expect(exact.attachments).toHaveLength(3);
    expect(exact.has_more).toBe(false);

    // 越界 / 非法值不报错：截到上限或退回默认
    const huge = await list(user.cookie, "?limit=9999");
    expect(huge.attachments).toHaveLength(3);
    expect(huge.has_more).toBe(false);

    const broken = await list(user.cookie, "?limit=abc&kind=nope&state=nope");
    expect(broken.attachments).toHaveLength(3);
  });
});

describe("引用条目数与排序", () => {
  it("ref_count 数的是**条目数**：两条目引用同一个附件 → 2", async () => {
    const user = await registerUser("Alice");
    const one = newUlid();
    const two = newUlid();
    await insertItem(user.id, one);
    await insertItem(user.id, two);

    const shared = await upload(user.cookie, { sha256: fakeSha("r1"), filename: "shared.png" });
    await upload(user.cookie, { sha256: fakeSha("r2"), filename: "lonely.png" });

    // 直接写引用行：本组用例要盯的是**计数语句**，不是上报链路（那是 attachment-refs.test.ts 的活）
    for (const itemId of [one, two]) {
      await env.DB.prepare(SQL_INSERT_ATTACHMENT_REF).bind(itemId, null, shared.attachmentId, 1).run();
    }
    // 同一个条目的两条引用（当前稿 + 一个封存版本）在界面上仍然只是「1 条笔记」
    await env.DB.prepare(SQL_INSERT_ATTACHMENT_REF)
      .bind(one, newUlid(), shared.attachmentId, 1)
      .run();

    const body = await list(user.cookie);
    const byName = new Map(body.attachments.map((row) => [row.filename, row.ref_count]));
    expect(byName.get("shared.png")).toBe(2);
    expect(byName.get("lonely.png")).toBe(0);
  });

  it("按 updated_at 倒序（最新的在最前）", async () => {
    const user = await registerUser("Alice");
    // 哈希种子必须是**互不相同**的十六进制串：`fakeSha` 会把非十六进制字符一律换成 "a"，
    // 用文件名当种子的话 "old.png" 与 "mid.png" 会算出同一个哈希，被去重挡掉一条
    const stamps: ReadonlyArray<[string, string, number]> = [
      ["1a", "old.png", 1000],
      ["2b", "mid.png", 2000],
      ["3c", "new.png", 3000],
    ];
    for (const [seedText, filename] of stamps) {
      await upload(user.cookie, { sha256: fakeSha(seedText), filename });
    }
    // 同一批上传的 updated_at 会撞在一起，手工拉开才有可断言的顺序
    for (const [, filename, at] of stamps) {
      await env.DB.prepare("UPDATE attachments SET updated_at = ? WHERE user_id = ? AND filename = ?")
        .bind(at, user.id, filename)
        .run();
    }

    const body = await list(user.cookie);
    expect(body.attachments.map((row) => row.filename)).toEqual([
      "new.png",
      "mid.png",
      "old.png",
    ]);
  });

  it("字段齐全：文件名 / 类型 / 尺寸 / 字节数 / 时间戳都回给界面", async () => {
    const user = await registerUser("Alice");
    const itemId = newUlid();
    await insertItem(user.id, itemId);
    const sha = fakeSha("f1");
    await upload(user.cookie, { sha256: sha, filename: "字段.png", size: 1234, itemId });

    const row = (await list(user.cookie)).attachments[0];
    expect(row).toMatchObject({
      sha256: sha,
      kind: "original",
      filename: "字段.png",
      mime: "image/png",
      size_bytes: 1234,
      width: 10,
      height: 20,
      orphaned_at: null,
      ref_count: 1,
    });
    expect(row?.created_at).toBeGreaterThan(0);
    expect(row?.updated_at).toBeGreaterThan(0);
  });
});

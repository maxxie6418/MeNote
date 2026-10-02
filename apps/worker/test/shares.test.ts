/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 分享（M5-S1）的集成用例：管理侧四接口 + 访客侧四接口。
 *
 * 盯的是设计稿 §五的底线：
 * - 隐私条目 / 已删条目**当场拒创建**（同语句校验，changes = 0）；
 * - **实时失效**：撤销、过期、条目进回收站、条目被加密——任一命中，访客侧一律「链接已失效」；
 * - 密码只在浏览器派生（测试里用 WebCrypto 模拟访客那一步），服务端只比对校验值；
 * - 解锁连错 10 次按 `share:<sid>:<ip>` 限速；
 * - 公开附件只放行「当前稿正文里引用了」的哈希。
 */
import { base64UrlEncode, newUlid, sha256Hex, type ShareRecord } from "@menote/shared";
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { SQL_UPSERT_ITEM_BODY } from "../src/db/tables";
import { resetShareUnlockLimitForTests } from "../src/services/share-public";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";

function headers(cookie?: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Menote": "1",
    Origin: ORIGIN,
    ...(cookie ? { Cookie: cookie } : {}),
    ...extra,
  };
}

function loginKey(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return base64UrlEncode(bytes);
}

async function registerUser(username: string, seed: number): Promise<string> {
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ username, login_key: loginKey(seed) }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  return (setCookie.split(";")[0] ?? "").trim();
}

/** 第二个及以后的账号要先开注册（首位注册者即 owner，注册默认关） */
async function openRegistration(cookie: string): Promise<void> {
  await SELF.fetch(`${ORIGIN}/api/admin/registration`, {
    method: "PUT",
    headers: headers(cookie),
    body: JSON.stringify({ open: true }),
  });
}

async function insertItem(
  userId: string,
  id: string,
  body: string,
  overrides: { encSelf?: number; inEncSpace?: number; deleted?: boolean } = {},
): Promise<void> {
  const hash = await sha256Hex(body);
  const deletedColumn = overrides.deleted ? ", deleted_at" : "";
  const deletedValue = overrides.deleted ? ", 5" : "";
  await env.DB.prepare(
    `INSERT INTO items (id, user_id, type, title, enc_self, in_enc_space, size_bytes, content_hash, tags, is_task, pinned, starred, rev, meta_rev, sync_seq, created_at, updated_at${deletedColumn})
     VALUES (?, ?, 'note', '测试条目', ?, ?, ?, ?, '[]', 0, 0, 0, 1, 1, 1, 1, 1${deletedValue})`,
  )
    .bind(id, userId, overrides.encSelf ?? 0, overrides.inEncSpace ?? 0, body.length, hash)
    .run();
  await env.DB.prepare(SQL_UPSERT_ITEM_BODY).bind(id, body, id, userId, 1, hash).run();
}

/** 模拟「创建者浏览器」派生密码材料（与访客同参数；测试用 10 万次保速度，schema 下限） */
async function deriveVerifier(
  password: string,
  salt: Uint8Array,
): Promise<{ kdf: { alg: "PBKDF2-SHA256"; iterations: number }; salt: string; verifier: string }> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 },
    key,
    256,
  );
  return {
    kdf: { alg: "PBKDF2-SHA256", iterations: 100_000 },
    salt: base64UrlEncode(salt),
    verifier: base64UrlEncode(new Uint8Array(bits)),
  };
}

interface Created {
  cookie: string;
  itemId: string;
  record: ShareRecord;
}

/** 建号 + 建条目 + 创建无密码分享（大多数用例的起点） */
async function createShareForItem(
  username: string,
  seed: number,
  itemId: string,
  body = "# 标题\n\n正文",
  password?: { kdf: { alg: "PBKDF2-SHA256"; iterations: number }; salt: string; verifier: string },
): Promise<Created> {
  const cookie = await registerUser(username, seed);
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
  const { id: userId } = (await me.json()) as { id: string };
  await insertItem(userId, itemId, body);

  const res = await SELF.fetch(`${ORIGIN}/api/shares`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({ kind: "item", item_id: itemId, password: password ?? null }),
  });
  expect(res.status).toBe(201);
  return { cookie, itemId, record: (await res.json()) as ShareRecord };
}

beforeEach(async () => {
  await freshDatabase();
  resetShareUnlockLimitForTests();
});

describe("创建分享（管理侧）", () => {
  it("无密码分享：201、字段齐全、我的分享列表可见", async () => {
    const { cookie, itemId, record } = await createShareForItem("owner", 1, newUlid());
    expect(record.has_password).toBe(false);
    expect(record.item_id).toBe(itemId);
    expect(record.revoked_at).toBeNull();

    const list = await SELF.fetch(`${ORIGIN}/api/shares`, { headers: { Cookie: cookie } });
    const body = (await list.json()) as { shares: ShareRecord[] };
    expect(body.shares).toHaveLength(1);
    expect(body.shares[0]?.id).toBe(record.id);
  });

  it("单篇加密 / 加密空间内 / 已删条目：当场拒创建（同语句校验）", async () => {
    const cookie = await registerUser("owner2", 2);
    const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
    const { id: userId } = (await me.json()) as { id: string };

    for (const overrides of [
      { encSelf: 1 },
      { inEncSpace: 1 },
      { deleted: true },
    ]) {
      const itemId = newUlid();
      await insertItem(userId, itemId, "正文", overrides);
      const res = await SELF.fetch(`${ORIGIN}/api/shares`, {
        method: "POST",
        headers: headers(cookie),
        body: JSON.stringify({ kind: "item", item_id: itemId }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { detail?: { reason?: string } };
      expect(body.detail?.reason).toBe("item_not_shareable");
    }
  });
});

describe("访客侧：状态 / 解锁 / 正文", () => {
  it("无密码全链路：状态 ok → unlock 发令牌 → 带令牌取到原文", async () => {
    const { record } = await createShareForItem("visitor", 3, newUlid());

    const status = await (await SELF.fetch(`${ORIGIN}/api/public/shares/${record.id}`)).json();
    expect(status).toMatchObject({ status: "ok", requires_password: false });

    const unlock = await SELF.fetch(`${ORIGIN}/api/public/shares/${record.id}/unlock`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({}),
    });
    const unlocked = (await unlock.json()) as { status: string; token?: string };
    expect(unlocked.status).toBe("ok");
    expect(unlocked.token).toBeTruthy();

    const content = await SELF.fetch(`${ORIGIN}/api/public/shares/${record.id}/content`, {
      headers: { "X-Menote-Share": unlocked.token ?? "" },
    });
    expect(content.status).toBe(200);
    const body = (await content.json()) as { item: { body: string; title: string | null } };
    expect(body.item.body).toBe("# 标题\n\n正文");
    expect(body.item.title).toBe("测试条目");
  });

  it("不带 / 带伪造令牌取正文：一律 422，不给区分信息", async () => {
    const { record } = await createShareForItem("visitor2", 4, newUlid());
    const noToken = await SELF.fetch(`${ORIGIN}/api/public/shares/${record.id}/content`);
    expect(noToken.status).toBe(422);
    const badToken = await SELF.fetch(`${ORIGIN}/api/public/shares/${record.id}/content`, {
      headers: { "X-Menote-Share": `${record.id}.fake.sig` },
    });
    expect(badToken.status).toBe(422);
  });

  it("带密码分享：状态给盐与 KDF；错校验值 wrong_password；对的发令牌", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const password = await deriveVerifier("分享密码", salt);
    const { record } = await createShareForItem(
      "visitor3",
      5,
      newUlid(),
      "正文",
      password,
    );
    expect(record.has_password).toBe(true);

    const status = (await (
      await SELF.fetch(`${ORIGIN}/api/public/shares/${record.id}`)
    ).json()) as { requires_password: boolean; salt?: string };
    expect(status.requires_password).toBe(true);
    expect(status.salt).toBe(password.salt);

    const wrong = await SELF.fetch(`${ORIGIN}/api/public/shares/${record.id}/unlock`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ verifier: password.verifier.slice(0, -2) + "AA" }),
    });
    expect(((await wrong.json()) as { status: string }).status).toBe("wrong_password");

    const right = await SELF.fetch(`${ORIGIN}/api/public/shares/${record.id}/unlock`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ verifier: password.verifier }),
    });
    const unlocked = (await right.json()) as { status: string; token?: string };
    expect(unlocked.status).toBe("ok");
    expect(unlocked.token).toBeTruthy();
  });

  it("解锁连错 10 次后限速（share:<sid>:<ip>）", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const password = await deriveVerifier("另一次密码", salt);
    const { record } = await createShareForItem(
      "visitor4",
      6,
      newUlid(),
      "正文",
      password,
    );

    for (let index = 0; index < 10; index += 1) {
      const res = await SELF.fetch(`${ORIGIN}/api/public/shares/${record.id}/unlock`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ verifier: password.verifier.slice(0, -2) + "BB" }),
      });
      expect(((await res.json()) as { status: string }).status).toBe("wrong_password");
    }
    const limited = await SELF.fetch(`${ORIGIN}/api/public/shares/${record.id}/unlock`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ verifier: password.verifier }),
    });
    expect(limited.status).toBe(429);
  });
});

describe("实时失效（撤销 / 过期 / 回收站 / 加密）", () => {
  it("撤销后状态 invalid、unlock invalid、正文 422；撤销接口返回 revoked_at", async () => {
    const { cookie, record } = await createShareForItem("expire", 7, newUlid());

    const del = await SELF.fetch(`${ORIGIN}/api/shares/${record.id}`, {
      method: "DELETE",
      headers: headers(cookie),
    });
    const revoked = (await del.json()) as ShareRecord;
    expect(revoked.revoked_at).not.toBeNull();

    const status = (await (await SELF.fetch(`${ORIGIN}/api/public/shares/${record.id}`)).json()) as {
      status: string;
    };
    expect(status.status).toBe("invalid");
    const unlock = await SELF.fetch(`${ORIGIN}/api/public/shares/${record.id}/unlock`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({}),
    });
    expect(((await unlock.json()) as { status: string }).status).toBe("invalid");
  });

  it("过期与条目态变化都让链接失效（直接落库模拟时间与状态迁移）", async () => {
    // 过期
    const a = await createShareForItem("expire2", 8, newUlid());
    await env.DB.prepare("UPDATE shares SET expires_at = 1 WHERE id = ?").bind(a.record.id).run();
    const statusA = (await (
      await SELF.fetch(`${ORIGIN}/api/public/shares/${a.record.id}`)
    ).json()) as { status: string };
    expect(statusA.status).toBe("invalid");

    // 后两个账号要先开注册（注册默认关，首位注册者即 owner）
    await openRegistration(a.cookie);

    // 条目进回收站
    const b = await createShareForItem("expire3", 9, newUlid());
    await env.DB.prepare("UPDATE items SET deleted_at = 9 WHERE id = ?").bind(b.itemId).run();
    const statusB = (await (
      await SELF.fetch(`${ORIGIN}/api/public/shares/${b.record.id}`)
    ).json()) as { status: string };
    expect(statusB.status).toBe("invalid");

    // 条目被加密
    const c = await createShareForItem("expire4", 10, newUlid());
    await env.DB.prepare("UPDATE items SET enc_self = 1 WHERE id = ?").bind(c.itemId).run();
    const statusC = (await (
      await SELF.fetch(`${ORIGIN}/api/public/shares/${c.record.id}`)
    ).json()) as { status: string };
    expect(statusC.status).toBe("invalid");
  });
});

describe("公开附件", () => {
  it("只放行当前稿引用的哈希；引用且在桶里 → 200 原字节", async () => {
    const cookie = await registerUser("att-share", 11);
    const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
    const { id: userId } = (await me.json()) as { id: string };

    const bytes = new Uint8Array([7, 7, 7]);
    const sha = await sha256Hex(bytes);
    const itemId = newUlid();
    await insertItem(userId, itemId, `![](/api/attachments/h/${sha})`);
    const bucket = env.ATTACHMENTS;
    if (!bucket) throw new Error("测试环境未绑定 ATTACHMENTS 桶");
    await bucket.put(`a/${userId}/${sha}`, bytes);
    await env.DB.prepare(
      "INSERT INTO attachments (id, user_id, kind, sha256, r2_key, mime, filename, size_bytes, created_at, updated_at) VALUES (?, ?, 'original', ?, ?, 'image/png', '图.png', ?, 1, 1)",
    )
      .bind(`att-${itemId}`, userId, sha, `a/${userId}/${sha}`, bytes.length)
      .run();

    const share = await SELF.fetch(`${ORIGIN}/api/shares`, {
      method: "POST",
      headers: headers(cookie),
      body: JSON.stringify({ kind: "item", item_id: itemId }),
    });
    const record = (await share.json()) as ShareRecord;

    const unlock = await SELF.fetch(`${ORIGIN}/api/public/shares/${record.id}/unlock`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({}),
    });
    const token = ((await unlock.json()) as { token?: string }).token ?? "";

    const good = await SELF.fetch(`${ORIGIN}/api/public/shares/${record.id}/att/${sha}`, {
      headers: { "X-Menote-Share": token },
    });
    expect(good.status).toBe(200);
    expect(new Uint8Array(await good.arrayBuffer())).toEqual(bytes);

    const other = await sha256Hex(new Uint8Array([1]));
    const notReferenced = await SELF.fetch(`${ORIGIN}/api/public/shares/${record.id}/att/${other}`, {
      headers: { "X-Menote-Share": token },
    });
    expect(notReferenced.status).toBe(404);
  });
});

describe("改密 / 改期 / 撤销", () => {
  it("PATCH 清除密码后 unlock 不再需要校验值；过期时间可改", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const password = await deriveVerifier("要清掉的密码", salt);
    const { cookie, record } = await createShareForItem(
      "patch",
      12,
      newUlid(),
      "正文",
      password,
    );

    const patch = await SELF.fetch(`${ORIGIN}/api/shares/${record.id}`, {
      method: "PATCH",
      headers: headers(cookie),
      body: JSON.stringify({ password: null, expires_at: 4_102_444_800_000 }),
    });
    expect(patch.status).toBe(200);
    const after = (await patch.json()) as ShareRecord;
    expect(after.has_password).toBe(false);
    expect(after.expires_at).toBe(4_102_444_800_000);

    const status = (await (
      await SELF.fetch(`${ORIGIN}/api/public/shares/${record.id}`)
    ).json()) as { requires_password: boolean };
    expect(status.requires_password).toBe(false);
  });

  it("别人的分享改不了（404），过期时间在过去拒收（422）", async () => {
    const a = await createShareForItem("patch2", 13, newUlid());
    await openRegistration(a.cookie);
    const stranger = await registerUser("stranger", 14);

    const foreign = await SELF.fetch(`${ORIGIN}/api/shares/${a.record.id}`, {
      method: "PATCH",
      headers: headers(stranger),
      body: JSON.stringify({ expires_at: null }),
    });
    expect(foreign.status).toBe(404);

    const past = await SELF.fetch(`${ORIGIN}/api/shares/${a.record.id}`, {
      method: "PATCH",
      headers: headers(a.cookie),
      body: JSON.stringify({ expires_at: 1 }),
    });
    expect(past.status).toBe(422);
  });
});

describe("分享子域（实例设置，仅 owner）", () => {
  it("owner 可设置、读取与清除；member 访问被拒（403）", async () => {
    const cookie = await registerUser("origin-owner", 21);

    // 未配置 = null
    const initial = await SELF.fetch(`${ORIGIN}/api/admin/share-origin`, { headers: { Cookie: cookie } });
    expect(((await initial.json()) as { origin: string | null }).origin).toBeNull();

    // 设置（尾部斜杠会被剥掉）
    const put = await SELF.fetch(`${ORIGIN}/api/admin/share-origin`, {
      method: "PUT",
      headers: headers(cookie),
      body: JSON.stringify({ origin: "https://share.example.com/" }),
    });
    expect(((await put.json()) as { origin: string | null }).origin).toBe("https://share.example.com");

    // member 访问被拒
    await openRegistration(cookie);
    const memberCookie = await registerUser("origin-member", 22);
    const forbidden = await SELF.fetch(`${ORIGIN}/api/admin/share-origin`, {
      headers: { Cookie: memberCookie },
    });
    expect(forbidden.status).toBe(403);

    // 清除（null）
    const clear = await SELF.fetch(`${ORIGIN}/api/admin/share-origin`, {
      method: "PUT",
      headers: headers(cookie),
      body: JSON.stringify({ origin: null }),
    });
    expect(((await clear.json()) as { origin: string | null }).origin).toBeNull();
  });

  it("非法 origin（非 http(s) 主机形式）被拒（422）", async () => {
    const cookie = await registerUser("origin-bad", 23);
    const res = await SELF.fetch(`${ORIGIN}/api/admin/share-origin`, {
      method: "PUT",
      headers: headers(cookie),
      body: JSON.stringify({ origin: "not a url" }),
    });
    expect(res.status).toBe(422);
  });
});

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
import { SQL_UPSERT_ITEM_BODY, SQL_UPSERT_USER_CRYPTO } from "../src/db/tables";
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

/**
 * 连带撤销分享（M6 第一批；用户 2026-10-03 拍板）。
 *
 * **为什么要有这组用例**：原先那条「条目态变化让链接失效」是**直接改库**模拟删除/加密的
 * （`UPDATE items SET deleted_at = 9`），**根本没走 `softDeleteItem` / `patchItemMeta`**，
 * 于是「软删时并没有真的撤销分享」这件事被完全绕过去了——访客侧只做实时检查、不记得曾经
 * 死过，所以条目一恢复链接就复活，与需求 §16.1 冲突。
 *
 * 这组一律**走真实端点**（`DELETE /api/items/:id` / `POST /api/items/:id/restore` /
 * `PATCH /api/items/:id/meta`），才测得到真正的那条路径。
 */
describe("连带撤销分享：进回收站 / 加隐私之后，恢复不复活链接", () => {
  /** 软删（走路由 → `softDeleteItem`） */
  function softDelete(cookie: string, itemId: string): Promise<Response> {
    return SELF.fetch(`${ORIGIN}/api/items/${itemId}`, {
      method: "DELETE",
      headers: headers(cookie),
    });
  }

  /** 从回收站恢复（走路由 → `restoreItem`） */
  function restore(cookie: string, itemId: string): Promise<Response> {
    return SELF.fetch(`${ORIGIN}/api/items/${itemId}/restore`, {
      method: "POST",
      headers: headers(cookie),
      body: "{}",
    });
  }

  function metaPatch(
    cookie: string,
    itemId: string,
    baseMetaRev: number,
    patch: Record<string, unknown>,
  ): Promise<Response> {
    return SELF.fetch(`${ORIGIN}/api/items/${itemId}/meta`, {
      method: "PATCH",
      headers: headers(cookie),
      body: JSON.stringify({ base_meta_rev: baseMetaRev, ...patch }),
    });
  }

  async function visitorStatus(sid: string): Promise<string> {
    const body = (await (await SELF.fetch(`${ORIGIN}/api/public/shares/${sid}`)).json()) as {
      status: string;
    };
    return body.status;
  }

  async function revokedAt(sid: string): Promise<number | null> {
    const row = await env.DB.prepare("SELECT revoked_at FROM shares WHERE id = ?")
      .bind(sid)
      .first<{ revoked_at: number | null }>();
    return row?.revoked_at ?? null;
  }

  /** 给账号补一条 `user_crypto`，让「加单篇加密」这条路走得通（服务端只查存在性） */
  async function enablePrivacyLock(userId: string): Promise<void> {
    await env.DB.prepare(SQL_UPSERT_USER_CRYPTO)
      .bind(
        userId,
        "PBKDF2-SHA-256",
        100_000,
        new Uint8Array(16),
        "v",
        new Uint8Array(8),
        new Uint8Array(8),
        1,
        1,
      )
      .run();
  }

  it("软删 → 恢复：链接仍是失效页（本批的核心断言）", async () => {
    const a = await createShareForItem("revoke-trash", 21, newUlid());
    expect(await visitorStatus(a.record.id)).toBe("ok");

    expect((await softDelete(a.cookie, a.itemId)).status).toBe(200);
    expect(await visitorStatus(a.record.id)).toBe("invalid");

    // 关键一步：恢复之后**不能再活过来**
    expect((await restore(a.cookie, a.itemId)).status).toBe(200);
    expect(await visitorStatus(a.record.id)).toBe("invalid");
  });

  it("撤销是真的写进行（不是只靠实时检查糊过去）", async () => {
    const a = await createShareForItem("revoke-row", 22, newUlid());
    expect(await revokedAt(a.record.id)).toBeNull();

    await softDelete(a.cookie, a.itemId);
    const at = await revokedAt(a.record.id);
    expect(at).not.toBeNull();

    // 幂等：重复软删不报错，也不二次推进撤销时间
    const first = at as number;
    expect((await softDelete(a.cookie, a.itemId)).status).toBe(200);
    expect(await revokedAt(a.record.id)).toBe(first);
  });

  it("「我的分享」里不再出现它（列表只给未撤销的）", async () => {
    const a = await createShareForItem("revoke-list", 23, newUlid());
    await softDelete(a.cookie, a.itemId);
    const listed = (await (await SELF.fetch(`${ORIGIN}/api/shares`, { headers: headers(a.cookie) })).json()) as {
      shares: ShareRecord[];
    };
    expect(listed.shares.some((s) => s.id === a.record.id)).toBe(false);
  });

  it("加单篇加密 → 取消加密：链接同样不复活（与回收站同一口径）", async () => {
    const a = await createShareForItem("revoke-enc", 24, newUlid());
    const me = (await (await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: a.cookie } })).json()) as {
      id: string;
    };
    await enablePrivacyLock(me.id);

    expect((await metaPatch(a.cookie, a.itemId, 1, { enc_self: 1 })).status).toBe(200);
    expect(await visitorStatus(a.record.id)).toBe("invalid");
    expect(await revokedAt(a.record.id)).not.toBeNull();

    // 解除加密：条目恢复可分享，但分享行已被真撤销，链接不回来
    expect((await metaPatch(a.cookie, a.itemId, 2, { enc_self: 0 })).status).toBe(200);
    expect(await visitorStatus(a.record.id)).toBe("invalid");
  });

  it("A 的软删不会撤销 B 的分享（跨租户不误伤）", async () => {
    const a = await createShareForItem("tenant-a", 25, newUlid());
    await openRegistration(a.cookie);
    const b = await createShareForItem("tenant-b", 26, newUlid());

    await softDelete(a.cookie, a.itemId);
    expect(await visitorStatus(a.record.id)).toBe("invalid");
    // B 的条目没被动过，分享照常有效
    expect(await visitorStatus(b.record.id)).toBe("ok");
    expect(await revokedAt(b.record.id)).toBeNull();
  });

  it("撤销分享不碰条目、附件与版本历史（只动 shares 一张表）", async () => {
    const a = await createShareForItem("revoke-scope", 27, newUlid());
    await softDelete(a.cookie, a.itemId);

    const item = await env.DB.prepare("SELECT deleted_at FROM items WHERE id = ?")
      .bind(a.itemId)
      .first<{ deleted_at: number | null }>();
    expect(item?.deleted_at).not.toBeNull(); // 条目本身照旧进回收站，没有被连带处理

    const body = await env.DB.prepare("SELECT body FROM item_bodies WHERE item_id = ?")
      .bind(a.itemId)
      .first<{ body: string }>();
    expect(body?.body).toContain("正文"); // 正文原样保留
  });
});

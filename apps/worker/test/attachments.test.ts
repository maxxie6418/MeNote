/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 附件服务端（M4-4；《M4 设计》§3）。
 *
 * 测试里的桶来自 `vitest.config.ts` 的 `miniflare.r2Buckets`——**真实的 R2 API 形状**，
 * 不是内存假件，所以"流式直写""Range""删不存在的对象"这些路径都是真跑。
 * 生产绑定（`wrangler.jsonc` 的 `r2_buckets`）要等实例上建好桶再加，见 M4-13 的收口清单。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import { MAX_ATTACHMENT_BYTES, base64UrlEncode, newUlid } from "@menote/shared";
import { attachmentKey } from "../src/adapters/r2";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";
let seq = 0;

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

async function registerUser(username: string): Promise<{ cookie: string; id: string }> {
  seq += 1;
  const response = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
    body: JSON.stringify({ username, login_key: loginKey(seq) }),
  });
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
  const body = (await me.json()) as { id: string };
  return { cookie, id: body.id };
}

async function openRegistration(cookie: string): Promise<void> {
  await SELF.fetch(`${ORIGIN}/api/admin/registration`, {
    method: "PUT",
    headers: headers(cookie),
    body: JSON.stringify({ open: true }),
  });
}

/** 造一个"哈希对得上"的假文件（内容随便，哈希由测试给） */
function fakeSha(seed: string): string {
  return seed.repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, "a");
}

async function check(cookie: string, sha256: string, size: number): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/attachments/check`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({ sha256, size }),
  });
}

async function putBlob(cookie: string, sha256: string, bytes: Uint8Array, kind = "original"): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/attachments/blob?sha256=${sha256}&kind=${kind}`, {
    method: "PUT",
    headers: headers(cookie, { "Content-Type": "image/png" }),
    body: bytes,
  });
}

async function finalize(
  cookie: string,
  input: Record<string, unknown>,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/attachments/finalize`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify(input),
  });
}

beforeEach(async () => {
  await freshDatabase();
  // 桶不需要清：每个用例都注册新用户、哈希也各不同，键天然不撞（清桶反而要枚举，与"桶不可枚举"的
  // 设计口径相悖）
});

describe("check 与登记", () => {
  it("check 未见过返回 pending: false，登记后返回 pending: true", async () => {
    const user = await registerUser("Alice");
    const sha = fakeSha("a");

    const first = await check(user.cookie, sha, 1024);
    expect(await first.json()).toEqual({ exists: false, pending: false });

    await putBlob(user.cookie, sha, new Uint8Array([1, 2, 3]));

    const second = await check(user.cookie, sha, 1024);
    expect(await second.json()).toEqual({ exists: false, pending: true });

    // 登记行确实写进去了，且带 24 小时有效期
    const row = await env.DB.prepare("SELECT due_at, created_at FROM pending_uploads WHERE r2_key = ?")
      .bind(attachmentKey(user.id, sha, "original"))
      .first<{ due_at: number; created_at: number }>();
    expect(row).not.toBeNull();
    expect((row?.due_at ?? 0) - (row?.created_at ?? 0)).toBe(24 * 60 * 60 * 1000);
  });

  it("size 超过 20MB 两处都拒（check 与 finalize）", async () => {
    const user = await registerUser("Alice");
    const sha = fakeSha("b");

    const tooBig = await check(user.cookie, sha, MAX_ATTACHMENT_BYTES + 1);
    expect(tooBig.status).toBe(422);

    const finalized = await finalize(user.cookie, {
      sha256: sha,
      size: MAX_ATTACHMENT_BYTES + 1,
      mime: "image/png",
      width: null,
      height: null,
      filename: "big.png",
    });
    expect(finalized.status).toBe(422);
  });

  it("sha256 形状不对被拒（它要拼进对象键，不能是任意字符串）", async () => {
    const user = await registerUser("Alice");
    const bad = await check(user.cookie, "../../etc/passwd", 10);
    expect(bad.status).toBe(422);
  });
});

describe("blob 上传与落元数据", () => {
  it("上传后 exists: true，且 attachments 两行、缩略图 parent_id 指原图", async () => {
    const user = await registerUser("Alice");
    const sha = fakeSha("c");

    await putBlob(user.cookie, sha, new Uint8Array([1, 2, 3]));
    await putBlob(user.cookie, sha, new Uint8Array([9, 9]), "thumb");

    const response = await finalize(user.cookie, {
      sha256: sha,
      size: 3,
      mime: "image/png",
      width: 100,
      height: 80,
      filename: "图.png",
      thumb: { size: 2, mime: "image/webp", width: 40, height: 32 },
    });
    expect(response.status).toBe(200);

    const rows = await env.DB.prepare(
      "SELECT id, kind, parent_id, sha256, r2_key FROM attachments WHERE user_id = ? ORDER BY kind",
    )
      .bind(user.id)
      .all<{ id: string; kind: string; parent_id: string | null; sha256: string; r2_key: string }>();

    expect(rows.results).toHaveLength(2);
    const original = rows.results.find((row) => row.kind === "original");
    const thumb = rows.results.find((row) => row.kind === "thumb");
    expect(thumbnailParent(thumb)).toBe(original?.id);
    // 缩略图沿用原图的 sha256（身份 = (user, sha256, kind)）
    expect(thumb?.sha256).toBe(sha);
    expect(thumb?.r2_key).toBe(`${attachmentKey(user.id, sha, "original")}.t`);

    // 登记被删掉了（落元数据即清）
    const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM pending_uploads WHERE user_id = ?")
      .bind(user.id)
      .first<{ n: number }>();
    expect(pending?.n).toBe(0);

    // 再问一次：exists: true
    const again = await check(user.cookie, sha, 3);
    expect(await again.json()).toEqual({ exists: true, pending: false });
  });

  it("同一 sha256 传两次不重复落行（唯一索引去重）", async () => {
    const user = await registerUser("Alice");
    const sha = fakeSha("d");

    for (let round = 0; round < 2; round += 1) {
      await putBlob(user.cookie, sha, new Uint8Array([1]));
      await finalize(user.cookie, {
        sha256: sha,
        size: 1,
        mime: "image/png",
        width: null,
        height: null,
        filename: "same.png",
      });
    }

    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM attachments WHERE user_id = ? AND sha256 = ?",
    )
      .bind(user.id, sha)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("条目引用由客户端上报，可查询回来", async () => {
    const user = await registerUser("Alice");
    const sha = fakeSha("e");
    const itemId = newUlid();

    await putBlob(user.cookie, sha, new Uint8Array([1, 2]));
    await finalize(user.cookie, {
      sha256: sha,
      size: 2,
      mime: "image/png",
      width: null,
      height: null,
      filename: "ref.png",
      itemId,
    });

    const response = await SELF.fetch(`${ORIGIN}/api/attachments/refs/${itemId}`, {
      headers: headers(user.cookie),
    });
    const body = (await response.json()) as { refs: Array<{ attachmentId: string }> };
    expect(body.refs).toHaveLength(1);
  });

  it("没绑桶时给 503 与明确文案（不影响其它端点）", async () => {
    const user = await registerUser("Alice");
    const sha = fakeSha("f");

    // 临时把绑定摘掉，模拟"实例还没开通对象存储"
    const bucket = env.ATTACHMENTS;
    Reflect.deleteProperty(env, "ATTACHMENTS");
    try {
      const response = await putBlob(user.cookie, sha, new Uint8Array([1]));
      expect(response.status).toBe(503);
      const body = (await response.json()) as { message: string };
      expect(body.message).toContain("对象存储");
    } finally {
      Object.defineProperty(env, "ATTACHMENTS", { value: bucket, configurable: true });
    }
  });
});

describe("下载", () => {
  it("未登录 401；登录后 200 + 长缓存头；?thumb=1 取缩略图", async () => {
    const user = await registerUser("Alice");
    const sha = fakeSha("1a");

    await putBlob(user.cookie, sha, new Uint8Array([1, 2, 3, 4]));
    await putBlob(user.cookie, sha, new Uint8Array([7, 7]), "thumb");
    await finalize(user.cookie, {
      sha256: sha,
      size: 4,
      mime: "image/png",
      width: null,
      height: null,
      filename: "d.png",
      thumb: { size: 2, mime: "image/webp", width: null, height: null },
    });

    const anonymous = await SELF.fetch(`${ORIGIN}/api/attachments/h/${sha}`);
    expect(anonymous.status).toBe(401);

    const response = await SELF.fetch(`${ORIGIN}/api/attachments/h/${sha}`, {
      headers: { Cookie: user.cookie },
    });
    expect(response.status).toBe(200);
    // 内容寻址 → 可以长缓存，但必须 private
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));

    const thumb = await SELF.fetch(`${ORIGIN}/api/attachments/h/${sha}?thumb=1`, {
      headers: { Cookie: user.cookie },
    });
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("Content-Type")).toBe("image/webp");
    expect(new Uint8Array(await thumb.arrayBuffer())).toEqual(new Uint8Array([7, 7]));
  });

  it("Range 请求返回 206 与正确的 Content-Range", async () => {
    const user = await registerUser("Alice");
    const sha = fakeSha("1b");

    await putBlob(user.cookie, sha, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    await finalize(user.cookie, {
      sha256: sha,
      size: 10,
      mime: "application/octet-stream",
      width: null,
      height: null,
      filename: "r.bin",
    });

    const response = await SELF.fetch(`${ORIGIN}/api/attachments/h/${sha}`, {
      headers: { Cookie: user.cookie, Range: "bytes=2-5" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4, 5]));
  });

  it("别人的附件取不到（键由服务端按会话拼，跨用户不串）", async () => {
    const alice = await registerUser("Alice");
    await openRegistration(alice.cookie);
    const bob = await registerUser("Bob");
    const sha = fakeSha("1c");

    await putBlob(alice.cookie, sha, new Uint8Array([1]));
    await finalize(alice.cookie, {
      sha256: sha,
      size: 1,
      mime: "image/png",
      width: null,
      height: null,
      filename: "a.png",
    });

    const response = await SELF.fetch(`${ORIGIN}/api/attachments/h/${sha}`, {
      headers: { Cookie: bob.cookie },
    });
    expect(response.status).toBe(404);
  });
});

describe("孤儿与 GC", () => {
  it("没有引用的附件被标孤儿；有引用的不动", async () => {
    const user = await registerUser("Alice");
    const orphan = fakeSha("2a");
    const referenced = fakeSha("2b");
    const itemId = newUlid();

    for (const sha of [orphan, referenced]) {
      await putBlob(user.cookie, sha, new Uint8Array([1]));
      await finalize(user.cookie, {
        sha256: sha,
        size: 1,
        mime: "image/png",
        width: null,
        height: null,
        filename: "x.png",
        itemId: sha === referenced ? itemId : null,
      });
    }

    const response = await SELF.fetch(`${ORIGIN}/api/attachments/gc`, {
      method: "POST",
      headers: headers(user.cookie),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { marked: number; removed: number };
    expect(body.marked).toBe(1); // 只有没引用的那个被标
    expect(body.removed).toBe(0); // 还没到 30 天，不删

    const rows = await env.DB.prepare(
      "SELECT sha256, orphaned_at FROM attachments WHERE user_id = ? ORDER BY sha256",
    )
      .bind(user.id)
      .all<{ sha256: string; orphaned_at: number | null }>();
    const bySha = new Map(rows.results.map((row) => [row.sha256, row.orphaned_at]));
    expect(bySha.get(orphan)).not.toBeNull();
    expect(bySha.get(referenced)).toBeNull();
  });

  it("到期孤儿被删行并把对象登记进 r2_gc_queue（reason=orphan）", async () => {
    const user = await registerUser("Alice");
    const sha = fakeSha("2c");

    await putBlob(user.cookie, sha, new Uint8Array([1]));
    await finalize(user.cookie, {
      sha256: sha,
      size: 1,
      mime: "image/png",
      width: null,
      height: null,
      filename: "old.png",
    });

    // 手工把 orphaned_at 拨到 31 天前（手动 GC 只清到期的，不越权提前删）
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await env.DB.prepare("UPDATE attachments SET orphaned_at = ? WHERE user_id = ?")
      .bind(old, user.id)
      .run();

    const response = await SELF.fetch(`${ORIGIN}/api/attachments/gc`, {
      method: "POST",
      headers: headers(user.cookie),
    });
    const body = (await response.json()) as { removed: number };
    expect(body.removed).toBe(1);

    const queued = await env.DB.prepare(
      "SELECT r2_key, reason FROM r2_gc_queue WHERE user_id = ?",
    )
      .bind(user.id)
      .all<{ r2_key: string; reason: string }>();
    expect(queued.results).toHaveLength(1);
    expect(queued.results[0]?.reason).toBe("orphan");
    expect(queued.results[0]?.r2_key).toBe(attachmentKey(user.id, sha, "original"));
  });

  it("GC 只清本用户的孤儿（跨用户红线）", async () => {
    const alice = await registerUser("Alice");
    await openRegistration(alice.cookie);
    const bob = await registerUser("Bob");

    const sha = fakeSha("2d");
    await putBlob(alice.cookie, sha, new Uint8Array([1]));
    await finalize(alice.cookie, {
      sha256: sha,
      size: 1,
      mime: "image/png",
      width: null,
      height: null,
      filename: "alice.png",
    });

    // Bob 调 GC：Alice 的附件不能被标、更不能被删
    const response = await SELF.fetch(`${ORIGIN}/api/attachments/gc`, {
      method: "POST",
      headers: headers(bob.cookie),
    });
    const body = (await response.json()) as { marked: number };
    expect(body.marked).toBe(0);

    const row = await env.DB.prepare(
      "SELECT orphaned_at FROM attachments WHERE user_id = ? AND sha256 = ?",
    )
      .bind(alice.id, sha)
      .first<{ orphaned_at: number | null }>();
    expect(row?.orphaned_at).toBeNull();
  });
});

/** 缩略图行的 `parent_id` 应当指原图（小工具让断言读起来像一句话） */
function thumbnailParent(row: { parent_id: string | null } | undefined): string | null {
  return row?.parent_id ?? null;
}

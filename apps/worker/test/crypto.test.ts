/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 隐私锁门禁材料（M3-3）：`GET / PUT / POST reset / DELETE /api/crypto`。
 *
 * 测的是"服务端这一侧的责任"：存取、**材料形状校验**（宁可不存也不存坏）、
 * 有关闭前置校验、以及"重置密码"用 `BACKUP_CRED_KEY` 解出 K。
 * 服务端不校验隐私密码本身——那是浏览器用 verifier 做的事。
 */
import {
  CRYPTO_KEY_BYTES,
  CRYPTO_SALT_BYTES,
  CRYPTO_VERIFIER_BYTES,
  CRYPTO_WRAPPED_BYTES,
  base64UrlEncode,
  packCryptoBlob,
  type CryptoMaterials,
  type CryptoResetResponse,
  type CryptoState,
} from "@menote/shared";
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetContentKey } from "../src/services/crypto";
import type { EnvBindings } from "../src/types";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";
/** 与 `vitest.config.ts` 注入的测试绑定保持一致 */
const TEST_SECRET = "test-backup-cred-not-a-real-secret";

async function registerOwner(username: string): Promise<{ cookie: string; id: string }> {
  const key = new Uint8Array(32);
  key.fill(7);
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
    body: JSON.stringify({ username, login_key: base64UrlEncode(key) }),
  });
  const cookie = ((res.headers.get("set-cookie") ?? "").split(";")[0] ?? "").trim();
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
  const body = (await me.json()) as { id: string };
  return { cookie, id: body.id };
}

function headers(cookie: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Menote": "1",
    Origin: ORIGIN,
    Cookie: cookie,
  };
}

/** 造一个版本正确的密文块（内容无所谓，服务端只看长度与版本号） */
function blob(ciphertextBytes: number, seed: number): string {
  return base64UrlEncode(
    packCryptoBlob({
      iv: new Uint8Array(12).fill(seed),
      ciphertext: new Uint8Array(ciphertextBytes).fill(seed + 1),
      tag: new Uint8Array(16).fill(seed + 2),
    }),
  );
}

function fakeMaterials(): CryptoMaterials {
  return {
    kdf: "PBKDF2-SHA-256",
    kdf_iterations: 600_000,
    kdf_salt: base64UrlEncode(new Uint8Array(CRYPTO_SALT_BYTES).fill(5)),
    verifier: blob(CRYPTO_VERIFIER_BYTES - 1 - 12 - 16, 6),
    k_wrapped_pw: blob(CRYPTO_KEY_BYTES, 8),
    k_wrapped_backup: blob(CRYPTO_KEY_BYTES, 10),
  };
}

/** 用测试机密真的包一份 K —— 给"重置密码"用 */
async function wrapWithBackupKey(k: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TEST_SECRET));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = new Uint8Array(12).fill(3);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, k),
  );
  const ciphertext = sealed.slice(0, sealed.length - 16);
  const tag = sealed.slice(sealed.length - 16);
  return base64UrlEncode(packCryptoBlob({ iv, ciphertext, tag }));
}

async function insertPrivacyItem(userId: string, id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO items (id, user_id, type, folder_id, title, enc_self, in_enc_space, size_bytes,
       content_hash, tags, is_task, pinned, starred, rev, meta_rev, sync_seq, created_at, updated_at)
     VALUES (?, ?, 'note', NULL, '私密', 1, 0, 3, 'h', '[]', 0, 0, 0, 1, 1, 1, 1, 1)`,
  )
    .bind(id, userId)
    .run();
}

let alice: { cookie: string; id: string };

beforeEach(async () => {
  await freshDatabase();
  alice = await registerOwner("alice");
});

describe("GET /api/crypto", () => {
  it("未登录 401；已登录但未启用时 enabled=false", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/crypto`)).status).toBe(401);

    const res = await SELF.fetch(`${ORIGIN}/api/crypto`, { headers: { Cookie: alice.cookie } });
    const body = (await res.json()) as CryptoState;
    expect(res.status).toBe(200);
    expect(body).toEqual({ enabled: false, materials: null, rev: 0, updated_at: 0 });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("PUT /api/crypto", () => {
  it("写入后回读一致，rev 从 1 开始递增", async () => {
    const materials = fakeMaterials();

    const first = await SELF.fetch(`${ORIGIN}/api/crypto`, {
      method: "PUT",
      headers: headers(alice.cookie),
      body: JSON.stringify(materials),
    });
    expect(first.status).toBe(200);
    const state = (await first.json()) as CryptoState;
    expect(state.enabled).toBe(true);
    expect(state.materials).toEqual(materials);
    expect(state.rev).toBe(1);

    const second = await SELF.fetch(`${ORIGIN}/api/crypto`, {
      method: "PUT",
      headers: headers(alice.cookie),
      body: JSON.stringify({ ...materials, k_wrapped_pw: blob(CRYPTO_KEY_BYTES, 12) }),
    });
    expect(((await second.json()) as CryptoState).rev).toBe(2);

    const read = await SELF.fetch(`${ORIGIN}/api/crypto`, {
      headers: { Cookie: alice.cookie },
    });
    const after = (await read.json()) as CryptoState;
    expect(after.materials?.k_wrapped_pw).toBe(blob(CRYPTO_KEY_BYTES, 12));
    expect(after.rev).toBe(2);
  });

  it("形状不对一律 422：KDF 非 PBKDF2 / 迭代数越界 / 编码非法", async () => {
    const bad = [
      { ...fakeMaterials(), kdf: "Argon2id" },
      { ...fakeMaterials(), kdf_iterations: 1_000 },
      { ...fakeMaterials(), kdf_salt: "!!!not base64!!!" },
    ];
    for (const payload of bad) {
      const res = await SELF.fetch(`${ORIGIN}/api/crypto`, {
        method: "PUT",
        headers: headers(alice.cookie),
        body: JSON.stringify(payload),
      });
      expect(res.status, JSON.stringify(payload).slice(0, 40)).toBe(422);
    }
  });

  it("长度不合法拒绝写入（宁可不存，也不存坏）", async () => {
    const cases = [
      { ...fakeMaterials(), k_wrapped_pw: blob(CRYPTO_KEY_BYTES - 1, 1) },
      { ...fakeMaterials(), k_wrapped_backup: blob(CRYPTO_KEY_BYTES + 1, 1) },
      { ...fakeMaterials(), verifier: blob(CRYPTO_VERIFIER_BYTES, 1) },
      { ...fakeMaterials(), kdf_salt: base64UrlEncode(new Uint8Array(8).fill(1)) },
    ];
    for (const payload of cases) {
      const res = await SELF.fetch(`${ORIGIN}/api/crypto`, {
        method: "PUT",
        headers: headers(alice.cookie),
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(422);
    }

    // 一次都没写进去
    const read = await SELF.fetch(`${ORIGIN}/api/crypto`, { headers: { Cookie: alice.cookie } });
    expect(((await read.json()) as CryptoState).enabled).toBe(false);
  });

  it("版本号不对的密文块被拒绝", async () => {
    const wrongVersion = new Uint8Array(CRYPTO_WRAPPED_BYTES).fill(4);
    const res = await SELF.fetch(`${ORIGIN}/api/crypto`, {
      method: "PUT",
      headers: headers(alice.cookie),
      body: JSON.stringify({ ...fakeMaterials(), k_wrapped_pw: base64UrlEncode(wrongVersion) }),
    });
    expect(res.status).toBe(422);
  });
});

describe("DELETE /api/crypto（关闭隐私锁）", () => {
  it("有隐私内容（含回收站里的）时拒绝，并给出原因与条数", async () => {
    await SELF.fetch(`${ORIGIN}/api/crypto`, {
      method: "PUT",
      headers: headers(alice.cookie),
      body: JSON.stringify(fakeMaterials()),
    });
    // 软删的条目也算隐私内容
    await insertPrivacyItem(alice.id, "01J0PRIVACYITEM0000000000");

    const res = await SELF.fetch(`${ORIGIN}/api/crypto`, {
      method: "DELETE",
      headers: headers(alice.cookie),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; detail?: { reason: string; count: number } };
    expect(body.code).toBe("invalid");
    expect(body.detail?.reason).toBe("privacy_content_exists");
    expect(body.detail?.count).toBe(1);
  });

  it("没有隐私内容时关闭成功，材料被清掉", async () => {
    await SELF.fetch(`${ORIGIN}/api/crypto`, {
      method: "PUT",
      headers: headers(alice.cookie),
      body: JSON.stringify(fakeMaterials()),
    });

    const res = await SELF.fetch(`${ORIGIN}/api/crypto`, {
      method: "DELETE",
      headers: headers(alice.cookie),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as CryptoState).enabled).toBe(false);

    const rows = await env.DB.prepare("SELECT COUNT(*) AS count FROM user_crypto").first<{
      count: number;
    }>();
    expect(rows?.count).toBe(0);
  });
});

describe("POST /api/crypto/reset（忘记隐私密码）", () => {
  it("用 BACKUP_CRED_KEY 解出内容密钥 K", async () => {
    const k = new Uint8Array(CRYPTO_KEY_BYTES).fill(42);
    await SELF.fetch(`${ORIGIN}/api/crypto`, {
      method: "PUT",
      headers: headers(alice.cookie),
      body: JSON.stringify({ ...fakeMaterials(), k_wrapped_backup: await wrapWithBackupKey(k) }),
    });

    const res = await SELF.fetch(`${ORIGIN}/api/crypto/reset`, {
      method: "POST",
      headers: headers(alice.cookie),
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = (await res.json()) as CryptoResetResponse;
    // 解出来的 K 必须与包进去的一致（长度也对）
    expect(body.k).toBe(base64UrlEncode(k));
  });

  it("没启用隐私锁时 404", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/crypto/reset`, {
      method: "POST",
      headers: headers(alice.cookie),
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  it("缺 BACKUP_CRED_KEY 机密时只让这一条路失败（503 + 明确文案）", async () => {
    await SELF.fetch(`${ORIGIN}/api/crypto`, {
      method: "PUT",
      headers: headers(alice.cookie),
      body: JSON.stringify(fakeMaterials()),
    });

    const withoutSecret = { DB: env.DB } as unknown as EnvBindings;
    await expect(resetContentKey(withoutSecret, env.DB, alice.id)).rejects.toMatchObject({
      code: "retry_later",
    });

    // 其它端点照常工作
    const read = await SELF.fetch(`${ORIGIN}/api/crypto`, { headers: { Cookie: alice.cookie } });
    expect(read.status).toBe(200);
  });

  it("机密换过（包裹解不开）时返回 422，不泄漏细节", async () => {
    await SELF.fetch(`${ORIGIN}/api/crypto`, {
      method: "PUT",
      headers: headers(alice.cookie),
      body: JSON.stringify(fakeMaterials()),
    });

    const res = await SELF.fetch(`${ORIGIN}/api/crypto/reset`, {
      method: "POST",
      headers: headers(alice.cookie),
      body: "{}",
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("BACKUP_CRED_KEY");
  });
});

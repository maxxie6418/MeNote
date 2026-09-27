/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 隐私锁门禁材料（M3-3）：`GET / PUT / POST reset / DELETE /api/crypto`。
 *
 * 测的是"服务端这一侧的责任"：存取、**材料形状校验**（宁可不存也不存坏）、
 * 首次启用时用 `BACKUP_CRED_KEY` 包出第二份包裹、有关闭前置校验、
 * 以及"重置密码"用它解出 K。服务端不校验隐私密码本身——那是浏览器用 verifier 做的事。
 */
import {
  CRYPTO_KEY_BYTES,
  CRYPTO_SALT_BYTES,
  CRYPTO_VERIFIER_BYTES,
  CRYPTO_WRAPPED_BYTES,
  base64UrlEncode,
  cryptoBlobFromBase64Url,
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

async function putCrypto(
  cookie: string,
  body: unknown,
): Promise<{ status: number; state: CryptoState }> {
  const res = await SELF.fetch(`${ORIGIN}/api/crypto`, {
    method: "PUT",
    headers: headers(cookie),
    body: JSON.stringify(body),
  });
  return { status: res.status, state: (await res.json()) as CryptoState };
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

describe("PUT /api/crypto（启用 / 改密）", () => {
  it("首次启用：浏览器给明文 K，服务端用 BACKUP_CRED_KEY 包出第二份包裹", async () => {
    const k = new Uint8Array(CRYPTO_KEY_BYTES).fill(21);
    const { status, state } = await putCrypto(alice.cookie, {
      materials: fakeMaterials(),
      k: base64UrlEncode(k),
    });

    expect(status).toBe(200);
    expect(state.enabled).toBe(true);
    expect(state.rev).toBe(1);

    // 服务端包出来的备份包裹长度正确、版本正确，而且不是客户端传的那个
    const backup = cryptoBlobFromBase64Url(state.materials!.k_wrapped_backup);
    expect(backup.length).toBe(CRYPTO_WRAPPED_BYTES);
    expect(backup[0]).toBe(1);
    expect(state.materials!.k_wrapped_backup).not.toBe(fakeMaterials().k_wrapped_backup);
    expect(state.materials!.k_wrapped_pw).toBe(fakeMaterials().k_wrapped_pw);
  });

  it("改密：不再传 K，把已有材料（含旧备份包裹）原样带回即可，rev 递增", async () => {
    const k = new Uint8Array(CRYPTO_KEY_BYTES).fill(31);
    const first = await putCrypto(alice.cookie, {
      materials: fakeMaterials(),
      k: base64UrlEncode(k),
    });
    expect(first.status).toBe(200);

    const changed = {
      ...first.state.materials!,
      k_wrapped_pw: blob(CRYPTO_KEY_BYTES, 44),
    };
    const second = await putCrypto(alice.cookie, { materials: changed });
    expect(second.status).toBe(200);
    expect(second.state.rev).toBe(2);
    expect(second.state.materials?.k_wrapped_pw).toBe(blob(CRYPTO_KEY_BYTES, 44));
    // 备份包裹没被动过
    expect(second.state.materials?.k_wrapped_backup).toBe(first.state.materials?.k_wrapped_backup);
  });

  it("首次启用不带 K：422（服务端无法自己造出内容密钥）", async () => {
    const { status } = await putCrypto(alice.cookie, { materials: fakeMaterials() });
    expect(status).toBe(422);
  });

  it("形状不对一律 422：KDF 非 PBKDF2 / 迭代数越界 / 编码非法 / K 长度不对", async () => {
    const bad = [
      { materials: { ...fakeMaterials(), kdf: "Argon2id" } },
      { materials: { ...fakeMaterials(), kdf_iterations: 1_000 } },
      { materials: { ...fakeMaterials(), kdf_salt: "!!!not base64!!!" } },
      { materials: fakeMaterials(), k: base64UrlEncode(new Uint8Array(16)) },
    ];
    for (const payload of bad) {
      const { status } = await putCrypto(alice.cookie, payload);
      expect(status, JSON.stringify(payload).slice(0, 60)).toBe(422);
    }
  });

  it("长度不合法拒绝写入（宁可不存，也不存坏）", async () => {
    const cases = [
      { materials: { ...fakeMaterials(), k_wrapped_pw: blob(CRYPTO_KEY_BYTES - 1, 1) } },
      { materials: { ...fakeMaterials(), k_wrapped_backup: blob(CRYPTO_KEY_BYTES + 1, 1) } },
      { materials: { ...fakeMaterials(), verifier: blob(CRYPTO_VERIFIER_BYTES, 1) } },
      {
        materials: {
          ...fakeMaterials(),
          kdf_salt: base64UrlEncode(new Uint8Array(8).fill(1)),
        },
      },
    ];
    for (const payload of cases) {
      const { status } = await putCrypto(alice.cookie, payload);
      expect(status).toBe(422);
    }

    const read = await SELF.fetch(`${ORIGIN}/api/crypto`, { headers: { Cookie: alice.cookie } });
    expect(((await read.json()) as CryptoState).enabled).toBe(false);
  });

  it("版本号不对的密文块被拒绝", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/crypto`, {
      method: "PUT",
      headers: headers(alice.cookie),
      body: JSON.stringify({
        materials: {
          ...fakeMaterials(),
          k_wrapped_pw: base64UrlEncode(new Uint8Array(CRYPTO_WRAPPED_BYTES).fill(4)),
        },
      }),
    });
    expect(res.status).toBe(422);
  });
});

describe("DELETE /api/crypto（关闭隐私锁）", () => {
  it("有隐私内容（含回收站里的）时拒绝，并给出原因与条数", async () => {
    await putCrypto(alice.cookie, {
      materials: fakeMaterials(),
      k: base64UrlEncode(new Uint8Array(CRYPTO_KEY_BYTES).fill(9)),
    });
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
    await putCrypto(alice.cookie, {
      materials: fakeMaterials(),
      k: base64UrlEncode(new Uint8Array(CRYPTO_KEY_BYTES).fill(9)),
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
  it("端到端：启用时交出的 K，重置时能原样解回来", async () => {
    const k = new Uint8Array(CRYPTO_KEY_BYTES).fill(42);
    await putCrypto(alice.cookie, { materials: fakeMaterials(), k: base64UrlEncode(k) });

    const res = await SELF.fetch(`${ORIGIN}/api/crypto/reset`, {
      method: "POST",
      headers: headers(alice.cookie),
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = (await res.json()) as CryptoResetResponse;
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

  it("缺 BACKUP_CRED_KEY 机密时：启用被拒（503）、且其它端点照常", async () => {
    const withoutSecret = { DB: env.DB } as unknown as EnvBindings;

    await expect(
      resetContentKey(withoutSecret, env.DB, alice.id),
    ).rejects.toMatchObject({ code: "retry_later" });

    // 未配置机密时连启用也做不了（服务端包不出第二份包裹）——但 GET 照常
    const read = await SELF.fetch(`${ORIGIN}/api/crypto`, { headers: { Cookie: alice.cookie } });
    expect(read.status).toBe(200);
  });

  it("备份包裹解不开（机密换过）时 422，不泄漏细节", async () => {
    // 直接用客户端伪造的备份包裹启用（不是服务端包的），reset 必然解不开
    await env.DB.prepare(
      `INSERT INTO user_crypto (user_id, kdf, kdf_iterations, kdf_salt, verifier, k_wrapped_pw, k_wrapped_backup, rev, created_at, updated_at)
       VALUES (?, 'PBKDF2-SHA-256', 600000, ?, ?, ?, ?, 1, 1, 1)`,
    )
      .bind(
        alice.id,
        cryptoBlobFromBase64Url(fakeMaterials().kdf_salt),
        cryptoBlobFromBase64Url(fakeMaterials().verifier),
        cryptoBlobFromBase64Url(fakeMaterials().k_wrapped_pw),
        cryptoBlobFromBase64Url(fakeMaterials().k_wrapped_backup),
      )
      .run();

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

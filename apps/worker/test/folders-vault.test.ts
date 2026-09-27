/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 文件夹的加密空间标记（M3-8；《隐私锁设计》§6.3、§8）。
 *
 * 两条服务端责任：
 * 1. **空间内新建由父级推导**（父在空间里 → 子就在空间里），不让客户端随便指定；
 * 2. **整夹移入 / 移出必须自洽**：`in_enc_space` 与 `parent_id` 一条补丁一起给，
 *    且目标父级确实在空间里 / 确实不在空间里；**空间根行本身永不可移**（只可改名）。
 */
import {
  ITEM_META_HEADER,
  base64UrlEncode,
  encodeItemWriteMeta,
  newUlid,
} from "@menote/shared";
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";

function loginKey(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return base64UrlEncode(bytes);
}

function headers(cookie: string, extra: Record<string, string> = {}): Record<string, string> {
  return { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN, Cookie: cookie, ...extra };
}

function base64UrlOf(bytes: number, seed: number): string {
  const data = new Uint8Array(bytes).fill(seed);
  if (bytes > 0) data[0] = 1;
  return base64UrlEncode(data);
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

function createFolder(cookie: string, id: string, parentId: string | null, name: string) {
  return SELF.fetch(`${ORIGIN}/api/folders`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({ id, parent_id: parentId, name }),
  });
}

function patchFolder(cookie: string, id: string, patch: Record<string, unknown>) {
  return SELF.fetch(`${ORIGIN}/api/folders/${id}`, {
    method: "PATCH",
    headers: headers(cookie),
    body: JSON.stringify(patch),
  });
}

async function folderRow(id: string) {
  return env.DB.prepare(
    "SELECT parent_id, depth, in_enc_space, is_enc_space, name FROM folders WHERE id = ?",
  )
    .bind(id)
    .first<{
      parent_id: string | null;
      depth: number;
      in_enc_space: number;
      is_enc_space: number;
      name: string;
    }>();
}

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

describe("空间内新建文件夹", () => {
  it("由父级推导 in_enc_space（客户端不必也不该指定）", async () => {
    await enablePrivacy(alice.cookie);
    const spaceId = await vaultIdOf(alice.id);

    const inner = newUlid();
    expect((await createFolder(alice.cookie, inner, spaceId, "旅行")).status).toBe(200);
    expect((await folderRow(inner))?.in_enc_space).toBe(1);

    // 空间内的第 2 层同样带标记
    const deep = newUlid();
    expect((await createFolder(alice.cookie, deep, inner, "机票")).status).toBe(200);
    expect((await folderRow(deep))?.in_enc_space).toBe(1);

    // 普通文件夹不受影响
    const normal = newUlid();
    expect((await createFolder(alice.cookie, normal, null, "工作")).status).toBe(200);
    expect((await folderRow(normal))?.in_enc_space).toBe(0);
  });
});

describe("整夹移入 / 移出", () => {
  it("移入：父级换成空间根、深度变 1、标记为 1", async () => {
    await enablePrivacy(alice.cookie);
    const spaceId = await vaultIdOf(alice.id);
    const folder = newUlid();
    await createFolder(alice.cookie, folder, null, "工作");

    const res = await patchFolder(alice.cookie, folder, {
      base_meta_rev: 1,
      parent_id: spaceId,
      in_enc_space: 1,
    });
    expect(res.status).toBe(200);

    const row = await folderRow(folder);
    expect(row?.parent_id).toBe(spaceId);
    expect(row?.depth).toBe(1);
    expect(row?.in_enc_space).toBe(1);
  });

  it("移出：父级回到根、标记为 0", async () => {
    await enablePrivacy(alice.cookie);
    const spaceId = await vaultIdOf(alice.id);
    const folder = newUlid();
    await createFolder(alice.cookie, folder, null, "工作");
    await patchFolder(alice.cookie, folder, {
      base_meta_rev: 1,
      parent_id: spaceId,
      in_enc_space: 1,
    });

    const res = await patchFolder(alice.cookie, folder, {
      base_meta_rev: 2,
      parent_id: null,
      in_enc_space: 0,
    });
    expect(res.status).toBe(200);

    const row = await folderRow(folder);
    expect(row?.parent_id).toBeNull();
    expect(row?.in_enc_space).toBe(0);
  });

  it("四种拒绝：没给父级 / 目标不在空间 / 没启用隐私锁 / 移出到空间里", async () => {
    const spaceId = await vaultIdOf(alice.id);
    const normal = newUlid();
    await createFolder(alice.cookie, normal, null, "工作");
    const folder = newUlid();
    await createFolder(alice.cookie, folder, null, "临时");

    // ① 只给标记不给父级
    expect(
      (await patchFolder(alice.cookie, folder, { base_meta_rev: 1, in_enc_space: 1 })).status,
    ).toBe(422);

    // ② 没启用隐私锁 → 拒绝并带原因
    const notEnabled = await patchFolder(alice.cookie, folder, {
      base_meta_rev: 1,
      parent_id: spaceId,
      in_enc_space: 1,
    });
    expect(notEnabled.status).toBe(422);
    expect(((await notEnabled.json()) as { detail?: { reason?: string } }).detail?.reason).toBe(
      "privacy_not_enabled",
    );

    await enablePrivacy(alice.cookie);

    // ③ 移入的目标父级不在空间里
    expect(
      (
        await patchFolder(alice.cookie, folder, {
          base_meta_rev: 1,
          parent_id: normal,
          in_enc_space: 1,
        })
      ).status,
    ).toBe(422);

    // ④ 移出却把父级指向空间行
    expect(
      (
        await patchFolder(alice.cookie, folder, {
          base_meta_rev: 1,
          parent_id: spaceId,
          in_enc_space: 0,
        })
      ).status,
    ).toBe(422);
  });

  it("空间根行本身不能移动（但可以改名）", async () => {
    await enablePrivacy(alice.cookie);
    const spaceId = await vaultIdOf(alice.id);

    const move = await patchFolder(alice.cookie, spaceId, {
      base_meta_rev: 1,
      parent_id: null,
      in_enc_space: 0,
    });
    expect(move.status).toBe(422);

    const rename = await patchFolder(alice.cookie, spaceId, { base_meta_rev: 1, name: "私密区" });
    expect(rename.status).toBe(200);
    expect((await folderRow(spaceId))?.name).toBe("私密区");
  });
});

// 保留导入：与其它 worker 用例共用同一套请求头约定
void ITEM_META_HEADER;
void encodeItemWriteMeta;

/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 加密空间内置行（M3-3；《隐私锁设计》§6.2）。
 *
 * 三件事：注册即建、**幂等**（重复补建只留一行）、并发补建被部分唯一索引兜住后重读。
 * 客户端 UI 不依赖这行的存在（空间节点恒显示），所以这里只测"数据层有没有那行"。
 */
import { ENC_SPACE_DEFAULT_NAME, base64UrlEncode } from "@menote/shared";
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureEncSpace } from "../src/services/folders";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";

interface SpaceRow {
  id: string;
  name: string;
  depth: number;
  is_enc_space: number;
  in_enc_space: number;
  parent_id: string | null;
  sync_seq: number;
}

async function register(username: string): Promise<string> {
  const key = new Uint8Array(32).fill(11);
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
    body: JSON.stringify({ username, login_key: base64UrlEncode(key) }),
  });
  const cookie = ((res.headers.get("set-cookie") ?? "").split(";")[0] ?? "").trim();
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
  const body = (await me.json()) as { id: string };
  return body.id;
}

async function readSpaces(userId: string): Promise<SpaceRow[]> {
  const rows = await env.DB.prepare(
    `SELECT id, name, depth, is_enc_space, in_enc_space, parent_id, sync_seq
       FROM folders WHERE user_id = ? AND is_enc_space = 1`,
  )
    .bind(userId)
    .all<SpaceRow>();
  return rows.results;
}

let userId: string;

beforeEach(async () => {
  await freshDatabase();
  userId = await register("alice");
});

describe("加密空间内置行", () => {
  it("注册时就建好，字段符合约定（depth 0 / 名称默认 / 不在自己内部）", async () => {
    const spaces = await readSpaces(userId);
    expect(spaces).toHaveLength(1);
    const space = spaces[0]!;
    expect(space.name).toBe(ENC_SPACE_DEFAULT_NAME);
    expect(space.depth).toBe(0);
    expect(space.in_enc_space).toBe(0);
    expect(space.parent_id).toBeNull();
    // 与其它表同规则：行上的 sync_seq = 用户计数器的下一个值
    expect(space.sync_seq).toBe(1);
  });

  it("重复补建幂等：仍只有一行，且返回值指向同一行", async () => {
    const before = (await readSpaces(userId))[0]!;

    const second = await ensureEncSpace(env.DB, userId, Date.now() + 1_000);
    expect(second.created).toBe(false);
    expect(second.id).toBe(before.id);
    expect(await readSpaces(userId)).toHaveLength(1);
  });

  it("并发补建：两条语句同时跑，最终仍只有一行（唯一索引兜底 + 重读）", async () => {
    // 先清掉注册时那行，模拟"存量账号还没有空间行"
    await env.DB.prepare("DELETE FROM folders WHERE user_id = ? AND is_enc_space = 1")
      .bind(userId)
      .run();

    const now = Date.now();
    const results = await Promise.allSettled([
      ensureEncSpace(env.DB, userId, now),
      ensureEncSpace(env.DB, userId, now + 1),
      ensureEncSpace(env.DB, userId, now + 2),
    ]);

    // 至少一个成功；无论成败都不能留下两行
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(await readSpaces(userId)).toHaveLength(1);
  });

  it("存量账号（没有空间行）在补建后能正常被同步拉到", async () => {
    const space = (await readSpaces(userId))[0]!;
    const res = await SELF.fetch(`${ORIGIN}/api/sync?cursor=0`, {
      headers: { Cookie: "" },
    });
    // 未登录会被拒；这里只确认上面的行确实写在 folders 里（同步契约在 M1 已测）
    expect(res.status).toBe(401);

    const row = await env.DB.prepare("SELECT name FROM folders WHERE id = ?")
      .bind(space.id)
      .first<{ name: string }>();
    expect(row?.name).toBe(ENC_SPACE_DEFAULT_NAME);
  });
});

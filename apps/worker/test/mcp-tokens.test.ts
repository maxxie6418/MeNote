/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * MCP 令牌管理（M6 批 1）的集成用例：四个会话接口。
 *
 * 盯的是设计稿 §三的底线：
 * - **完整令牌只在创建响应里出现一次**，此后任何接口都只给 `token_prefix`；
 * - **哈希域隔离**：拿一个真实会话令牌当 MCP 令牌用必须被拒（这是本批最要紧的一条，
 *   写错就是一条实打实的越权——见 `services/mcp/tokens.ts` 的文件头）；
 * - 撤销 / 过期**立即生效**，撤销幂等；
 * - 有效令牌 20 个上限，达上限时 409；
 * - 范围里的文件夹逐个校验归属，**加密空间不能当范围**（否则 agent 会以为自己参数错了）；
 * - 审计分页在**同一毫秒**落两行时不漏行（游标 `at:id`）。
 */
import { base64UrlEncode, newUlid, type McpTokenRecord } from "@menote/shared";
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { SQL_INSERT_AUDIT_LOG } from "../src/db/mcp-tables";
import { hashMcpToken } from "../src/services/mcp/tokens";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";

function headers(cookie?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Menote": "1",
    Origin: ORIGIN,
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

function loginKey(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return base64UrlEncode(bytes);
}

/** base64url → 字节（算"会话令牌裸字节的 SHA-256"要用） */
function base64UrlBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function registerUser(username: string, seed: number): Promise<{ cookie: string; userId: string }> {
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ username, login_key: loginKey(seed) }),
  });
  const cookie = (res.headers.get("set-cookie")?.split(";")[0] ?? "").trim();
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: headers(cookie) });
  const { id: userId } = (await me.json()) as { id: string };
  return { cookie, userId };
}

/** 第二个及以后的账号要先开注册（首位注册者即 owner，注册默认关） */
async function openRegistration(cookie: string): Promise<void> {
  await SELF.fetch(`${ORIGIN}/api/admin/registration`, {
    method: "PUT",
    headers: headers(cookie),
    body: JSON.stringify({ open: true }),
  });
}

async function createToken(cookie: string, body: Record<string, unknown> = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/mcp/tokens`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({ name: "测试令牌", perms: 1, ...body }),
  });
}

/** 建一个普通文件夹，返回它的 id */
async function makeFolder(userId: string, name: string): Promise<string> {
  const id = newUlid();
  await env.DB.prepare(
    "INSERT INTO folders (id, user_id, parent_id, is_enc_space, in_enc_space, name, depth, position, meta_rev, sync_seq, created_at, updated_at) VALUES (?, ?, NULL, 0, 0, ?, 1, 0, 1, 0, ?, ?)",
  )
    .bind(id, userId, name, Date.now(), Date.now())
    .run();
  return id;
}

/** 加密空间内置行的 id（注册时补建的那条） */
async function encSpaceId(userId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM folders WHERE user_id = ? AND is_enc_space = 1")
    .bind(userId)
    .first<{ id: string }>();
  if (!row) throw new Error("缺少加密空间行");
  return row.id;
}

async function insertAudit(
  userId: string,
  tokenId: string,
  at: number,
  overrides: { tool?: string; result?: string } = {},
): Promise<string> {
  const id = newUlid();
  await env.DB.prepare(SQL_INSERT_AUDIT_LOG)
    .bind(
      id,
      userId,
      tokenId,
      overrides.tool ?? "edit_item",
      null,
      null,
      null,
      overrides.result ?? "ok",
      null,
      at,
    )
    .run();
  return id;
}

beforeEach(async () => {
  await freshDatabase();
});

describe("MCP 令牌管理（批 1）", () => {
  it("创建：响应里有完整令牌（只此一次），列表里只有前缀", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const created = (await (await createToken(cookie, { name: "公司电脑" })).json()) as {
      secret: string;
      token: McpTokenRecord;
    };

    expect(created.secret.startsWith("mn_")).toBe(true);
    expect(created.token.token_prefix.startsWith("mn_")).toBe(true);
    expect(created.token.status).toBe("active");
    // 完整串比前缀长得多——确认列表里那份确实不是同一个东西
    expect(created.secret.length).toBeGreaterThan(created.token.token_prefix.length + 4);

    const list = (await (
      await SELF.fetch(`${ORIGIN}/api/mcp/tokens`, { headers: headers(cookie) })
    ).json()) as { tokens: McpTokenRecord[] };
    expect(list.tokens).toHaveLength(1);
    expect(list.tokens[0]?.token_prefix).toBe(created.token.token_prefix);
    // 列表里绝不能出现完整令牌，也绝不能出现哈希
    expect(JSON.stringify(list)).not.toContain(created.secret);
    expect(JSON.stringify(list)).not.toContain("token_hash");
  });

  it("权限位归一：三个可选项都不勾也至少是只读（bit 0 恒含）", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const created = (await (await createToken(cookie, { perms: 0 })).json()) as {
      token: McpTokenRecord;
    };
    expect(created.token.perms).toBe(1);
  });

  it("哈希域隔离：会话令牌字符串不能被当成 MCP 令牌（越权防线）", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    await createToken(cookie);

    const row = await env.DB.prepare("SELECT token_hash FROM api_tokens WHERE user_id = ?")
      .bind(userId)
      .first<{ token_hash: ArrayBuffer }>();
    expect(row).toBeTruthy();

    // 会话令牌是同样长度的裸 base64url，它在库里存的是**裸字节**的 SHA-256
    const sessionToken = loginKey(9);
    const sessionHash = await crypto.subtle.digest("SHA-256", base64UrlBytes(sessionToken));
    const asBytes = new Uint8Array(sessionHash);
    const mine = new Uint8Array(row!.token_hash);
    expect(asBytes.length).toBe(mine.length);
    // 证明两者确实是不同的哈希值（否则下面那条断言就没有说服力）
    expect(asBytes.some((byte, i) => byte !== mine[i])).toBe(true);

    // 而 hashMcpToken 对没有 mn_ 前缀的串直接返回 null —— 连哈希都不算
    expect(await hashMcpToken(sessionToken)).toBeNull();
  });

  it("撤销：立即生效且幂等（重复撤销不报错）", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const created = (await (await createToken(cookie)).json()) as { token: McpTokenRecord };

    const first = await SELF.fetch(`${ORIGIN}/api/mcp/tokens/${created.token.id}`, {
      method: "DELETE",
      headers: headers(cookie),
    });
    expect(first.status).toBe(200);
    expect(((await first.json()) as McpTokenRecord).status).toBe("revoked");

    const again = await SELF.fetch(`${ORIGIN}/api/mcp/tokens/${created.token.id}`, {
      method: "DELETE",
      headers: headers(cookie),
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as McpTokenRecord).status).toBe("revoked");

    // 库里保留 revoked_at（审计行还要指回它），不物理删
    const row = await env.DB.prepare("SELECT revoked_at FROM api_tokens WHERE id = ?")
      .bind(created.token.id)
      .first<{ revoked_at: number | null }>();
    expect(row?.revoked_at).toBeGreaterThan(0);
  });

  it("有效令牌上限 20：第 21 个被拒，撤销一个后可再建", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const res = await createToken(cookie, { name: `t${i}` });
      expect(res.status).toBe(201);
      ids.push(((await res.json()) as { token: McpTokenRecord }).token.id);
    }

    const overflow = await createToken(cookie, { name: "第 21 个" });
    expect(overflow.status).toBe(409);
    expect(((await overflow.json()) as { code: string }).code).toBe("rev_conflict");

    await SELF.fetch(`${ORIGIN}/api/mcp/tokens/${ids[0]}`, {
      method: "DELETE",
      headers: headers(cookie),
    });
    expect((await createToken(cookie, { name: "补一个" })).status).toBe(201);
  });

  it("过期令牌不占额度（否则攒一堆过期令牌就再也建不了新的）", async () => {
    const { cookie } = await registerUser("owner1", 1);
    for (let i = 0; i < 20; i += 1) {
      // expires_in 给最小合法档，再用 SQL 把它推到过去
      const res = await createToken(cookie, { name: `t${i}`, expires_in: 60_000 });
      expect(res.status).toBe(201);
      const id = ((await res.json()) as { token: McpTokenRecord }).token.id;
      await env.DB.prepare("UPDATE api_tokens SET expires_at = 1 WHERE id = ?").bind(id).run();
    }
    expect((await createToken(cookie, { name: "还能建" })).status).toBe(201);
  });

  it("列表的状态列：撤销与过期分开显示", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const revoked = (
      (await (await createToken(cookie, { name: "已撤销" })).json()) as { token: McpTokenRecord }
    ).token;
    const expired = (
      (await (await createToken(cookie, { name: "已过期", expires_in: 60_000 })).json()) as {
        token: McpTokenRecord;
      }
    ).token;
    await env.DB.prepare("UPDATE api_tokens SET expires_at = 1 WHERE id = ?")
      .bind(expired.id)
      .run();
    await SELF.fetch(`${ORIGIN}/api/mcp/tokens/${revoked.id}`, {
      method: "DELETE",
      headers: headers(cookie),
    });

    const list = (await (
      await SELF.fetch(`${ORIGIN}/api/mcp/tokens`, { headers: headers(cookie) })
    ).json()) as { tokens: McpTokenRecord[] };
    const byId = new Map(list.tokens.map((token) => [token.id, token.status]));
    expect(byId.get(revoked.id)).toBe("revoked");
    expect(byId.get(expired.id)).toBe("expired");
  });

  it("范围：越权文件夹被拒、加密空间被拒、正常文件夹放行", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    await openRegistration(cookie);
    const other = await registerUser("family", 2);

    const mine = await makeFolder(userId, "我的");
    const theirs = await makeFolder(other.userId, "别人的");
    const space = await encSpaceId(userId);

    expect((await createToken(cookie, { folder_scope: [mine] })).status).toBe(201);
    expect((await createToken(cookie, { folder_scope: [theirs] })).status).toBe(422);
    expect((await createToken(cookie, { folder_scope: [space] })).status).toBe(422);
    expect((await createToken(cookie, { folder_scope: ["不是 ULID"] })).status).toBe(422);
  });

  it("include_memos 默认不勾选（0）——不依赖建表语句的列默认值（DDL 默认是 1）", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const created = (await (await createToken(cookie)).json()) as { token: McpTokenRecord };
    expect(created.token.include_memos).toBe(0);

    const on = (await (await createToken(cookie, { include_memos: 1, name: "含 Memo" })).json()) as {
      token: McpTokenRecord;
    };
    expect(on.token.include_memos).toBe(1);
  });

  it("allow_url 默认关闭，限速默认 60", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const created = (await (await createToken(cookie)).json()) as { token: McpTokenRecord };
    expect(created.token.allow_url).toBe(0);
    expect(created.token.rate_per_min).toBe(60);
    expect((await createToken(cookie, { rate_per_min: 0 })).status).toBe(422);
    expect((await createToken(cookie, { rate_per_min: 601 })).status).toBe(422);
  });

  it("有效期预设换算成绝对时间戳；永不过期为 null", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const before = Date.now();
    const seven = (
      (await (await createToken(cookie, { expires_in: "7d" })).json()) as { token: McpTokenRecord }
    ).token;
    expect(seven.expires_at).toBeGreaterThanOrEqual(before + 7 * 86_400_000);
    expect(seven.expires_at).toBeLessThanOrEqual(Date.now() + 7 * 86_400_000);

    const never = (
      (await (await createToken(cookie, { expires_in: null })).json()) as { token: McpTokenRecord }
    ).token;
    expect(never.expires_at).toBeNull();
    expect((await createToken(cookie, { expires_in: 30_000 })).status).toBe(422);
  });

  it("审计分页：同一毫秒落两行也不漏（游标是 at:id，不是光 at）", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const created = (await (await createToken(cookie)).json()) as { token: McpTokenRecord };
    const at = 1_700_000_000_000;
    // 同一个 at 落两行——只按 at 分页会漏掉一行或重复
    await insertAudit(userId, created.token.id, at, { tool: "create_item" });
    await insertAudit(userId, created.token.id, at, { tool: "trash_item" });
    await insertAudit(userId, created.token.id, at - 1000, { tool: "organize_item" });

    const first = (await (
      await SELF.fetch(`${ORIGIN}/api/mcp/tokens/${created.token.id}/audit?limit=2`, {
        headers: headers(cookie),
      })
    ).json()) as { entries: Array<{ tool: string }>; next_cursor: string | null };
    expect(first.entries).toHaveLength(2);
    expect(first.next_cursor).toBeTruthy();

    const second = (await (
      await SELF.fetch(
        `${ORIGIN}/api/mcp/tokens/${created.token.id}/audit?limit=2&cursor=${encodeURIComponent(
          first.next_cursor!,
        )}`,
        { headers: headers(cookie) },
      )
    ).json()) as { entries: Array<{ tool: string }>; next_cursor: string | null };
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0]?.tool).toBe("organize_item");
    expect(second.next_cursor).toBeNull();
  });

  it("审计与令牌：别人的令牌一律 404（与不存在同形，不泄露存在性）", async () => {
    const { cookie } = await registerUser("owner1", 1);
    await openRegistration(cookie);
    const other = await registerUser("family", 2);
    const theirs = ((await (await createToken(other.cookie)).json()) as { token: McpTokenRecord })
      .token;

    const calls = [
      SELF.fetch(`${ORIGIN}/api/mcp/tokens/${theirs.id}/audit`, { headers: headers(cookie) }),
      SELF.fetch(`${ORIGIN}/api/mcp/tokens/${theirs.id}`, {
        method: "DELETE",
        headers: headers(cookie),
      }),
    ];
    for (const call of calls) {
      const res = await call;
      expect(res.status).toBe(404);
    }
  });

  it("未登录一律 401；CSRF 头缺失一律 403", async () => {
    const { cookie } = await registerUser("owner1", 1);
    expect((await SELF.fetch(`${ORIGIN}/api/mcp/tokens`)).status).toBe(401);

    const noCsrf = await SELF.fetch(`${ORIGIN}/api/mcp/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ name: "x", perms: 1 }),
    });
    expect(noCsrf.status).toBe(403);
  });
});

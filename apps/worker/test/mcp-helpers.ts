/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * MCP 集成用例的共用助手（批 2 / 批 3 共用）。
 *
 * 提成独立文件是因为写类用例分成了 `mcp-write.test.ts`（六个工具的机制）与
 * `mcp-write-scope.test.ts`（权限与可见性）——后者单开是因为前者已经顶到 500 行预算，
 * 而把注册 / 建令牌 / 造条目这套样板抄一遍只为了凑行数不值得。
 */
import {
  MCP_PERM_CREATE,
  MCP_PERM_EDIT,
  MCP_PERM_READ,
  MCP_PERM_TRASH,
  base64UrlEncode,
  newUlid,
} from "@menote/shared";
import { SELF, env } from "cloudflare:test";
import { expect } from "vitest";

export const ORIGIN = "https://menote.test";

export function sessionHeaders(cookie?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Menote": "1",
    Origin: ORIGIN,
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

/** 注册一个账号；登录密钥必须是 32 字节 base64url（服务端 `decodeLoginKey` 验长度） */
export async function registerUser(
  username: string,
  seed: number,
): Promise<{ cookie: string; userId: string }> {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: sessionHeaders(),
    body: JSON.stringify({ username, login_key: base64UrlEncode(bytes) }),
  });
  const cookie = (res.headers.get("set-cookie")?.split(";")[0] ?? "").trim();
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: sessionHeaders(cookie) });
  const { id: userId } = (await me.json()) as { id: string };
  return { cookie, userId };
}

/** 第二个及以后的账号要先开注册（首位注册者即 owner，注册默认关） */
export async function openRegistration(cookie: string): Promise<void> {
  await SELF.fetch(`${ORIGIN}/api/admin/registration`, {
    method: "PUT",
    headers: sessionHeaders(cookie),
    body: JSON.stringify({ open: true }),
  });
}

/** 建一个 MCP 令牌，返回完整串（批 1 的接口） */
export async function makeToken(
  cookie: string,
  body: Record<string, unknown> = {},
): Promise<{ secret: string; token: { id: string } }> {
  const res = await SELF.fetch(`${ORIGIN}/api/mcp/tokens`, {
    method: "POST",
    headers: sessionHeaders(cookie),
    body: JSON.stringify({
      name: "测试令牌",
      perms: MCP_PERM_READ | MCP_PERM_CREATE | MCP_PERM_EDIT | MCP_PERM_TRASH,
      rate_per_min: 600,
      ...body,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { secret: string; token: { id: string } };
}

export interface RpcResult {
  result?: { structuredContent?: unknown; isError?: boolean };
  error?: { code: number; message: string };
}

/** 一次 `tools/call`（`id` 固定为 1；本仓库的用例不关心 id 的回显） */
export async function call(
  secret: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: RpcResult }> {
  const res = await SELF.fetch(`${ORIGIN}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  return { status: res.status, body: (await res.json()) as RpcResult };
}

/** 任意 JSON-RPC 方法（`initialize` / `tools/list` / `ping`…） */
export async function rpc(
  secret: string,
  body: Record<string, unknown>,
  path = "/mcp",
): Promise<{ status: number; body: RpcResult & { result?: unknown } }> {
  const res = await SELF.fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as RpcResult };
}

/** 成功时的载荷；失败时抛错（"这步应该成功"的地方用它） */
export function ok(rpc: RpcResult): Record<string, unknown> {
  if (rpc.result?.isError) throw new Error(`工具返回失败：${JSON.stringify(rpc.result)}`);
  return (rpc.result?.structuredContent ?? {}) as Record<string, unknown>;
}

/** 失败时返回中文原因（"这步应该失败"的地方用它） */
export function failure(rpc: RpcResult): string {
  expect(rpc.result?.isError, `本该失败却成功了：${JSON.stringify(rpc.result)}`).toBe(true);
  return String((rpc.result?.structuredContent as { error?: string } | undefined)?.error ?? "");
}

export interface SeedFlags {
  encSelf?: number;
  inEncSpace?: number;
  deleted?: boolean;
  folderId?: string | null;
  type?: string;
  title?: string | null;
  tags?: string;
  updatedAt?: number;
  sizeBytes?: number;
}

/** 直接造一条条目（绕过同步端点：测试里更快也更好控）；返回它的 id */
export async function seedItem(userId: string, id: string, body: string, flags: SeedFlags = {}): Promise<string> {
  const now = flags.updatedAt ?? Date.now();
  const type = flags.type ?? "note";
  // Memo 有三条建表 CHECK：必须有时间戳、不能有标题、不能挂文件夹
  const memoAt = type === "memo" ? now : null;
  const title = flags.title === undefined ? (type === "memo" ? null : "标题") : flags.title;
  await env.DB.prepare(
    `INSERT INTO items (id, user_id, type, folder_id, title, enc_self, in_enc_space, size_bytes, content_hash, tags, memo_at, is_task, task_status, task_due, task_priority, pinned, starred, rev, meta_rev, sync_seq, created_at, updated_at, last_edit_at, last_device, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, 0, 0, 1, 1, 1, ?, ?, ?, NULL, ?)`,
  )
    .bind(
      id,
      userId,
      type,
      type === "memo" ? null : (flags.folderId ?? null),
      title,
      flags.encSelf ?? 0,
      flags.inEncSpace ?? 0,
      flags.sizeBytes ?? new TextEncoder().encode(body).length,
      "h" + id,
      flags.tags ?? "[]",
      memoAt,
      now,
      now,
      now,
      flags.deleted ? now : null,
    )
    .run();
  await env.DB.prepare("INSERT INTO item_bodies (item_id, body) VALUES (?, ?)").bind(id, body).run();
  return id;
}

export async function makeFolder(userId: string, name: string, parentId: string | null = null): Promise<string> {
  const id = newUlid();
  await env.DB.prepare(
    "INSERT INTO folders (id, user_id, parent_id, is_enc_space, in_enc_space, name, depth, position, meta_rev, sync_seq, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?, 0, 1, 0, ?, ?)",
  )
    .bind(id, userId, parentId, name, parentId === null ? 1 : 2, Date.now(), Date.now())
    .run();
  return id;
}

export interface AuditRow {
  tool: string;
  result: string;
  rev_before: number | null;
  rev_after: number | null;
}

/** 某条目上的审计行（按时间与 id 排序，同毫秒两行也稳定） */
export async function auditFor(itemId: string): Promise<AuditRow[]> {
  const rows = await env.DB.prepare(
    "SELECT tool, result, rev_before, rev_after FROM audit_log WHERE item_id = ? ORDER BY at, id",
  )
    .bind(itemId)
    .all<AuditRow>();
  return rows.results ?? [];
}

export async function countAudit(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>();
  return row?.n ?? 0;
}

/** 某条目上的 `pre_mcp` 版本行 */
export async function preMcpVersions(itemId: string): Promise<Array<{ keep: number; rev: number }>> {
  const rows = await env.DB.prepare(
    "SELECT keep, rev FROM item_versions WHERE item_id = ? AND reason = 'pre_mcp' ORDER BY created_at, id",
  )
    .bind(itemId)
    .all<{ keep: number; rev: number }>();
  return rows.results ?? [];
}

export async function bodyOf(itemId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT body FROM item_bodies WHERE item_id = ?").bind(itemId).first<{ body: string }>();
  return row?.body ?? "";
}

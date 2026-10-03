/**
 * MCP 令牌的**管理侧**服务（M6 批 1；设计 §三）：
 * 建（含 20 个上限）、列、撤销、审计分页。**用令牌进来的那侧**（鉴权解析、限速、
 * `last_used_at`）是批 2 的 `services/mcp/auth.ts`——两份是两条独立的演进线，混在一起两摊都说不清。
 *
 * ## 哈希域隔离（本文件最要紧的一段，改动前先读完）
 *
 * 会话令牌存的是 `SHA-256(base64UrlDecode(token))`，即**裸随机字节**的哈希
 * （见 `services/tokens.ts` 的 `hashSessionToken`）。而 MCP 令牌恰好也是 32 字节随机数
 * 走 base64url。**若两边都哈希裸字节，一个会话令牌字符串就能被当成合法 MCP 令牌鉴权通过**——
 * 令牌的权限位、范围、审计全挂在它名下，那是一条实打实的越权。
 *
 * 所以这里哈希的是**整个令牌字符串（含 `mn_` 前缀）**的 UTF-8 字节，两类令牌因此落在
 * 不同的哈希域里。再加上 `mn_` 前缀的前置检查，非 MCP 令牌连哈希都不用算。
 *
 * 另一处口径：**`include_memos` 一律显式写入**，不依赖建表语句的列默认值
 * （DDL 默认 1 与功能拆解 M17-03「默认不勾选＝不可见」相反，设计 §1.3）。
 */
import {
  MCP_DEFAULT_RATE_PER_MIN,
  MCP_EXPIRY_PRESETS,
  MCP_MAX_ACTIVE_TOKENS,
  MCP_TOKEN_BYTES,
  MCP_TOKEN_PREFIX,
  base64UrlDecode,
  base64UrlEncode,
  newUlid,
  normalizeMcpPerms,
  type CreateMcpTokenRequest,
  type McpAuditEntry,
  type McpTokenCreated,
  type McpTokenListResponse,
  type McpTokenRecord,
} from "@menote/shared";
import {
  SQL_COUNT_ACTIVE_API_TOKENS,
  SQL_INSERT_API_TOKEN,
  SQL_LIST_API_TOKENS,
  SQL_REVOKE_API_TOKEN,
  SQL_SELECT_API_TOKEN_BY_ID,
  SQL_SELECT_AUDIT_BY_TOKEN,
} from "../../db/mcp-tables";
import { SQL_SELECT_FOLDER_BY_ID } from "../../db/tables";
import { DomainError } from "../../errors";

/** 审计分页的游标编码：`at:id`（同毫秒两行时靠 id 兜底排序，设计 §七） */
export function encodeAuditCursor(at: number, id: string): string {
  return base64UrlEncode(new TextEncoder().encode(`${at}:${id}`));
}

function decodeAuditCursor(cursor: string): { at: number; id: string } {
  try {
    const text = new TextDecoder().decode(base64UrlDecode(cursor));
    const at = Number.parseInt(text.slice(0, text.lastIndexOf(":")), 10);
    const id = text.slice(text.lastIndexOf(":") + 1);
    if (!Number.isFinite(at) || id === "") throw new Error("形状不合法");
    return { at, id };
  } catch {
    throw new DomainError("invalid", "分页游标不合法");
  }
}

/** 一行令牌在库里的形态（`db/mcp-tables.ts` 的几条 SELECT 共用） */
export interface ApiTokenRow {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  perms: number;
  folder_scope: string | null;
  include_memos: number;
  allow_url: number;
  rate_per_min: number;
  rate_window_start: number | null;
  rate_call_count: number;
  expires_at: number | null;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

/** 状态判定与展示共用一条口径：撤销优先于过期（都失效时先告诉用户"你撤销了它"） */
function statusOf(row: ApiTokenRow, now: number): McpTokenRecord["status"] {
  if (row.revoked_at !== null) return "revoked";
  if (row.expires_at !== null && row.expires_at <= now) return "expired";
  return "active";
}

export function toTokenRecord(row: ApiTokenRow, now: number): McpTokenRecord {
  return {
    id: row.id,
    name: row.name,
    token_prefix: row.token_prefix,
    perms: row.perms,
    folder_scope: row.folder_scope === null ? null : (JSON.parse(row.folder_scope) as string[]),
    include_memos: row.include_memos,
    allow_url: row.allow_url,
    rate_per_min: row.rate_per_min,
    expires_at: row.expires_at,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
    status: statusOf(row, now),
  };
}

/** 新鲜令牌：完整串只在这一次出现，库里只留哈希与前缀 */
export interface FreshMcpToken {
  secret: string;
  hash: ArrayBuffer;
  prefix: string;
}

/**
 * 生成 32 字节随机令牌，**并在这里就把哈希算好**。
 *
 * 哈希不交给调用方是有意的：它必须哈希**整个串**（见本文件头部的哈希域隔离），
 * 放在一处算，才不会出现"某处顺手改成了哈希裸字节"的分支。
 * `prefix` 取 base64url 前 4 字符——够认人，又不泄露可猜的部分。
 */
export async function generateMcpToken(): Promise<FreshMcpToken> {
  const body = base64UrlEncode(crypto.getRandomValues(new Uint8Array(MCP_TOKEN_BYTES)));
  const secret = MCP_TOKEN_PREFIX + body;
  const hash = await hashMcpToken(secret);
  if (!hash) throw new DomainError("invalid", "令牌生成异常");
  return { secret, hash, prefix: `${MCP_TOKEN_PREFIX}${body.slice(0, 4)}…` };
}

/**
 * 令牌字符串 → 库里存的 SHA-256。**整个串的 UTF-8 字节**（见本文件头部的哈希域隔离说明）。
 *
 * 非法输入（不是 `mn_` 开头 / base64url 部分不合法）返回 null 而不是抛错——
 * 与 `hashSessionToken` 同一形状：鉴权失败是**常态**（有人在扫），不该走异常路径。
 */
export async function hashMcpToken(token: string): Promise<ArrayBuffer | null> {
  if (!token.startsWith(MCP_TOKEN_PREFIX)) return null;
  const body = token.slice(MCP_TOKEN_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return null;
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
}

/** 有效期：预设档换算成毫秒；自定义给的是毫秒；`null` = 永不过期 */
function resolveExpiry(expiresIn: CreateMcpTokenRequest["expires_in"], now: number): number | null {
  if (expiresIn === undefined || expiresIn === null) return null;
  if (typeof expiresIn === "number") return now + expiresIn;
  return now + MCP_EXPIRY_PRESETS[expiresIn];
}

/**
 * 范围里的每个文件夹都要核三件事：**属于该用户、未删除、不是加密空间行**。
 *
 * 加密空间为什么必须拒：范围片段按 `folder_id` 展开，空间行虽然能展开，
 * 但空间内条目会被隐私条件挡掉——于是这个范围**看起来能用、实际上永远读不到东西**，
 * 而 agent 会以为是自己参数错了。不如在建令牌时就拒掉。
 */
async function assertFolderScope(
  db: D1Database,
  userId: string,
  scope: readonly string[],
): Promise<void> {
  const unique = [...new Set(scope)];
  for (const folderId of unique) {
    const folder = await db
      .prepare(SQL_SELECT_FOLDER_BY_ID)
      .bind(folderId, userId)
      .first<{ is_enc_space: number }>();
    if (!folder) throw new DomainError("invalid", "范围内的文件夹不存在");
    if (folder.is_enc_space === 1) throw new DomainError("invalid", "加密空间不能作为 MCP 的范围");
  }
}

/** 创建。达 20 个有效令牌时 409（UI 据此把「创建」置灰） */
export async function createApiToken(
  db: D1Database,
  userId: string,
  input: CreateMcpTokenRequest,
  now: number,
): Promise<McpTokenCreated> {
  const perms = normalizeMcpPerms(input.perms);
  const includeMemos = input.include_memos ?? 0;
  const allowUrl = input.allow_url ?? 0;
  const ratePerMin = input.rate_per_min ?? MCP_DEFAULT_RATE_PER_MIN;
  const scope = input.folder_scope ?? null;

  if (scope !== null) await assertFolderScope(db, userId, scope);

  const active = await db
    .prepare(SQL_COUNT_ACTIVE_API_TOKENS)
    .bind(userId, now)
    .first<{ count: number }>();
  if ((active?.count ?? 0) >= MCP_MAX_ACTIVE_TOKENS) {
    throw new DomainError("rev_conflict", `最多 ${MCP_MAX_ACTIVE_TOKENS} 个有效令牌，请先撤销一个`, {
      limit: MCP_MAX_ACTIVE_TOKENS,
      active: active?.count ?? 0,
    });
  }

  const expiresAt = resolveExpiry(input.expires_in, now);
  if (expiresAt !== null && expiresAt <= now) {
    throw new DomainError("invalid", "过期时间必须晚于现在");
  }

  const fresh = await generateMcpToken();
  const id = newUlid();
  await db
    .prepare(SQL_INSERT_API_TOKEN)
    .bind(
      id,
      userId,
      input.name,
      fresh.hash,
      fresh.prefix,
      perms,
      scope === null ? null : JSON.stringify(scope),
      includeMemos,
      allowUrl,
      ratePerMin,
      now,
    )
    .run();

  return {
    secret: fresh.secret,
    token: {
      id,
      name: input.name,
      token_prefix: fresh.prefix,
      perms,
      folder_scope: scope === null ? null : [...scope],
      include_memos: includeMemos,
      allow_url: allowUrl,
      rate_per_min: ratePerMin,
      expires_at: expiresAt,
      created_at: now,
      last_used_at: null,
      revoked_at: null,
      status: "active",
    },
  };
}

/** 我的令牌列表。**永不回显完整令牌或哈希**（设计 §3.4） */
export async function listApiTokens(db: D1Database, userId: string, now: number): Promise<McpTokenListResponse> {
  const rows = await db
    .prepare(SQL_LIST_API_TOKENS)
    .bind(userId)
    .all<ApiTokenRow>();
  return { tokens: (rows.results ?? []).map((row) => toTokenRecord(row, now)) };
}

/** 撤销：幂等（已撤销的行 `changes = 0`，直接返回现有状态而不是报错） */
export async function revokeApiToken(
  db: D1Database,
  userId: string,
  tokenId: string,
  now: number,
): Promise<McpTokenRecord> {
  const row = await db
    .prepare(SQL_SELECT_API_TOKEN_BY_ID)
    .bind(tokenId, userId)
    .first<ApiTokenRow>();
  if (!row) throw new DomainError("not_found", "令牌不存在");

  if (row.revoked_at === null) {
    await db.prepare(SQL_REVOKE_API_TOKEN).bind(now, tokenId, userId).run();
    row.revoked_at = now;
  }
  return toTokenRecord(row, now);
}

const AUDIT_PAGE_MAX = 100;

/**
 * 某令牌的审计分页。
 *
 * `cursor` 是 `at:id` 的 base64url。第一页给 `Number.MAX_SAFE_INTEGER` 当游标——
 * 于是「有没有下一页」的判定只剩 `results.length > limit`，不必写两套 SQL。
 */
export async function listTokenAudit(
  db: D1Database,
  userId: string,
  tokenId: string,
  options: { limit?: number; cursor?: string | null } = {},
  now: number = Date.now(),
): Promise<{ entries: McpAuditEntry[]; next_cursor: string | null }> {
  // 归属：别人的令牌一律 404（与"不存在"同形，不泄露存在性）
  const owned = await db
    .prepare(SQL_SELECT_API_TOKEN_BY_ID)
    .bind(tokenId, userId)
    .first<{ id: string }>();
  if (!owned) throw new DomainError("not_found", "令牌不存在");

  const limit = Math.min(Math.max(options.limit ?? 50, 1), AUDIT_PAGE_MAX);
  const head = options.cursor ? decodeAuditCursor(options.cursor) : { at: now + 1, id: "\uffff" };

  const rows = await db
    .prepare(SQL_SELECT_AUDIT_BY_TOKEN)
    .bind(userId, tokenId, head.at, head.at, head.id, limit + 1)
    .all<Omit<McpAuditEntry, "result"> & { result: string }>();

  const all = rows.results ?? [];
  const page = all.slice(0, limit);
  const last = page[page.length - 1];
  return {
    entries: page.map((row) => ({ ...row, result: row.result as McpAuditEntry["result"] })),
    next_cursor:
      all.length > limit && last ? encodeAuditCursor(last.at, last.id) : null,
  };
}

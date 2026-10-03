/**
 * MCP 令牌的**调用侧**鉴权与限速（M6 批 2；架构 §十一 的处理顺序第 1–5 步）。
 * 管理侧（建 / 列 / 撤销 / 审计分页）在 `services/mcp/tokens.ts`。
 *
 * ## 顺序一步都不能换
 *
 * 架构 §十一 给的是：令牌哈希查询 → 过期与撤销检查 → 限速 → 权限位 → 范围 → 执行 → 审计。
 * 限速排在过期 / 撤销**之后**是有意的：一张被撤销的令牌不该消耗别人的额度，
 * 而限速要写库，放在校验之后能让"非法令牌"这条路**一个字都不写**——
 * 有人在扫端点时，那条路不会变成往 D1 灌行的入口。
 *
 * ## 限速为什么顺带把 `last_used_at` 一起刷
 *
 * 定稿 §17.3 说「最多每 10 分钟更新一次 `last_used_at`」，目的是省行写入。选了 D1 计数之后，
 * **每次调用本来就要写令牌这一行**（计数自增），顺带刷 `last_used_at` 并不额外花什么，
 * 比分两次写更省。那条 10 分钟节流到这里已经没有可省的东西，故**刻意不做**——
 * 留一个"每 10 分钟才准写"的判断在这条热路径上只会制造"为什么这里没生效"的困惑。
 * 结果是 `last_used_at` 比定稿更准，不是更松。
 */
import { hasMcpPerm, MCP_TOKEN_PREFIX } from "@menote/shared";
import {
  SQL_BUMP_API_TOKEN_CALL,
  SQL_RESET_API_TOKEN_WINDOW,
  SQL_SELECT_API_TOKEN_BY_HASH,
} from "../../db/mcp-tables";
import { DomainError } from "../../errors";
import { hashMcpToken, type ApiTokenRow } from "./tokens";

/** 限速窗口的宽度（一分钟） */
const RATE_WINDOW_MS = 60_000;

/** 一次调用携带的主体（鉴权通过后，范围与权限判定都用它） */
export interface McpPrincipal {
  tokenId: string;
  userId: string;
  name: string;
  perms: number;
  /** `null` = 全部内容；否则文件夹 ID 数组（含子文件夹由 SQL 展开） */
  folderScope: string[] | null;
  includeMemos: boolean;
  allowUrl: boolean;
}

/** 库里那行 + 它的哈希（限速窗口推过后要按哈希重读） */
interface AuthRow extends ApiTokenRow {
  token_hash: ArrayBuffer;
}

/**
 * 限速判定 + 计数。
 *
 * **条件自增**而不是"读出来算好再写回去"：后者在并发下会让两个请求都读到 count = 59、
 * 都判定通过、然后都写 60，同一分钟就多放行 2 次。`WHERE rate_window_start = ?`
 * 让它们挤在同一条语句上排队，只有一个能拿到 `changes = 1`。
 *
 * 拿到 0 说明窗口在读与写之间被别人推过了——按哈希重读一次再判，**最多重来一次**
 * （设计 §3.5）。不无限重试：再试也未必赢得过别人，而这是每次调用都在走的热路。
 */
async function enforceRateLimit(
  db: D1Database,
  hash: ArrayBuffer,
  row: ApiTokenRow,
  now: number,
): Promise<void> {
  let current = row;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const windowStart = Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
    const sameWindow = current.rate_window_start === windowStart;

    if (sameWindow && current.rate_call_count >= current.rate_per_min) {
      throw new DomainError("rate_limited", `调用超过每分钟 ${current.rate_per_min} 次，请稍后再试`);
    }

    const statement = sameWindow
      ? db.prepare(SQL_BUMP_API_TOKEN_CALL).bind(now, current.id, windowStart)
      : db.prepare(SQL_RESET_API_TOKEN_WINDOW).bind(windowStart, now, current.id);
    if (((await statement.run()).meta.changes ?? 0) === 1) return;

    const reread = await db.prepare(SQL_SELECT_API_TOKEN_BY_HASH).bind(hash).first<AuthRow>();
    if (!reread) throw new DomainError("unauthenticated", "令牌无效");
    current = reread;
  }
  throw new DomainError("rate_limited", "请求过于频繁，请稍后再试");
}

/**
 * 鉴权主流程（架构 §十一 的第 1–4 步）。
 *
 * 失败一律抛 `DomainError`，但**具体原因（不存在 / 已撤销 / 已过期）在响应里不区分**，
 * 都回"令牌无效"——与分享访客侧「不区分原因」的防探测同源。
 */
export async function authenticateMcp(
  db: D1Database,
  rawToken: string,
  now: number,
): Promise<McpPrincipal> {
  const hash = await hashMcpToken(rawToken);
  if (!hash) throw new DomainError("unauthenticated", "令牌无效");

  const row = await db.prepare(SQL_SELECT_API_TOKEN_BY_HASH).bind(hash).first<AuthRow>();
  if (!row) throw new DomainError("unauthenticated", "令牌无效");
  if (row.revoked_at !== null) throw new DomainError("unauthenticated", "令牌无效");
  if (row.expires_at !== null && row.expires_at <= now) throw new DomainError("unauthenticated", "令牌无效");

  await enforceRateLimit(db, hash, row, now);

  return {
    tokenId: row.id,
    userId: row.user_id,
    name: row.name,
    perms: row.perms,
    folderScope: row.folder_scope === null ? null : (JSON.parse(row.folder_scope) as string[]),
    includeMemos: row.include_memos === 1,
    allowUrl: row.allow_url === 1,
  };
}

/**
 * 权限位检查（架构 §十一 第 5 步）。
 *
 * 缺权限**不是**协议错误——它是工具执行的结果，所以调用方把它翻成 `isError: true`
 * 而不是 JSON-RPC error（设计 §5.2）：客户端要能把这个提示原样念给用户听并自行纠正。
 */
export function assertMcpPerm(principal: McpPrincipal, bit: number, permLabel: string): void {
  if (!hasMcpPerm(principal.perms, bit)) {
    throw new DomainError("forbidden", `该令牌没有「${permLabel}」权限`);
  }
}

/** URL 方式（`/mcp/k/<令牌>`）要令牌显式勾过"允许通过 URL 使用"（设计 §17.2） */
export function assertUrlAllowed(principal: McpPrincipal): void {
  if (!principal.allowUrl) throw new DomainError("unauthenticated", "该令牌不允许通过 URL 使用");
}

/** `Authorization: Bearer mn_…` → 令牌串；不是这个形状返回 null（由调用方按 401 处理） */
export function bearerToken(header: string | undefined | null): string | null {
  if (!header) return null;
  return /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1] ?? null;
}

/** 路径段形态的令牌：必须是完整的 `mn_…`，形状不对连哈希都不算（省一次 SHA-256） */
export function pathToken(raw: string | undefined): string | null {
  if (!raw || !raw.startsWith(MCP_TOKEN_PREFIX)) return null;
  return raw;
}

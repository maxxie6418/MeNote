/**
 * MCP 审计与幂等（M6 批 3；设计 §六-4、§七）。
 *
 * ## 记什么、不记什么
 *
 * **只记 6 个写类工具的调用**，5 个只读工具不记（DDL 注释「仅记录写操作」）。
 * 四种结果都记：`ok` / `conflict` / `denied` / `error`——`denied` 值得记是因为
 * **它正是「agent 越权尝试」的证据**。
 *
 * ## 审计与幂等为什么都要「跟写入同一个 batch」
 *
 * 架构 §十一 写死了「执行、审计与幂等记录（与写入在同一个 batch 中）」。
 * 分两次写的话，「写入成功但审计丢了」正是审计要防的那类事故。
 * 为此那四个既有写函数都加了**可选**尾随语句参数（默认空 = 行为完全不变）。
 *
 * ## 幂等的四步（设计 §六-4）
 *
 * 1. 读 `mcp_operations` → 命中且 `request_hash` 相同 → 直接返回存的结果；不同 → 报错；
 * 2. 预检（条目存在 / `rev` / `meta_rev` / 范围）→ **冲突就一行都不写**；
 * 3. 通过预检 → 一个 batch：主写入 + 审计行 + 幂等行；
 * 4. 极小竞态（预检通过后被别人抢先）→ 主写入 `changes = 0` → **补一个小 batch：
 *    把刚写的幂等行删掉 + 记一条 `conflict` 审计**，然后返回冲突。
 *
 * 第 2 步为什么连幂等行也不写：否则 agent 重新读取后用**同一个 `operation_id`** 重试，
 * 会永远拿回那次冲突，永远走不下去。
 */
import { newUlid } from "@menote/shared";
import {
  SQL_DELETE_MCP_OPERATION,
  SQL_INSERT_AUDIT_LOG,
  SQL_INSERT_MCP_OPERATION,
  SQL_SELECT_MCP_OPERATION,
} from "../../db/mcp-tables";

/** 审计结果四态（与 `audit_log.result` 的 CHECK 约束一一对应） */
export type McpAuditResult = "ok" | "conflict" | "denied" | "error";

export interface McpAuditInput {
  userId: string;
  tokenId: string;
  tool: string;
  itemId: string | null;
  revBefore: number | null;
  revAfter: number | null;
  result: McpAuditResult;
  operationId: string | null;
  now: number;
}

/** 审计的 INSERT 语句（交给写函数拼进同一次 batch） */
export function auditStatement(db: D1Database, input: McpAuditInput) {
  return db
    .prepare(SQL_INSERT_AUDIT_LOG)
    .bind(
      newUlid(),
      input.userId,
      input.tokenId,
      input.tool,
      input.itemId,
      input.revBefore,
      input.revAfter,
      input.result,
      input.operationId,
      input.now,
    );
}

/** 审计的 INSERT 语句（**不**进 batch，冲突 / 失败这类"主写入没成"的路径用它单独落库） */
export async function writeAudit(db: D1Database, input: McpAuditInput): Promise<void> {
  await auditStatement(db, input).run();
}

// ———————————————————————————————————————— 幂等

export interface IdempotentHit {
  /** 之前跑过 → 重放存下来的结果（`requestHash` 相同才算同一件事） */
  replay: { tool: string; response: string } | null;
  /** 从没跑过这个 `operation_id` */
  fresh: boolean;
  /** 同一个 ID 配了不同参数 → 明确错误，不猜用户想干什么 */
  mismatched: boolean;
  /** 库里存的那份参数摘要（重放 / 比对都要它） */
  requestHash: string | null;
}

export function operationStatement(
  db: D1Database,
  args: { userId: string; operationId: string; tool: string; requestHash: string; response: string; now: number },
) {
  return db
    .prepare(SQL_INSERT_MCP_OPERATION)
    .bind(args.userId, args.operationId, args.tool, args.requestHash, args.response, args.now);
}

export async function readOperation(
  db: D1Database,
  userId: string,
  operationId: string,
): Promise<IdempotentHit> {
  const row = await db
    .prepare(SQL_SELECT_MCP_OPERATION)
    .bind(userId, operationId)
    .first<{ tool: string; request_hash: string; response: string }>();
  if (!row) return { replay: null, fresh: true, mismatched: false, requestHash: null };
  return {
    replay: { tool: row.tool, response: row.response },
    fresh: false,
    // 参数摘要不同 = 同一个 ID 被拿去干另一件事了。这是明确错误，不重放、不覆盖
    mismatched: true,
    requestHash: row.request_hash,
  };
}

/**
 * 判断一次调用是不是"同一件事的重放"。
 *
 * 把三态（没跑过 / 重放 / 撞 ID 配了别的参数）收敛成一个判定，调用方不必自己拼条件。
 */
export function classifyOperation(hit: IdempotentHit, requestHash: string): "fresh" | "replay" | "mismatch" {
  if (hit.fresh) return "fresh";
  return hit.requestHash === requestHash ? "replay" : "mismatch";
}

/** 删掉刚写的幂等行（冲突路径用：让同一个 `operation_id` 之后还能重试） */
export async function forgetOperation(
  db: D1Database,
  userId: string,
  operationId: string,
): Promise<void> {
  await db.prepare(SQL_DELETE_MCP_OPERATION).bind(userId, operationId).run();
}

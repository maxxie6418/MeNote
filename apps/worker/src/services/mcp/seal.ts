/**
 * MCP 写前封存（M6 批 3；设计 §六-5）。
 *
 * 「MCP 修改或替换正文前，服务端先封存当前稿为版本（同一条目 10 分钟内最多一次），
 * 任何 agent 的修改都可以在版本历史中撤回」（设计 §17.4）。
 *
 * ## 为什么单独一份而不放进 `versions.ts`
 *
 * 那份管封存的**语义**（且已顶到行数预算），这一份管**什么时候该触发**——与既有的
 * `version-session.ts`（`session` 封存的自动触发）是同一套路子，保持一致。
 *
 * ## `keep = 1` 是刻意的
 *
 * M17-04 的产品承诺是「用户可在版本历史中看到原因为『AI 修改前』的版本并撤回」。
 * `keep = 0` 的版本会被稀疏化策略删掉（`version-retention.ts`），承诺就不成立。
 * 代价是这些版本不参与稀疏化、长期占着「每篇 50 / 总量 2000」的额度——所以用
 * 10 分钟节流控制增量，批 3 落地后要观察一段时间（设计 §十）。
 *
 * ## 节流怎么判
 *
 * 看两件事：这条**最近一条 `pre_mcp` 版本**的 `created_at` 距今是否已过 10 分钟。
 * 「内容没变就不新增行」的去重交给 `sealVersion` 自己（它按 `content_hash` 比对），
 * 所以这里不必自己维护"刚刚封过没有"的状态。
 */
import { newUlid } from "@menote/shared";
import { sealVersion, type VersionMeta } from "../versions";
import type { StorageEnv } from "../../types";

/** 同一条目两次 `pre_mcp` 封存的最小间隔（设计 §17.4「同一条目 10 分钟内最多一次」） */
export const MCP_SEAL_INTERVAL_MS = 10 * 60 * 1000;

interface McpSealBaseRow {
  rev: number;
  title: string | null;
  content_hash: string;
  size_bytes: number;
  body: string | null;
  last_mcp_seal: number | null;
}

/**
 * 需要时封一条 `pre_mcp` 版本；封了返回它的元数据，不需要封返回 null。
 *
 * **没有正文行就不封**（刚建出来的条目封了也只是一条空版本），与 `version-session.ts` 同一口径。
 */
export async function sealMcpVersionIfNeeded(
  env: StorageEnv,
  userId: string,
  itemId: string,
  now: number,
): Promise<VersionMeta | null> {
  const row = await env.DB.prepare(
    `SELECT i.rev, i.title, i.content_hash, i.size_bytes, b.body,
            (SELECT MAX(v.created_at) FROM item_versions v
              WHERE v.item_id = i.id AND v.user_id = i.user_id AND v.reason = 'pre_mcp') AS last_mcp_seal
     FROM items i LEFT JOIN item_bodies b ON b.item_id = i.id
     WHERE i.id = ? AND i.user_id = ?`,
  )
    .bind(itemId, userId)
    .first<McpSealBaseRow>();
  if (!row || row.body === null) return null;
  if (row.last_mcp_seal !== null && now - row.last_mcp_seal < MCP_SEAL_INTERVAL_MS) return null;

  const result = await sealVersion(
    env,
    userId,
    itemId,
    {
      reason: "pre_mcp",
      keep: true, // 见文件头：这是「可在版本历史撤回」这条产品承诺的前提
      body: row.body,
      contentHash: row.content_hash,
      title: row.title,
      sizeBytes: row.size_bytes,
      rev: row.rev,
    },
    now,
  );
  return result.created ? result.version : null;
}

/**
 * 「冲突副本」的条目 id 与正文（`edit_item` 的 `on_conflict: "copy"` 用）。
 *
 * 冲突副本是**服务端新生成 id 的新条目**，不是把原条目改掉——原条目保持原样，
 * 用户在界面上会看到两份，agent 的修改落在副本上（设计 §17.4「生成冲突副本」）。
 */
export function conflictCopyId(): string {
  return newUlid();
}

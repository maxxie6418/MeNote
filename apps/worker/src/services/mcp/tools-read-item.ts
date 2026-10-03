/**
 * `read_item` 一个工具（M6 批 2；设计 §六-2 第 4 项）。
 *
 * 单独成文件是因为它是 5 个只读工具里最复杂的那个——**四种读取模式**各有各的边界，
 * 挤在 `tools-read.ts` 里会把那个文件顶过 300 行，而它并没有因此变得更清楚。
 *
 * | 模式 | 入参 | 边界 |
 * |---|---|---|
 * | 区间读 | `max_chars` / `cursor` | 用 `substr()` 只取所需区间，**不把整篇取回 Worker** |
 * | 小节读 | `section` | 只对 512 KB 以内的条目开放，超门槛是**拒绝**而不是悄悄给全文 |
 * | 续读 | `cursor` | 字符偏移（不是字节——切坏多字节字符比多读几字节糟糕得多） |
 * | 版本读 | `version_id` | 归属查两件事：属于该用户、属于这一条 |
 *
 * 四条都要先过可见性判定，且「不存在」与「不可见」给**同一句提示**——
 * 区分开就是一份"哪些条目 id 存在但你看不到"的清单。
 */
import { findSectionRange } from "@menote/mdcore";
import {
  MCP_READ_CHARS_DEFAULT,
  MCP_READ_CHARS_MAX,
  MCP_SECTION_MAX_BYTES,
} from "@menote/shared";
import { DomainError } from "../../errors";
import type { StorageEnv } from "../../types";
import { getVersionBody } from "../versions";
import type { McpPrincipal } from "./auth";
import {
  NOT_VISIBLE,
  charLength,
  decodeOffsetCursor,
  encodeOffsetCursor,
  fail,
  pickId,
  sliceChars,
} from "./parts";
import { visibilityClause } from "./scope";

export interface ReadItemArgs {
  id?: unknown;
  section?: unknown;
  cursor?: unknown;
  max_chars?: unknown;
  version_id?: unknown;
}

interface ReadHead {
  id: string;
  type: string;
  title: string | null;
  rev: number;
  updated_at: number;
  size_bytes: number;
}

export type { ReadHead };

/**
 * 先确认条目**可见**，返回它的头部信息。
 *
 * 导出给 `tools-read.ts` 的 `list_versions` 用：它同样需要「先证明这条目可见」，
 * 否则「不可见条目」与「没有版本」会混成同一个空结果，agent 分不出。
 * 抽出来共用一份，两处就不会各写一套查询而漂移。
 */
export async function loadVisibleHead(
  env: StorageEnv,
  principal: McpPrincipal,
  itemId: string,
): Promise<ReadHead> {
  const visibility = visibilityClause(principal);
  const head = await env.DB.prepare(
    `SELECT i.id, i.type, i.title, i.rev, i.updated_at, i.size_bytes
     FROM items i WHERE i.id = ? AND ${visibility.sql}`,
  )
    .bind(itemId, ...visibility.params)
    .first<ReadHead>();
  if (!head) fail(NOT_VISIBLE);
  return head;
}

/** 区间读：SQLite 的 `substr()` 对 TEXT 按**字符**计数，起点从 1 起 */
async function readRange(
  env: StorageEnv,
  principal: McpPrincipal,
  itemId: string,
  offset: number,
  maxChars: number,
): Promise<unknown> {
  const head = await loadVisibleHead(env, principal, itemId);
  const stats = await env.DB.prepare("SELECT length(body) AS chars FROM item_bodies WHERE item_id = ?")
    .bind(itemId)
    .first<{ chars: number }>();
  const totalChars = stats?.chars ?? 0;

  const slice = await env.DB.prepare("SELECT substr(body, ?, ?) AS part FROM item_bodies WHERE item_id = ?")
    .bind(offset + 1, maxChars, itemId)
    .first<{ part: string }>();
  const text = slice?.part ?? "";
  const nextOffset = offset + charLength(text);

  return {
    id: head.id,
    type: head.type,
    title: head.title,
    rev: head.rev,
    updated_at: head.updated_at,
    size_bytes: head.size_bytes,
    total_chars: totalChars,
    offset,
    text,
    next_cursor: nextOffset >= totalChars ? null : encodeOffsetCursor(nextOffset),
  };
}

async function readSectionRange(
  env: StorageEnv,
  principal: McpPrincipal,
  itemId: string,
  section: string,
  maxChars: number,
): Promise<unknown> {
  const head = await loadVisibleHead(env, principal, itemId);
  if (head.size_bytes > MCP_SECTION_MAX_BYTES) {
    fail(`条目超过 ${MCP_SECTION_MAX_BYTES / 1024} KB，无法按小节读取；请改用区间读取或游标续读`);
  }

  const body = await env.DB.prepare("SELECT body FROM item_bodies WHERE item_id = ?")
    .bind(itemId)
    .first<{ body: string }>();
  if (!body) fail(NOT_VISIBLE);

  const range = findSectionRange(body.body, section);
  if (!range) fail(`没有找到标题为「${section}」的小节`);

  const full = body.body.slice(range.start, range.end);
  const part = sliceChars(full, maxChars);
  const truncated = part.length < full.length;

  return {
    id: head.id,
    type: head.type,
    title: head.title,
    rev: head.rev,
    updated_at: head.updated_at,
    section: range.heading,
    // 同名小节不止一个时如实告诉 agent：它可能拿错了那一节
    ambiguous: range.ambiguous,
    total_chars: charLength(full),
    text: part,
    truncated: part.length < full.length,
    next_cursor: truncated ? encodeOffsetCursor(range.start + part.length) : null,
  };
}

/**
 * 版本读。
 *
 * 归属查**两件事**：版本属不属于该用户（`getVersionBody` 内部带 `user_id`），
 * 以及版本属不属于这一条（`VersionMeta` 不带 `item_id`，所以单独查一次）。
 * 少查后一件的话，agent 拿 A 条目的 rev 去读 B 条目的版本，会读到无关内容。
 */
async function readVersion(
  env: StorageEnv,
  principal: McpPrincipal,
  itemId: string,
  versionId: string,
  maxChars: number,
): Promise<unknown> {
  const owner = await env.DB.prepare("SELECT item_id FROM item_versions WHERE id = ? AND user_id = ?")
    .bind(versionId, principal.userId)
    .first<{ item_id: string }>();
  if (!owner) fail(NOT_VISIBLE);
  if (owner.item_id !== itemId) fail("该版本不属于这条目");

  let result: Awaited<ReturnType<typeof getVersionBody>>;
  try {
    result = await getVersionBody(env, principal.userId, versionId);
  } catch (error) {
    // 版本正文在 R2，缺桶时 `getVersionBody` 抛的也是「不存在」——同样回 NOT_VISIBLE
    if (error instanceof DomainError) fail(NOT_VISIBLE);
    throw error;
  }

  const part = sliceChars(result.body, maxChars);
  return {
    id: itemId,
    version_id: result.meta.id,
    rev: result.meta.rev,
    reason: result.meta.reason,
    created_at: result.meta.created_at,
    total_chars: charLength(result.body),
    text: part,
    truncated: part.length < result.body.length,
  };
}

export async function runReadItem(
  env: StorageEnv,
  principal: McpPrincipal,
  args: ReadItemArgs,
): Promise<unknown> {
  const itemId = pickId(args.id);
  const requested = typeof args.max_chars === "number" ? args.max_chars : MCP_READ_CHARS_DEFAULT;
  const maxChars = Math.min(Math.max(1, Math.trunc(requested)), MCP_READ_CHARS_MAX);

  if (typeof args.version_id === "string" && args.version_id !== "") {
    return readVersion(env, principal, itemId, args.version_id, maxChars);
  }
  if (typeof args.section === "string" && args.section.trim() !== "") {
    return readSectionRange(env, principal, itemId, args.section, maxChars);
  }
  return readRange(env, principal, itemId, decodeOffsetCursor(args.cursor), maxChars);
}

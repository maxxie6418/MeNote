/**
 * 版本历史服务端（M4-5；《M4 设计》§4）。
 *
 * 这一份管**封存 / 列表 / 取正文 / 恢复**；**保留与稀疏化**在 `version-retention.ts`
 * （两摊规则的改动理由不同，混在一起两个都说不清）。
 *
 * 三条口径值得单独记住：
 * 1. **去重按 `content_hash`**：与最近一个版本相同就不生成新版本——否则每次自动保存都会刷一条；
 * 2. **服务端封存自己压**：≤256KB 走 gzip，超过 `codec='none'`（Worker CPU 预算，架构 §14.2）；
 *    客户端封存时已经压好了，所以 `codec` 由调用方给；
 * 3. **`keep = 1` 与手动版本不参与稀疏化**：手动「存为版本」落库即 `keep = 1`。
 */
import { VERSION_GZIP_MAX_BYTES, newUlid } from "@menote/shared";
import { putBlob, versionKey } from "../adapters/r2";
import {
  SQL_BUMP_SYNC_SEQ_ON_ITEM_BODY,
  SQL_INSERT_VERSION,
  SQL_SELECT_IDLE_SEAL_CANDIDATES,
  SQL_SELECT_LATEST_VERSION,
  SQL_SELECT_VERSION_BY_ID,
  SQL_SELECT_VERSIONS_PAGE,
  SQL_SET_VERSION_KEEP,
  SQL_UPDATE_ITEM_BODY,
  SQL_UPSERT_ITEM_BODY,
} from "../db/tables";
import { DomainError } from "../errors";
import type { StorageEnv } from "../types";

/** 封存原因（设计 §4.1；界面显示中文的映射在 shared） */
export type VersionReason =
  | "autosave_idle"
  | "session"
  | "manual"
  | "pre_restore"
  | "pre_conflict"
  | "pre_mcp"
  | "pre_convert";

export type VersionCodec = "gzip" | "none";

export interface VersionMeta {
  id: string;
  rev: number;
  reason: VersionReason;
  label: string | null;
  keep: number;
  codec: VersionCodec;
  size_bytes: number;
  content_hash: string;
  title: string | null;
  created_at: number;
}

export interface SealInput {
  reason: VersionReason;
  /** 手动版本可填备注 */
  label?: string | null;
  /** 破坏性操作前的封存要 `keep = 1`（设计 §4.1） */
  keep?: boolean;
  /** 正文（原文）。服务端自己按 256KB 决定压不压 */
  body: string;
  contentHash: string;
  title: string | null;
  sizeBytes: number;
  rev: number;
  /** 客户端已压好的正文（给了就用它；`codec` 也随之确定） */
  compressed?: { codec: VersionCodec; bytes: Uint8Array };
}

interface VersionRow {
  id: string;
  item_id: string;
  user_id: string;
  rev: number;
  reason: string;
  label: string | null;
  keep: number;
  codec: string;
  size_bytes: number;
  content_hash: string;
  title: string | null;
  r2_key: string;
  created_at: number;
}

/** 用 `CompressionStream` 压（workerd 原生支持；不引依赖） */
async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(text)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 解回来；`codec = 'none'` 时原样返回（不解压） */
export async function decodeVersionBody(codec: VersionCodec, bytes: Uint8Array): Promise<string> {
  if (codec === "none") return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function toVersionMeta(row: VersionRow): VersionMeta {
  return {
    id: row.id,
    rev: row.rev,
    reason: row.reason as VersionReason,
    label: row.label,
    keep: row.keep,
    codec: row.codec === "none" ? "none" : "gzip",
    size_bytes: row.size_bytes,
    content_hash: row.content_hash,
    title: row.title,
    created_at: row.created_at,
  };
}

/**
 * 封存一个版本。
 *
 * 去重在**最前面**：与最近一个版本的 `content_hash` 相同就直接返回它，一个字节都不写——
 * 自动保存很频繁，"内容没变"是常态。
 */
export async function sealVersion(
  env: StorageEnv,
  userId: string,
  itemId: string,
  input: SealInput,
  now: number,
): Promise<{ version: VersionMeta; created: boolean }> {
  const latest = await env.DB.prepare(SQL_SELECT_LATEST_VERSION)
    .bind(userId, itemId)
    .first<{ id: string; content_hash: string }>();

  if (latest && latest.content_hash === input.contentHash) {
    const existing = await env.DB.prepare(SQL_SELECT_VERSION_BY_ID)
      .bind(latest.id, userId)
      .first<VersionRow>();
    if (existing) return { version: toVersionMeta(existing), created: false };
  }

  const versionId = newUlid();
  const key = versionKey(userId, itemId, versionId);
  const keep = input.reason === "manual" || input.keep ? 1 : 0;

  // 压缩：客户端给了就用它；否则服务端自己按 256KB 决定（超过就不压——Worker CPU 预算）
  let payload: Uint8Array;
  let codec: VersionCodec;
  if (input.compressed) {
    payload = input.compressed.bytes;
    codec = input.compressed.codec;
  } else if (input.sizeBytes <= VERSION_GZIP_MAX_BYTES) {
    payload = await gzip(input.body);
    codec = "gzip";
  } else {
    payload = new TextEncoder().encode(input.body);
    codec = "none";
  }

  await putBlob(env, key, payload, { httpMetadata: { contentType: "application/octet-stream" } });

  const row: VersionRow = {
    id: versionId,
    item_id: itemId,
    user_id: userId,
    rev: input.rev,
    reason: input.reason,
    label: input.label ?? null,
    keep,
    codec,
    size_bytes: input.sizeBytes,
    content_hash: input.contentHash,
    title: input.title,
    r2_key: key,
    created_at: now,
  };

  await env.DB.prepare(SQL_INSERT_VERSION)
    .bind(
      row.id,
      row.item_id,
      row.user_id,
      row.rev,
      row.reason,
      row.label,
      row.keep,
      row.codec,
      row.size_bytes,
      row.content_hash,
      row.title,
      row.r2_key,
      row.created_at,
    )
    .run();

  return { version: toVersionMeta(row), created: true };
}

export interface VersionPage {
  versions: VersionMeta[];
  /** 下一页游标（本页最后一条的 `created_at`）；没有更多时为 null */
  next_cursor: number | null;
}

/** 版本列表：新的在前，游标是 `created_at`（同毫秒用 id 兜底让排序稳定） */
export async function listVersions(
  db: D1Database,
  userId: string,
  itemId: string,
  options: { limit?: number; cursor?: number | null } = {},
): Promise<VersionPage> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const cursor = options.cursor ?? Number.MAX_SAFE_INTEGER;

  const rows = await db
    .prepare(SQL_SELECT_VERSIONS_PAGE)
    .bind(userId, itemId, cursor, limit + 1)
    .all<VersionRow>();

  const page = rows.results.slice(0, limit);
  const hasMore = rows.results.length > limit;
  return {
    versions: page.map(toVersionMeta),
    next_cursor: hasMore ? (page[page.length - 1]?.created_at ?? null) : null,
  };
}

/** 取某个版本的正文（按 `codec` 解压；**归属校验**：别人的版本取不到） */
export async function getVersionBody(
  env: StorageEnv,
  userId: string,
  versionId: string,
): Promise<{ meta: VersionMeta; body: string }> {
  const row = await env.DB.prepare(SQL_SELECT_VERSION_BY_ID)
    .bind(versionId, userId)
    .first<VersionRow>();
  if (!row) throw new DomainError("not_found", "版本不存在");

  const object = await env.ATTACHMENTS?.get(row.r2_key);
  if (!object) throw new DomainError("not_found", "版本正文不存在");

  const bytes = new Uint8Array(await object.arrayBuffer());
  const codec: VersionCodec = row.codec === "none" ? "none" : "gzip";
  return { meta: toVersionMeta(row), body: await decodeVersionBody(codec, bytes) };
}

/** 切换「保留」标记（`keep = 1` 的版本不参与稀疏化） */
export async function setVersionKeep(
  db: D1Database,
  userId: string,
  versionId: string,
  keep: boolean,
): Promise<void> {
  await db.prepare(SQL_SET_VERSION_KEEP).bind(keep ? 1 : 0, versionId, userId).run();
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * 恢复到某个版本（设计 §4.4 的四步）。
 *
 * 1. **先封存当前稿**（`pre_restore`、`keep = 1`）——所以"恢复"本身可再撤回；
 * 2. 写回正文与派生列，`rev + 1`、`meta_rev + 1`，**一次逻辑写共享一个 `sync_seq`**；
 * 3. **版本表不动**：历史不可变，被恢复的版本继续存在、可反复恢复。
 */
export async function restoreVersion(
  env: StorageEnv,
  userId: string,
  versionId: string,
  now: number,
): Promise<{ restored: VersionMeta; sealed: VersionMeta | null; item: { id: string; rev: number } }> {
  const target = await env.DB.prepare(SQL_SELECT_VERSION_BY_ID)
    .bind(versionId, userId)
    .first<VersionRow>();
  if (!target) throw new DomainError("not_found", "版本不存在");

  const item = await env.DB.prepare(
    "SELECT id, rev, content_hash, title, size_bytes FROM items WHERE id = ? AND user_id = ?",
  )
    .bind(target.item_id, userId)
    .first<{ id: string; rev: number; content_hash: string; title: string | null; size_bytes: number }>();
  if (!item) throw new DomainError("not_found", "条目不存在");

  const bodyRow = await env.DB.prepare("SELECT body FROM item_bodies WHERE item_id = ?")
    .bind(item.id)
    .first<{ body: string }>();

  // ① 先封存当前稿（内容没变时不会新增——去重规则在这里也生效）
  let sealed: VersionMeta | null = null;
  if (bodyRow) {
    const result = await sealVersion(
      env,
      userId,
      item.id,
      {
        reason: "pre_restore",
        keep: true,
        body: bodyRow.body,
        contentHash: item.content_hash,
        title: item.title,
        sizeBytes: item.size_bytes,
        rev: item.rev,
      },
      now,
    );
    sealed = result.created ? result.version : null;
  }

  // ② 取目标版本正文并写回（`rev = rev + 1`；`sync_seq` 在同一条 UPDATE 里推进）
  const { body } = await getVersionBody(env, userId, versionId);
  const bytes = new TextEncoder().encode(body).length;
  const contentHash = await sha256Hex(body);
  const nextRev = item.rev + 1;

  await env.DB.batch([
    env.DB.prepare(SQL_UPDATE_ITEM_BODY)
      .bind(bytes, contentHash, now, now, null, userId, item.id, userId, item.rev),
    env.DB.prepare(SQL_UPSERT_ITEM_BODY).bind(item.id, body, item.id, userId, nextRev, contentHash),
    // 推进用户计数器：与条目写入共享**同一个 sync_seq**（设计 §4.4 第 2 步），
    // 守卫与正文写入一致（rev + content_hash），所以并发的第二次写入不会白推
    env.DB.prepare(SQL_BUMP_SYNC_SEQ_ON_ITEM_BODY).bind(userId, item.id, nextRev, contentHash),
    env.DB.prepare("UPDATE items SET title = ?, meta_rev = meta_rev + 1 WHERE id = ? AND user_id = ?").bind(
      target.title,
      item.id,
      userId,
    ),
  ]);

  return { restored: toVersionMeta(target), sealed, item: { id: item.id, rev: nextRev } };
}

/**
 * idle 兜底封存（Cron 任务④）：客户端"标签页关了就走了"的那一批，由服务端补封。
 *
 * 每轮最多 `limit` 条；只挑**比最后一个版本还新**的（否则会把同一份内容反复封存）。
 */
export async function sealIdleVersions(
  env: StorageEnv,
  now: number,
  idleMinutes: number,
  limit: number,
): Promise<number> {
  const cutoff = now - idleMinutes * 60 * 1000;
  const rows = await env.DB.prepare(SQL_SELECT_IDLE_SEAL_CANDIDATES)
    .bind(cutoff, limit)
    .all<{
      item_id: string;
      user_id: string;
      rev: number;
      title: string | null;
      content_hash: string;
      size_bytes: number;
      body: string;
    }>();

  let sealed = 0;
  for (const row of rows.results) {
    const result = await sealVersion(
      env,
      row.user_id,
      row.item_id,
      {
        reason: "autosave_idle",
        body: row.body,
        contentHash: row.content_hash,
        title: row.title,
        sizeBytes: row.size_bytes,
        rev: row.rev,
      },
      now,
    );
    if (result.created) sealed += 1;
  }
  return sealed;
}

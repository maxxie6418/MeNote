/**
 * 附件桶的最小适配（M4-4；架构 §八、设计 §3.1）。
 *
 * **只做三件事**：拼键、读写删、把"没绑桶"这件事说清楚。业务规则（去重、登记、孤儿、20MB）
 * 都在 `services/attachments.ts` 里——适配层不该知道任何业务，否则换存储还要重读业务代码。
 *
 * 键的三种（设计 §3.1 定稿）：
 * - 原图 / 附件：`a/{user_id}/{sha256}`
 * - 缩略图：`a/{user_id}/{sha256}.t`
 * - 版本快照：`v/{user_id}/{item_id}/{version_id}`（M4-5 用）
 */
import type { StorageEnv } from "../types";

export type AttachmentKind = "original" | "thumb";

/** 附件对象键（原图与缩略图各一把，缩略图只差 `.t` 后缀） */
export function attachmentKey(userId: string, sha256: string, kind: AttachmentKind): string {
  return kind === "thumb" ? `a/${userId}/${sha256}.t` : `a/${userId}/${sha256}`;
}

/** 版本快照对象键（M4-5） */
export function versionKey(userId: string, itemId: string, versionId: string): string {
  return `v/${userId}/${itemId}/${versionId}`;
}

export interface BlobRange {
  offset: number;
  length?: number;
}

export interface BlobObject {
  /** 流式返回给客户端；`Range` 请求时是那一段 */
  body: ReadableStream | null;
  size: number;
  range?: { offset: number; length: number; total: number };
}

/** 桶的可用性：没绑定时**明确报错**，而不是假装写入成功 */
export class BlobStoreUnavailableError extends Error {
  constructor() {
    super("附件存储尚未配置：请先在实例上开通对象存储（R2）");
    this.name = "BlobStoreUnavailableError";
  }
}

/**
 * 取附件桶。**缺绑定就抛**（fail-closed）：调用方把它转成 503 + 明确文案。
 *
 * 为什么不在 `EnvBindings` 里声明成必填：R2 是"要在 Cloudflare 端先开通并写进部署配置"的资源，
 * 新增绑定不会自动供给——声明成必填会让没配好的实例**整个 Worker 起不来**，
 * 而不是只有附件功能不可用。这两者的差别很大。
 */
export function attachmentsBucket(env: StorageEnv): R2Bucket {
  if (!env.ATTACHMENTS) throw new BlobStoreUnavailableError();
  return env.ATTACHMENTS;
}

/** 写对象（流式，Worker 不缓冲请求体） */
export async function putBlob(
  env: StorageEnv,
  key: string,
  // 直接用 R2 自己的入参类型：适配层不该比被适配的 API 更窄（窄了就要在调用处做无意义的转换）
  body: Parameters<R2Bucket["put"]>[1],
  options: { httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> } = {},
): Promise<R2Object> {
  return attachmentsBucket(env).put(key, body, options);
}

/** 读对象；带 `range` 时返回那一段（`Range` 请求用） */
export async function getBlob(
  env: StorageEnv,
  key: string,
  range?: BlobRange,
): Promise<BlobObject | null> {
  const bucket = attachmentsBucket(env);
  const object = range
    ? await bucket.get(key, { range: { offset: range.offset, length: range.length } })
    : await bucket.get(key);
  if (!object) return null;

  const total = object.size;
  const offset = range?.offset ?? 0;
  const length = range ? (range.length ?? Math.max(0, total - offset)) : total;

  return {
    body: object.body,
    size: length,
    range: range ? { offset, length, total } : undefined,
  };
}

/** 元信息（不读正文；`check` 与下载头要用它） */
export async function headBlob(env: StorageEnv, key: string): Promise<R2Object | null> {
  return attachmentsBucket(env).head(key);
}

/** 删对象（GC 用；删不存在的对象不算错，与 R2 的语义一致） */
export async function deleteBlob(env: StorageEnv, key: string): Promise<void> {
  await attachmentsBucket(env).delete(key);
}

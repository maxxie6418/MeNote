/**
 * 附件元数据的本地存取（M4-10；Dexie v7 的 `attachmentsMeta`）。
 *
 * 只放**元数据**：附件正文在 R2，本地不缓存大文件。但"这条笔记引用了哪些附件、
 * 各自多大、传没传完"必须离线可读——否则离线打开笔记会看到一堆破图。
 */
import { isImageMime } from "../../features/attachments/model";
import { db } from "./database";

/** 上传状态：本地先记 `pending`（有 `blob:` 预览），服务端确认后转 `uploaded` */
export type AttachmentStatus = "pending" | "uploaded" | "failed";

export interface LocalAttachment {
  attachment_id: string;
  item_id: string;
  sha256: string;
  filename: string;
  mime: string | null;
  size_bytes: number;
  width: number | null;
  height: number | null;
  /** 是否有缩略图对象（`.t` 那把键）；图片解码失败时为 false */
  has_thumb: boolean;
  status: AttachmentStatus;
  /** 失败原因（`status = failed` 时给用户看） */
  error?: string | null;
  created_at: number;
  updated_at: number;
}

export async function putAttachmentMeta(meta: LocalAttachment): Promise<void> {
  await db.attachmentsMeta.put(meta);
}

/** 上传成功后落定：状态转 `uploaded`（本地预览地址由调用方撤销） */
export async function markAttachmentUploaded(
  attachmentId: string,
  now: number = Date.now(),
): Promise<void> {
  await db.attachmentsMeta.update(attachmentId, { status: "uploaded", error: null, updated_at: now });
}

export async function markAttachmentFailed(
  attachmentId: string,
  error: string,
  now: number = Date.now(),
): Promise<void> {
  await db.attachmentsMeta.update(attachmentId, { status: "failed", error, updated_at: now });
}

export async function listItemAttachments(itemId: string): Promise<LocalAttachment[]> {
  return db.attachmentsMeta.where("item_id").equals(itemId).toArray();
}

/**
 * **所有图片附件**，按条目分组（Memo 瀑布流图册用；2026-09-28 B3 批）。
 *
 * 为什么是"整表读出来再内存过滤"而不是加索引：`attachmentsMeta` 现有索引不含 `mime`，
 * 加索引就要升 Dexie 版本 + 写迁移；附件元数据只有"每条目几行"的量级，一次 `toArray()`
 * 完全够用，**不值得为它动 db 版本**（真要动了再单独一步）。
 *
 * 只收 `status = "uploaded"`：上传中的图还没在 R2 上，放进图册就是一排破图。
 */
export async function listImageAttachments(): Promise<Map<string, LocalAttachment[]>> {
  const rows = await db.attachmentsMeta.toArray();
  const byItem = new Map<string, LocalAttachment[]>();

  for (const row of rows) {
    if (row.status !== "uploaded" || !isImageMime(row.mime, row.filename)) continue;
    const existing = byItem.get(row.item_id);
    if (existing) existing.push(row);
    else byItem.set(row.item_id, [row]);
  }

  // 组内按创建时间升序：图册里同一篇的多张图顺序稳定（不随 IndexedDB 返回顺序抖动）
  for (const list of byItem.values()) list.sort((left, right) => left.created_at - right.created_at);
  return byItem;
}

/** 待上传（含失败）的附件：状态栏的"未完成项"与重试入口都读它 */
export async function listUnfinishedAttachments(): Promise<LocalAttachment[]> {
  const pending = await db.attachmentsMeta.where("status").equals("pending").toArray();
  const failed = await db.attachmentsMeta.where("status").equals("failed").toArray();
  return [...pending, ...failed].sort((left, right) => left.created_at - right.created_at);
}

export async function countUnfinishedAttachments(): Promise<number> {
  return db.attachmentsMeta.where("status").anyOf("pending", "failed").count();
}

/** 找同一个文件（同一条目 + 同一哈希）：重复粘贴时复用那一行，而不是再插一条 */
export async function findAttachment(
  itemId: string,
  sha256: string,
): Promise<LocalAttachment | undefined> {
  return db.attachmentsMeta.where("[item_id+sha256]").equals([itemId, sha256]).first();
}

/** 移除引用后清掉本地那行（**不是删文件**：服务端按孤儿规则在 30 天后自行清理） */
export async function removeAttachmentMeta(attachmentId: string): Promise<void> {
  await db.attachmentsMeta.delete(attachmentId);
}

/** 条目被永久删除时连带清掉它的附件元数据（本地不留孤儿行） */
export async function removeItemAttachments(itemId: string): Promise<number> {
  return db.attachmentsMeta.where("item_id").equals(itemId).delete();
}

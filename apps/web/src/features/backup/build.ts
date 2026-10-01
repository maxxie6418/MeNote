/**
 * 备份包的**纯构建层**：把「本地条目 + 正文 + 附件字节」变成包内的文件与 manifest。
 *
 * 为什么不直接写编排：这个文件不做任何 IO，所以能在 jsdom 里逐条断言
 * （`fake-indexeddb` 与 `fetch` 都不用起）。IO 在 `export.ts` / `import.ts`。
 *
 * 一条关键事实（设计 §2.1）：**`notes/<id>.md` 就是正文原样**。本地存的 body 本身就
 * 带 front matter（`mdcore` 的 `buildDocument` 产出的就是完整文档），所以这里**不需要**
 * 重新拼装 front matter —— 那反而会引入"拼错了就丢字段"的风险，也违背了
 * "front matter 一个字不改"。
 */
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  attachmentPath,
  notePath,
  type BackupItemEntry,
  type BackupManifest,
} from "@menote/shared";
import type { ItemMeta } from "@menote/shared";
import { extractAttachmentRefsWithNames } from "../attachments/model";

/** 一条待备份的条目：本地元数据 + 已取好的正文 */
export interface BackupSourceItem {
  meta: ItemMeta;
  body: string;
}

export interface BuildManifestInput {
  appVersion: string;
  exportedAt: number;
  items: readonly BackupSourceItem[];
  /** 附件：sha256 → 字节。文件名来自正文里的 alt / 链接文字 */
  attachments: ReadonlyMap<string, { bytes: Uint8Array; filename: string }>;
  includeTrashed: boolean;
  includeVersions: boolean;
}

/** 正文里引用到的全部附件（**跨条目去重且保序**，同一个哈希只取第一次出现的文件名） */
export function collectAttachments(
  items: readonly BackupSourceItem[],
): Array<{ sha256: string; filename: string }> {
  const seen: Array<{ sha256: string; filename: string }> = [];
  for (const item of items) {
    for (const ref of extractAttachmentRefsWithNames(item.body)) {
      if (!seen.some((item_) => item_.sha256 === ref.sha256)) seen.push(ref);
    }
  }
  return seen;
}

/**
 * 生成 manifest。
 *
 * 回收站条目是否收进来由 `includeTrashed` 决定（用户 2026-10-01 确认：含），
 * 但**收进来的条目仍然带 `deleted_at`**，这样导入方能把它还原成回收站里的条目，
 * 而不是变成一条"活着的"笔记。
 */
export function buildManifest(input: BuildManifestInput): BackupManifest {
  const itemEntries: BackupItemEntry[] = [];

  for (const { meta, body } of input.items) {
    if (!input.includeTrashed && meta.deleted_at !== null) continue;
    itemEntries.push({
      path: notePath(meta.id),
      id: meta.id,
      type: meta.type,
      folder_id: meta.folder_id,
      title: meta.title,
      tags: [...meta.tags],
      memo_at: meta.memo_at,
      is_task: meta.is_task,
      task_status: meta.task_status,
      task_due: meta.task_due,
      task_priority: meta.task_priority,
      pinned: meta.pinned,
      starred: meta.starred,
      enc_self: meta.enc_self,
      in_enc_space: meta.in_enc_space,
      // 正文变了但元数据里的 content_hash 还没跟上（本地刚敲完还没同步）时，
      // 以**实际导出的那份正文**为准：manifest 里的哈希是校验用的，不是元数据的复读
      content_hash: meta.content_hash,
      size_bytes: byteLength(body),
      rev: meta.rev,
      created_at: meta.created_at,
      updated_at: meta.updated_at,
      deleted_at: meta.deleted_at,
    });
  }

  const attachmentEntries = [...input.attachments.entries()].map(([sha256, value]) => ({
    path: attachmentPath(sha256, value.filename),
    sha256,
    size_bytes: value.bytes.byteLength,
  }));

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app_version: input.appVersion,
    exported_at: new Date(input.exportedAt).toISOString(),
    items: itemEntries,
    attachments: attachmentEntries,
    include_trashed: input.includeTrashed,
    include_versions: input.includeVersions,
  };
}

/**
 * manifest 里 `content_hash` 的正确取法。
 *
 * 本地正文**可能比元数据新**（草稿每 2 秒写一次，`content_hash` 要等上传成功才更新）。
 * 拿旧的 `content_hash` 记进 manifest，导入时会自己和自己对不上。
 */
export async function actualContentHash(body: string): Promise<string> {
  const { sha256Hex } = await import("@menote/shared");
  return sha256Hex(body);
}

/** UTF-8 字节数——与服务端 `size_bytes` 的口径一致（架构 §6.1） */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * 备份导入编排（设计 §四、§五）。
 *
 * **导入不是"把文件塞进数据库"，而是把备份还原成一次正常的创建动作**：
 * `createLocalItem` / `createLocalFolder` 写本地库并入队，然后**照常走 outbox 推流**。
 * 这样做的直接好处是幂等天然有三层（设计 §五）：
 *
 * | 层 | 机制 |
 * |---|---|
 * | IndexedDB | 同一个 `id` 再写一次是覆盖，不是新增 |
 * | outbox | 同一实体已有待推 op 时不再重复入队（`repository.ts` 的 `rows.some(...)`） |
 * | 服务端 | `SQL_INSERT_ITEM` 带 `WHERE NOT EXISTS`，重复 insert 变 no-op |
 *
 * 所以**同一份备份反复导入不会刷出重复条目**，不需要任何额外映射表。
 * 关键前提：id 由客户端生成、服务端接受（`db/tables.ts:89-91`）——已核对。
 */
import {
  completePath,
  foldersPath,
  manifestPath,
  normalizeSnapshotPath,
  sha256Hex,
  verifySnapshot,
  type BackupManifest,
} from "@menote/shared";
import type { ItemType } from "@menote/shared";
import { createLocalFolder } from "../../data/db/repository";
import { restoreLocalItem } from "./restore";
import { browserUploadDeps, uploadAttachment } from "../attachments/upload";
import { attachmentsApi } from "../../data/api/endpoints";

export type ImportPhase = "unzipping" | "verifying" | "folders" | "items" | "attachments" | "done";

export interface ImportProgress {
  phase: ImportPhase;
  done: number;
  total: number;
  /** 有几个没能干净恢复（校验不过 / 上传失败），done 阶段一并回报 */
  skipped?: number;
}

export interface ImportOptions {
  onProgress: (progress: ImportProgress) => void;
  signal?: AbortSignal;
  /** 注入用：单测里替掉上传 */
  restoreAttachment?: (input: { sha256: string; filename: string; bytes: Uint8Array }) => Promise<void>;
}

export interface ImportSummary {
  manifest: BackupManifest;
  foldersRestored: number;
  itemsRestored: number;
  /**
   * 备份里**原本在回收站**的条目数量。
   *
   * 这些条目本地行写成回收站态，且随 outbox 排了「`create` → `trash_item`」两步：
   * 服务端先建成条目、紧跟的 `trash_item` 出队再补一次软删，两端最终都在回收站
   * （设计 §4.2）。推送失败时它们会在服务端暂时以正常条目出现——这个数报出来，
   * 便于对照「上传失败」列表核对，不默默变。
   */
  itemsFromTrash: number;
  attachmentsRestored: number;
  attachmentsFailed: number;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("导入已取消", "AbortError");
}

const decoder = new TextDecoder();

async function unzip(file: File): Promise<Record<string, Uint8Array>> {
  const { unzipSync } = await import("fflate");
  return unzipSync(new Uint8Array(await file.arrayBuffer()));
}

/**
 * 从包里取一个文件的字节。
 *
 * 路径先过 `normalizeSnapshotPath`：包是外部输入，`../` 与绝对路径必须在这里死掉
 * （设计 §2.4）。这个函数**不做静默跳过**——路径不对就抛。
 */
function readPackageFile(files: Record<string, Uint8Array>, rawPath: string): Uint8Array {
  const path = normalizeSnapshotPath(rawPath);
  const bytes = files[path];
  if (!bytes) {
    throw new Error(`备份包里缺文件：${path}`);
  }
  return bytes;
}

async function defaultRestoreAttachment(input: {
  sha256: string;
  filename: string;
  bytes: Uint8Array;
}): Promise<void> {
  const file = new File([input.bytes as BlobPart], input.filename);
  const result = await uploadAttachment({ file, itemId: null }, browserUploadDeps(attachmentsApi));
  /*
    只有 `uploaded` 算恢复成功（含命中去重的 `reused`）。
    `queued` 是离线入队——那意味着附件此刻**并不在 R2 上**，恢复没完成；
    `rejected` / `failed` 同理。三者都抛出去，由调用方计入失败数并报给用户，
    不能当成"恢复了"。
  */
  if (result.status !== "uploaded") {
    throw new Error(`附件恢复未完成（${result.status}）：${result.reason}`);
  }
}

/**
 * 导入一份备份。
 *
 * **全程认 `AbortSignal`**：恢复是危险动作（会往库里写），用户中途反悔要能立刻停。
 */
export async function importBackup(
  file: File,
  options: ImportOptions,
): Promise<ImportSummary> {
  const { onProgress, signal, restoreAttachment = defaultRestoreAttachment } = options;
  const summary: ImportSummary = {
    manifest: null as unknown as BackupManifest,
    foldersRestored: 0,
    itemsRestored: 0,
    itemsFromTrash: 0,
    attachmentsRestored: 0,
    attachmentsFailed: 0,
  };

  // —— 1. 解包 ——
  onProgress({ phase: "unzipping", done: 0, total: 1 });
  const files = await unzip(file);
  throwIfAborted(signal);

  // —— 2. 校验（失败一律抛，绝不读一半）——
  onProgress({ phase: "verifying", done: 0, total: 1 });
  const completeText = decoder.decode(readPackageFile(files, completePath()));
  const manifestText = decoder.decode(readPackageFile(files, manifestPath()));
  const manifest = await verifySnapshot({ completeText, manifestText });
  summary.manifest = manifest;
  throwIfAborted(signal);

  // —— 3. 文件夹（先建：条目的 folder_id 指向它们）——
  const foldersRaw = files[foldersPath()];
  const folders = foldersRaw
    ? (JSON.parse(decoder.decode(foldersRaw)) as Array<{
        id: string;
        parent_id: string | null;
        name: string;
        depth: number;
        in_enc_space: number;
        is_enc_space: number;
      }>)
    : [];
  // 父在前：depth 小的先建，子才找得到 parent
  const orderedFolders = [...folders].sort((a, b) => a.depth - b.depth);
  for (let index = 0; index < orderedFolders.length; index += 1) {
    throwIfAborted(signal);
    const folder = orderedFolders[index];
    if (!folder) continue;
    if (!folder.is_enc_space) {
      // 加密空间根行由服务端补建（`ensureEncSpace`），客户端建了会多出一条
      await createLocalFolder(
        folder.id,
        folder.name,
        folder.parent_id,
        folder.depth,
        Date.now(),
        { inEncSpace: folder.in_enc_space === 1 },
      );
      summary.foldersRestored += 1;
    }
    onProgress({ phase: "folders", done: index + 1, total: orderedFolders.length });
  }

  // —— 4. 条目 ——
  for (let index = 0; index < manifest.items.length; index += 1) {
    throwIfAborted(signal);
    const entry = manifest.items[index];
    if (!entry) continue;
    const bytes = readPackageFile(files, entry.path);
    const body = decoder.decode(bytes);
    await restoreLocalItem(
      {
        id: entry.id,
        type: entry.type as ItemType,
        title: entry.title,
        folder_id: entry.folder_id,
        tags: entry.tags,
        memo_at: entry.memo_at,
        body,
        inEncSpace: entry.in_enc_space === 1,
        encSelf: entry.enc_self === 1,
        pinned: entry.pinned === 1,
        starred: entry.starred === 1,
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
        deletedAt: entry.deleted_at,
        task: {
          isTask: entry.is_task === 1,
          status: entry.task_status,
          due: entry.task_due,
          priority: entry.task_priority,
        },
      },
      Date.now(),
    );
    summary.itemsRestored += 1;
    // 回收站条目：本地已写成回收站态，服务端软删由紧跟 create 的 trash_item 出队补做（§4.2）
    if (entry.deleted_at !== null) summary.itemsFromTrash += 1;
    onProgress({ phase: "items", done: index + 1, total: manifest.items.length });
  }

  // —— 5. 附件 ——
  for (let index = 0; index < manifest.attachments.length; index += 1) {
    throwIfAborted(signal);
    const entry = manifest.attachments[index];
    if (!entry) continue;
    const bytes = readPackageFile(files, entry.path);
    /*
      逐个重算哈希：附件是**内容寻址**的，哈希对不上就说明这个字节不是它声称的那个文件。
      宁可报失败，也不能把错的字节写进 R2——那会污染以后所有引用它的笔记。
    */
    const actual = await sha256Hex(bytes);
    if (actual !== entry.sha256) {
      summary.attachmentsFailed += 1;
      onProgress({
        phase: "attachments",
        done: index + 1,
        total: manifest.attachments.length,
        skipped: summary.attachmentsFailed,
      });
      continue;
    }
    const filename = entry.path.split("--").pop() ?? "attachment";
    try {
      await restoreAttachment({ sha256: entry.sha256, filename, bytes });
      summary.attachmentsRestored += 1;
    } catch {
      // 单个附件失败不中断整次导入：其余条目与附件照常恢复，失败数最后一起报
      summary.attachmentsFailed += 1;
    }
    onProgress({
      phase: "attachments",
      done: index + 1,
      total: manifest.attachments.length,
      skipped: summary.attachmentsFailed,
    });
  }

  onProgress({
    phase: "done",
    done: 1,
    total: 1,
    skipped: summary.attachmentsFailed,
  });
  return summary;
}

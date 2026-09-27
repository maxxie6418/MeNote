/**
 * 附件上传在界面层的接线（M4-10；《M4 界面稿》§7.1 / §7.2）。
 *
 * 四件事：
 * 1. **粘贴/拖入/选择文件 → 立即在正文插入占位**（"粘贴没反应"是最糟的体验），再开始上传；
 * 2. 未传完时占位里的地址是**本地 `blob:` 预览**（界面稿 §7.1），传完才换成服务端地址；
 * 3. 上传结束用编辑器句柄把占位**替换**成最终的图片/链接片段（失败就撤掉并给可见理由）；
 * 4. 进度与失败交给**既有状态栏**（不新增第二条状态栏），并给「重试」出口。
 *
 * 状态按 `itemId` 过滤：切到别的笔记时，上一篇的未完成项不该出现在这一篇的状态栏里。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { newUlid } from "@menote/shared";
import type { EditorHandle } from "../../app/editor/Editor";
import { attachmentsApi } from "../../data/api/endpoints";
import { findAttachment, markAttachmentUploaded, putAttachmentMeta } from "../../data/db";
import { createPreviewStore, isImageMime, uploadStatusLabel, type UploadProgress } from "./model";
import { createAttachmentQueue, pendingPlaceholder, progressOf, type AttachmentQueue, type QueueTask } from "./queue";
import { browserUploadDeps } from "./upload";

export interface UseAttachmentsOptions {
  itemId: string | null;
  /** 编辑器句柄（挂载后才有）：插入占位与替换成品都靠它 */
  handle: EditorHandle | null;
  /** 上传成功/失败的提示（轻提示；秒传文案不同） */
  notify?: (message: string, tone: "success" | "warn" | "error") => void;
}

export interface UseAttachmentsResult {
  /** 状态栏文案（空串表示这篇没在传） */
  statusLabel: string;
  statusTone: "busy" | "warn" | null;
  failedCount: number;
  add(files: readonly File[]): Promise<void>;
  retry(): Promise<void>;
}

/** 图片的本地预览地址形如 `![上传中：名](blob:...)`；非图片只给文件名（界面稿 §7.1） */
function placeholderFor(task: QueueTask, previewUrl: string | undefined): string {
  const base = pendingPlaceholder(task);
  return previewUrl ? base.replace("#pending", previewUrl) : base;
}

export function useAttachments(options: UseAttachmentsOptions): UseAttachmentsResult {
  const { itemId } = options;
  const [tasks, setTasks] = useState<readonly QueueTask[]>([]);
  const optionsRef = useRef(options);
  const previews = useMemo(() => createPreviewStore(), []);
  const queueRef = useRef<AttachmentQueue | null>(null);

  // 回调与当前条目放进 ref：队列只建一次，读最新值靠这里（**不在渲染期写 ref**）
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  /**
   * 队列在**副作用里**建（不在渲染期）：它持有任务与原始文件，重建会把未完成的上传丢掉。
   * 放 `useEffect` 而不是 `useMemo` 还有一个实际原因：渲染期写/读 ref 是 React 编译器明确禁止的
   * （`react-hooks/refs`），而这个队列的所有回调都要读 ref 里的最新条目与句柄。
   */
  useEffect(() => {
    queueRef.current = createAttachmentQueue(browserUploadDeps(attachmentsApi), {
      onChange: (next) => setTasks(next),
      onTaskCreated: (task, file) => {
        // 未传完一律用本地预览（图片显示本地图；`blob:` 只在本机内存，离开即撤销）
        const url = isImageMime(file.type, file.name) ? previews.create(task.marker, file) : undefined;
        optionsRef.current.handle?.insert(`${placeholderFor(task, url)}\n`);
      },
      replaceSnippet: (marker, text) => {
        previews.revoke(marker);
        optionsRef.current.handle?.replace(marker, text);
      },
      onUploaded: (task, outcome, file) => {
        const target = task.itemId;
        optionsRef.current.notify?.(
          outcome.reused ? "已复用同一文件" : "附件已上传",
          outcome.reused ? "warn" : "success",
        );
        if (!target) return;
        // 本地元数据：先落 pending 再转 uploaded（两次写是刻意的——中途失败不会留下"已传完"的假象）
        void (async () => {
          const existing = await findAttachment(target, outcome.sha256);
          const attachmentId = existing?.attachment_id ?? newUlid();
          await putAttachmentMeta({
            attachment_id: attachmentId,
            item_id: target,
            sha256: outcome.sha256,
            filename: task.filename,
            mime: file.type || null,
            size_bytes: file.size,
            width: null,
            height: null,
            has_thumb: outcome.hasThumb,
            status: "pending",
            error: null,
            created_at: Date.now(),
            updated_at: Date.now(),
          });
          await markAttachmentUploaded(attachmentId);
        })();
      },
      onFailed: (task) => {
        previews.revoke(task.marker);
        if (!task.reason) return;
        // 超 20MB：就地可见提示，**不进入上传**（界面稿 §7.1）；其余是"上传失败 + 可重试"
        optionsRef.current.notify?.(
          task.status === "rejected" ? task.reason : `附件上传失败：${task.reason}`,
          task.status === "rejected" ? "error" : "warn",
        );
      },
    });

    return () => {
      queueRef.current = null;
    };
  }, [previews]);

  const add = useCallback(async (files: readonly File[]) => {
    if (files.length === 0) return;
    // 占位由队列的 `onTaskCreated` 插入（标记必须与队列用的是同一个）
    await queueRef.current?.add(files, optionsRef.current.itemId);
  }, []);

  const retry = useCallback(async () => {
    await queueRef.current?.retryAll(optionsRef.current.itemId);
  }, []);

  // 卸载时撤销所有本地预览地址（锁定或离开即撤销；这里只撤销地址，不碰 React 状态）
  useEffect(() => () => previews.revokeAll(), [previews]);

  const mine = tasks.filter((task) => task.itemId === itemId);
  const progress: UploadProgress[] = progressOf(mine);
  const failedCount = mine.filter(
    (task) => task.status === "failed" || task.status === "rejected",
  ).length;
  const statusLabel = uploadStatusLabel(progress);

  return {
    statusLabel,
    statusTone: failedCount > 0 ? "warn" : statusLabel === "" ? null : "busy",
    failedCount,
    add,
    retry,
  };
}

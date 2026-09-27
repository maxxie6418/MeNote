/**
 * 附件的上传队列（M4-10；《M4 界面稿》§7.1 / §7.2）。
 *
 * **不用 React**：队列本身就是个状态机（排队 → 上传 → 成功/失败 → 重试），
 * 与它渲染在哪无关。这样"失败进清单再重试""同一文件重复粘贴只传一次"这些行为
 * 可以不挂渲染就测掉；`useAttachments` 只是把它包成一个 hook。
 *
 * 与正文的约定：每条上传任务带一个**标记**（`marker`）。调用方插入占位时把标记写进去，
 * 上传结束后用它把占位**替换**成最终片段（图片）或失败提示（非图片）。
 * 标记用 `#pending-<n>` 形式，落在 Markdown 的链接地址里，人眼可读也不破坏语法。
 */
import {
  fileSnippet,
  imageSnippet,
  isImageMime,
  pendingSnippet,
  type UploadProgress,
} from "./model";
import { uploadAttachment, type UploadDeps, type UploadOutcome } from "./upload";

export interface QueueTask {
  /** 正文里待替换的标记（`#pending-1`） */
  marker: string;
  /** 属于哪条条目：状态栏与重试都只看当前这一篇的任务 */
  itemId: string | null;
  filename: string;
  status: "queued" | "uploading" | "done" | "failed" | "rejected";
  /** 失败/拒绝的原因（可见提示要用） */
  reason: string | null;
  sha256: string | null;
  reused: boolean;
}

export interface QueueCallbacks {
  /** 状态变了就通知（渲染层据此更新状态栏与清单） */
  onChange(tasks: readonly QueueTask[]): void;
  /**
   * 新任务建立（**上传开始之前**）：调用方在这里把占位插进正文。
   *
   * 标记由队列生成、经这里交出去——如果让调用方自己造标记，两边一旦对不上，
   * 占位就永远替换不掉（这个坑第一版就踩了：占位留在正文里，上传却成功了）。
   * 文件也一并给出：本地 `blob:` 预览要用它，而队列之外拿不到"哪个任务配哪个文件"。
   */
  onTaskCreated?(task: QueueTask, file: File): void;
  /** 该把正文里的 `marker` 换成 `text` 了 */
  replaceSnippet(marker: string, text: string): void;
  /** 上传成功（可用于落本地元数据、算引用等） */
  onUploaded?(
    task: QueueTask,
    outcome: Extract<UploadOutcome, { status: "uploaded" }>,
    file: File,
  ): void;
  /** 失败或拒绝（可用于落失败状态、撤销本地预览） */
  onFailed?(task: QueueTask, file: File): void;
}

export interface AttachmentQueue {
  add(files: readonly File[], itemId: string | null): Promise<void>;
  /** 重试所有失败/拒绝的任务（拒绝的会重新走大小检查，仍然超限就再次拒绝） */
  retryAll(itemId: string | null): Promise<void>;
  tasks(): readonly QueueTask[];
  activeCount(): number;
}

let markerSeq = 0;

export function createAttachmentQueue(deps: UploadDeps, callbacks: QueueCallbacks): AttachmentQueue {
  const tasks: QueueTask[] = [];
  /** 任务 → 原始文件（重试要用；只在内存里，刷新即丢——这是设计 §3.2-6 的口径） */
  const files = new Map<string, File>();

  const notify = (): void => callbacks.onChange([...tasks]);

  const makeTask = (file: File, itemId: string | null): QueueTask => {
    markerSeq += 1;
    return {
      marker: `#pending-${markerSeq}`,
      itemId,
      filename: file.name,
      status: "queued",
      reason: null,
      sha256: null,
      reused: false,
    };
  };

  const run = async (task: QueueTask, file: File, itemId: string | null): Promise<void> => {
    task.status = "uploading";
    task.reason = null;
    notify();

    /*
      `uploadAttachment` 的契约是**不抛错**（一律用返回值表达结果），但**依赖项**（哈希、网络、
      元数据落库）都可能抛，而调用方是 `void attachments.add(files)`——
      真抛出来就会被丢掉：任务**永远停在"正在上传"**（状态栏一直显示 N / M）、
      正文里的占位符也**永久留着**。这里兜住，把它降级成一次普通的"失败"（可重试）。
    */
    let outcome: Awaited<ReturnType<typeof uploadAttachment>>;
    try {
      outcome = await uploadAttachment({ file, itemId }, deps);
    } catch (error) {
      task.status = "failed";
      task.reason = error instanceof Error ? error.message : "上传失败";
      // 占位**保留**：文件还在队列里，重试就能接着传（与"超限被拒"要撤占位不同）
      callbacks.onFailed?.(task, file);
      notify();
      return;
    }

    if (outcome.status === "uploaded") {
      task.status = "done";
      task.sha256 = outcome.sha256;
      task.reused = outcome.reused;
      // 图片用图片语法，非图片用链接语法（界面稿 §7.4：非图片是**可下载的文件链接**）
      callbacks.replaceSnippet(
        task.marker,
        isImageMime(file.type, file.name)
          ? imageSnippet(file.name, outcome.sha256)
          : fileSnippet(file.name, outcome.sha256),
      );
      callbacks.onUploaded?.(task, outcome, file);
    } else if (outcome.status === "rejected") {
      task.status = "rejected";
      task.reason = outcome.reason;
      // 拒绝的（超 20MB）**不留在正文里**：占位撤掉，理由由可见提示说
      callbacks.replaceSnippet(task.marker, "");
      callbacks.onFailed?.(task, file);
    } else if (outcome.status === "queued") {
      task.status = "queued";
      task.reason = outcome.reason;
      task.sha256 = outcome.sha256;
      callbacks.onFailed?.(task, file);
    } else {
      task.status = "failed";
      task.reason = outcome.reason;
      task.sha256 = outcome.sha256;
      callbacks.onFailed?.(task, file);
    }
    notify();
  };

  return {
    async add(incoming, itemId) {
      const created = incoming.map((file) => {
        const task = makeTask(file, itemId);
        files.set(task.marker, file);
        tasks.push(task);
        return task;
      });
      // 先让调用方把**全部占位**插好，再开始上传：这样用户一次拖 5 个文件时，
      // 5 个占位是同时出现的，而不是随着上传一个个蹦出来
      for (const task of created) {
        const file = files.get(task.marker);
        if (file) callbacks.onTaskCreated?.(task, file);
      }
      notify();

      // 串行上传：并发上传在弱网下只会互相抢带宽，而且状态栏的"N / M"读起来要稳
      for (const task of created) {
        const file = files.get(task.marker);
        if (file) await run(task, file, itemId);
      }
    },

    async retryAll(itemId) {
      const retriable = tasks.filter(
        (task) =>
          task.itemId === itemId &&
          (task.status === "failed" || task.status === "rejected" || task.status === "queued"),
      );
      for (const task of retriable) {
        const file = files.get(task.marker);
        if (!file) continue;
        // 拒绝过的（比如超 20MB）占位已被撤掉，重试前要把占位补回正文
        if (task.status === "rejected") callbacks.replaceSnippet(task.marker, "");
        await run(task, file, itemId);
      }
    },

    tasks: () => [...tasks],
    activeCount: () =>
      tasks.filter((task) => task.status === "queued" || task.status === "uploading").length,
  };
}

/** 把队列任务映射成状态栏要的进度形状 */
export function progressOf(tasks: readonly QueueTask[]): UploadProgress[] {
  return tasks
    .filter((task) => task.status !== "done")
    .map((task) => ({
      phase:
        task.status === "uploading"
          ? ("uploading" as const)
          : task.status === "queued"
            ? ("queued" as const)
            : ("failed" as const),
      ratio: null,
    }));
}

/** 占位文本（调用方插进正文；标记在链接地址里，人眼可读） */
export function pendingPlaceholder(task: QueueTask): string {
  return pendingSnippet(task.filename).replace("#pending", task.marker);
}

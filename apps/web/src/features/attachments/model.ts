/**
 * 附件的模型（M4-10；《M4 设计》§3、《M4 界面稿》§7）。
 *
 * 纯函数都在这：下载地址、正文里的引用写法与解析、大小文案、状态文案、
 * 本地 `blob:` 预览的生命周期。上传流程本体在 `upload.ts`，缩略图在 `thumbnail.ts`。
 *
 * **正文里的引用写法**（本文件定稿，设计 §3.2-4 只说"引用由客户端上报"）：
 * 图片写 `![文件名](/api/attachments/h/<sha256>)`，非图片写 `[文件名](/api/attachments/h/<sha256>)`。
 * 理由：①Markdown 预览**不用任何自定义语法**就能显示；②服务端不解析正文，客户端靠同一条正则
 * 就能把它们全抓出来上报；③缩略图只是渲染时加 `?thumb=1`，正文本身保持稳定。
 */
import { MAX_ATTACHMENT_BYTES } from "@menote/shared";

/** 附件下载地址（`thumb` 取缩略图对象） */
export function attachmentUrl(sha256: string, options: { thumb?: boolean } = {}): string {
  const base = `/api/attachments/h/${sha256}`;
  return options.thumb ? `${base}?thumb=1` : base;
}

/** 正文里的附件引用（图片或链接） */
const ATTACHMENT_REF_PATTERN = /\/api\/attachments\/h\/([0-9a-f]{64})/gi;

/**
 * 带文件名的完整引用：`![照片.png](/api/attachments/h/<sha>)` → `{ sha256, filename }`。
 *
 * 与 {@link extractAttachmentRefs} 同一条正则、同一种去重保序语义，**只是多带一个文件名**——
 * 因为备份要在包里把附件存成 `attachments/<sha>--<文件名>`（设计 §2.3），
 * 而 URL 里只有哈希，文件名只存在于正文的 alt / 链接文字里。
 *
 * 文件名缺失时退回 `attachment`（不编造，也不让整次导出失败）。
 */
const ATTACHMENT_REF_WITH_NAME_PATTERN =
  /!\[([^\]]*)\]\(\/api\/attachments\/h\/([0-9a-f]{64})\)|\[([^\]]*)\]\(\/api\/attachments\/h\/([0-9a-f]{64})\)/gi;

/** 从正文里抽出所有引用的哈希（**去重且保序**：上报给服务端的 `attachment_refs` 要用它） */
export function extractAttachmentRefs(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(ATTACHMENT_REF_PATTERN)) {
    const sha = (match[1] ?? "").toLowerCase();
    if (sha && !found.includes(sha)) found.push(sha);
  }
  return found;
}

/**
 * 同 {@link extractAttachmentRefs}，但连文件名一起给（备份用）。
 *
 * 同一个 sha 在正文里出现多次时**取第一次出现的文件名**——与去重语义一致。
 * 两条分支（`![alt](…)` 与 `[文字](…)`）分别取各自的捕获组。
 */
export function extractAttachmentRefsWithNames(
  body: string,
): Array<{ sha256: string; filename: string }> {
  const found: Array<{ sha256: string; filename: string }> = [];
  for (const match of body.matchAll(ATTACHMENT_REF_WITH_NAME_PATTERN)) {
    const sha = (match[2] ?? match[4] ?? "").toLowerCase();
    if (!sha) continue;
    if (found.some((item) => item.sha256 === sha)) continue;
    found.push({ sha256: sha, filename: (match[1] ?? match[3] ?? "").trim() || "attachment" });
  }
  return found;
}

/** 正文里插入图片的 Markdown（文件名里的 `]` `(` 会破坏语法，替换成安全字符） */
export function imageSnippet(filename: string, sha256: string): string {
  return `![${safeName(filename)}](${attachmentUrl(sha256)})`;
}

/** 非图片附件：**可下载的文件链接**（界面稿 §7.4：链接样式，不是按钮、不用正文色） */
export function fileSnippet(filename: string, sha256: string): string {
  return `[${safeName(filename)}](${attachmentUrl(sha256)})`;
}

/** 上传中的占位（拿到哈希前就要插入，否则用户会觉得"粘贴没反应"） */
export function pendingSnippet(filename: string): string {
  return `![上传中：${safeName(filename)}](#pending)`;
}

export function safeName(filename: string): string {
  return filename.replace(/[[\]()]/g, "_");
}

const IMAGE_MIME_PATTERN = /^image\//i;

export function isImageMime(mime: string | null | undefined, filename = ""): boolean {
  if (mime && IMAGE_MIME_PATTERN.test(mime)) return true;
  // 有些系统给不出 mime（粘贴的剪贴板项、拖入的文件夹条目），退一步看扩展名
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(filename);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** 超过 20MB：**就地可见提示、不进入上传**（界面稿 §7.1） */
export const TOO_LARGE_NOTICE = `文件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB，请压缩或拆分后上传`;

export function isTooLarge(bytes: number): boolean {
  return bytes > MAX_ATTACHMENT_BYTES;
}

/** 附件不可用（引用在、对象不在）：灰提示，点了不下载也不弹原生框（界面稿 §7.4） */
export const UNAVAILABLE_NOTICE = "附件不可用";
/** 缩略图不可用但原图在（界面稿 §7.3） */
export const THUMB_UNAVAILABLE_TITLE = "缩略图不可用，点击查看原图";

// ——————————————————————————— 上传状态与文案 ———————————————————————————

export type UploadPhase = "hashing" | "thumbnail" | "uploading" | "finalizing" | "done" | "failed" | "queued";

export interface UploadProgress {
  phase: UploadPhase;
  /** 0–1；未知时为 null（宁可不说数字，也不要说假的） */
  ratio: number | null;
}

/** 状态栏文案（界面稿 §7.2：实时计数必须可见，落在**既有**状态栏位置） */
export function uploadStatusLabel(items: ReadonlyArray<UploadProgress>): string {
  if (items.length === 0) return "";
  const failed = items.filter((item) => item.phase === "failed").length;
  if (failed > 0) return `${failed} 个附件上传失败`;
  const queued = items.filter((item) => item.phase === "queued").length;
  if (queued === items.length) return "离线，联网后自动上传";
  const done = items.filter((item) => item.phase === "done").length;
  return `上传中 ${done} / ${items.length}`;
}

/** 进度百分比文案；算不出百分比时给阶段名（不编数字） */
export function uploadPercentLabel(progress: UploadProgress): string {
  if (progress.ratio === null) {
    switch (progress.phase) {
      case "hashing":
        return "正在计算文件指纹";
      case "thumbnail":
        return "正在生成缩略图";
      case "queued":
        return "等待联网";
      default:
        return "上传中";
    }
  }
  return `${Math.round(progress.ratio * 100)}%`;
}

/** 秒传（同一用户里已经有同一个文件）：不发第二次请求，轻提示说清"复用了同一份" */
export const REUSED_NOTICE = "已复用同一文件";

/**
 * **上次离开时没传完**的状态栏文案（界面稿 §7.2）。
 *
 * 文案要如实说清"为什么不能自动续传"：上传队列与文件对象只在本机内存里（设计 §3.2-6），
 * 刷新后文件已经不在手上——续传靠重新选一次文件，而**已经传上去的会秒传**。
 */
export function leftoverLabel(count: number): string {
  if (count <= 0) return "";
  return count === 1 ? "有 1 个附件没传完" : `有 ${count} 个附件没传完`;
}

/** 未完成项的悬停说明（把"怎么办"讲清楚，不放在主文案里挤占状态栏） */
export const LEFTOVER_HINT = "上次离开时没传完：重新选择一次同一个文件即可续传（已传上去的会秒传）";

// ——————————————————————————— 本地预览的生命周期 ———————————————————————————

/**
 * 本地预览地址的管理器（界面稿 §7.1：未上传完成一律用 `blob:` 预览）。
 *
 * **退出/锁定即撤销**：`blob:` 地址不撤销会一直占着内存（大图尤其明显），
 * 而且明文图片的地址被留在 DOM 里也不是我们想要的。所以创建与撤销成对出现。
 */
export function createPreviewStore() {
  const urls = new Map<string, string>();

  return {
    /** 为一个文件建预览地址（同一个 key 重复建时先撤销旧的） */
    create(key: string, file: Blob): string {
      this.revoke(key);
      const url = URL.createObjectURL(file);
      urls.set(key, url);
      return url;
    },
    get(key: string): string | undefined {
      return urls.get(key);
    },
    revoke(key: string): void {
      const url = urls.get(key);
      if (url) {
        URL.revokeObjectURL(url);
        urls.delete(key);
      }
    },
    /** 锁定条目 / 离开编辑器时整批撤销 */
    revokeAll(): void {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
    size(): number {
      return urls.size;
    },
  };
}

export type PreviewStore = ReturnType<typeof createPreviewStore>;

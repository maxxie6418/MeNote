/**
 * 附件上传流程（M4-10；《M4 设计》§3.2）。
 *
 * 六步，顺序是刻意的：
 * 1. **大小检查**：超 20MB 就地拒绝，**不进上传**（界面稿 §7.1）；
 * 2. **算 SHA-256**（浏览器算，服务端自己不算）；
 * 3. **`check`**：命中去重 → 秒传，**不发第二次请求**；
 * 4. **生成缩略图**（图片；失败就 `null`，**不阻塞原图上传**）；
 * 5. **`PUT blob`**：原图与缩略图**各一次请求**，请求体直传（Worker 不缓冲）；
 * 6. **`finalize`**：元数据与引用在服务端落定。
 *
 * 依赖全部由参数注入：这样"秒传""缩略图失败照样传原图""离线进队列"这些分支都能在单测里跑，
 * 而不用去 mock 全局 `fetch` 与 Canvas。
 */
import { isTooLarge, TOO_LARGE_NOTICE } from "./model";
import { makeThumbnail, type ThumbnailDeps } from "./thumbnail";

export interface UploadDeps {
  /** 浏览器算出的十六进制 SHA-256 */
  hash(file: Blob): Promise<string>;
  /** 服务端的三段接口（与 `attachmentsApi` 同形，单测传替身） */
  api: {
    check(input: { sha256: string; size: number }): Promise<{ exists: boolean; pending: boolean }>;
    putBlob(sha256: string, kind: "original" | "thumb", body: Blob, contentType: string): Promise<void>;
    finalize(input: {
      sha256: string;
      size: number;
      mime: string | null;
      width: number | null;
      height: number | null;
      filename: string | null;
      thumb: { size: number; mime: string | null; width: number | null; height: number | null } | null;
      itemId: string | null;
    }): Promise<{ attachmentId: string; thumbId: string | null }>;
  };
  thumbnail?: ThumbnailDeps;
  /** 离线判定：离线时不发请求，直接进 outbox */
  isOffline?(): boolean;
  /** 读图片尺寸（原图元数据要用；拿不到就 null） */
  measure?(file: Blob): Promise<{ width: number; height: number } | null>;
}

export interface UploadInput {
  file: File;
  /** 挂到哪条条目上（引用由客户端上报） */
  itemId: string | null;
}

export type UploadOutcome =
  | {
      status: "uploaded";
      sha256: string;
      attachmentId: string;
      /** 命中去重、没有真的上传 */
      reused: boolean;
      hasThumb: boolean;
    }
  | { status: "queued"; sha256: string; reason: string }
  | { status: "rejected"; sha256: null; reason: string }
  | { status: "failed"; sha256: string; reason: string };

/** SHA-256（十六进制小写）；浏览器原生 `crypto.subtle` */
export async function hashFile(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 默认依赖（浏览器）：三段接口走 `fetch`，缩略图走 Canvas */
export function browserUploadDeps(api: UploadDeps["api"]): UploadDeps {
  return {
    hash: hashFile,
    api,
    isOffline: () => typeof navigator !== "undefined" && navigator.onLine === false,
    async measure(file) {
      try {
        const bitmap = await createImageBitmap(file);
        return { width: bitmap.width, height: bitmap.height };
      } catch {
        return null;
      }
    },
  };
}

/**
 * 跑完一次上传。
 *
 * **不抛错**：一律用返回值表达结果（`rejected` / `queued` / `failed` / `uploaded`）——
 * 上传是"后台发生的事"，抛异常只会让调用点到处 try/catch，还会漏掉某些分支的提示。
 */
export async function uploadAttachment(
  input: UploadInput,
  deps: UploadDeps,
): Promise<UploadOutcome> {
  const { file, itemId } = input;

  // ① 大小：超限就地拒绝，一个字节都不读
  if (isTooLarge(file.size)) {
    return { status: "rejected", sha256: null, reason: TOO_LARGE_NOTICE };
  }

  // ② 算哈希（这一步之前不占用任何服务端资源）
  const sha256 = await deps.hash(file);

  // ③ 离线：进 outbox，不在这里重试（重试由 outbox 的既有节奏负责）
  if (deps.isOffline?.()) {
    return { status: "queued", sha256, reason: "离线，联网后自动上传" };
  }

  try {
    const existing = await deps.api.check({ sha256, size: file.size });
    if (existing.exists && itemId) {
      // 秒传：服务端已经有这个文件了，只需要把引用挂上去
      const finalized = await deps.api.finalize({
        sha256,
        size: file.size,
        mime: file.type || null,
        width: null,
        height: null,
        filename: file.name,
        thumb: null,
        itemId,
      });
      return {
        status: "uploaded",
        sha256,
        attachmentId: finalized.attachmentId,
        reused: true,
        hasThumb: false,
      };
    }

    // ④ 缩略图：失败就 null（**原图照常上传**，界面稿 §7.3）
    const isImage = file.type.startsWith("image/") && deps.thumbnail !== undefined;
    const thumb = isImage ? await makeThumbnail(file, deps.thumbnail!) : null;
    const size = deps.measure ? await deps.measure(file) : null;

    // ⑤ 原图与缩略图各一次请求，请求体直传
    await deps.api.putBlob(sha256, "original", file, file.type || "application/octet-stream");
    if (thumb) {
      await deps.api.putBlob(sha256, "thumb", thumb.blob, "image/webp");
    }

    // ⑥ 落元数据 + 引用
    const finalized = await deps.api.finalize({
      sha256,
      size: file.size,
      mime: file.type || null,
      width: size?.width ?? null,
      height: size?.height ?? null,
      filename: file.name,
      thumb: thumb
        ? { size: thumb.blob.size, mime: "image/webp", width: thumb.width, height: thumb.height }
        : null,
      itemId,
    });

    return {
      status: "uploaded",
      sha256,
      attachmentId: finalized.attachmentId,
      reused: false,
      hasThumb: thumb !== null,
    };
  } catch (error) {
    return {
      status: "failed",
      sha256,
      reason: error instanceof Error ? error.message : "上传失败",
    };
  }
}

/**
 * 缩略图生成（M4-10；《M4 设计》§3.3、【本文决定】浏览器端）。
 *
 * 三件事：**最长边缩到 400px**、**WebP**、**目标 ≤40KB（超了逐档降质量）**；
 * 任何一步失败（HEIC 解不出来、Canvas 不可用、`toBlob` 返回 null）都**不抛错**——
 * 返回 `null` 让调用方回退成文件图标，**原图照常上传**（界面稿 §7.3）。
 *
 * 为什么把 canvas 工厂做成参数：jsdom 里没有真正的 Canvas 实现，注入一个假实现就能
 * 把"降质量循环""失败回退"这些**决策逻辑**测掉；真编码结果是浏览器里的事（M4-13 线上看）。
 */
import { THUMBNAIL_MAX_EDGE, THUMBNAIL_TARGET_BYTES } from "@menote/shared";

/** 质量档：从高到低逐档试，直到压进目标大小（40KB） */
export const QUALITY_LADDER: ReadonlyArray<number> = [0.82, 0.7, 0.6, 0.5, 0.4, 0.3];

export interface ThumbnailResult {
  blob: Blob;
  width: number;
  height: number;
  quality: number;
}

/** 最长边缩到 `maxEdge`，另一边按比例（不放大：小图保持原尺寸） */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** 画布最小能力（`OffscreenCanvas` 与 `<canvas>` 都满足） */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: "2d"): {
    drawImage(source: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  } | null;
  convertToBlob?(options: { type: string; quality: number }): Promise<Blob>;
  toBlob?(callback: (blob: Blob | null) => void, type: string, quality: number): void;
}

export interface ThumbnailDeps {
  /** 解码图片（浏览器里是 `createImageBitmap`；失败即"解码不了"） */
  decode(file: Blob): Promise<{ width: number; height: number; source: CanvasImageSource }>;
  createCanvas(width: number, height: number): CanvasLike;
}

/** 把画布导出成 Blob（两种画布 API 都要兼容：`OffscreenCanvas` 用 `convertToBlob`） */
async function canvasToBlob(
  canvas: CanvasLike,
  type: string,
  quality: number,
): Promise<Blob | null> {
  if (canvas.convertToBlob) {
    return canvas.convertToBlob({ type, quality });
  }
  const toBlob = canvas.toBlob;
  if (toBlob) {
    return new Promise((resolve) => {
      toBlob.call(canvas, (blob) => resolve(blob), type, quality);
    });
  }
  return null;
}

/**
 * 生成缩略图。**永不抛错**：任何一步失败都返回 `null`（调用方回退文件图标）。
 *
 * 尺寸先缩到 400px 再编码，所以"降质量"只在**画质**上让步——不会为了压体积把图缩得更小。
 */
export async function makeThumbnail(
  file: Blob,
  deps: ThumbnailDeps,
  targetBytes: number = THUMBNAIL_TARGET_BYTES,
): Promise<ThumbnailResult | null> {
  let decoded: Awaited<ReturnType<ThumbnailDeps["decode"]>>;
  try {
    decoded = await deps.decode(file);
  } catch {
    // 解码失败（HEIC 等）：回退文件图标，但**不阻塞上传**
    return null;
  }

  const size = fitWithin(decoded.width, decoded.height);
  if (size.width < 1 || size.height < 1) return null;

  try {
    const canvas = deps.createCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(decoded.source, 0, 0, size.width, size.height);

    for (const quality of QUALITY_LADDER) {
      const blob = await canvasToBlob(canvas, "image/webp", quality);
      if (!blob) return null;
      if (blob.size <= targetBytes) {
        return { blob, width: size.width, height: size.height, quality };
      }
      // 最后一档仍超标：**接受它**（缩略图不该因为差几 KB 就整个消失）
      if (quality === QUALITY_LADDER[QUALITY_LADDER.length - 1]) {
        return { blob, width: size.width, height: size.height, quality };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** 浏览器里的默认依赖（`createImageBitmap` + `OffscreenCanvas`，缺失时退 `<canvas>`） */
export function browserThumbnailDeps(): ThumbnailDeps {
  return {
    decode: async (blob) => {
      const bitmap = await createImageBitmap(blob);
      return { width: bitmap.width, height: bitmap.height, source: bitmap };
    },
    createCanvas: (width, height) => {
      if (typeof OffscreenCanvas !== "undefined") {
        return new OffscreenCanvas(width, height) as unknown as CanvasLike;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas as unknown as CanvasLike;
    },
  };
}

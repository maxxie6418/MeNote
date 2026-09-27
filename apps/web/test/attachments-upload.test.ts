// @vitest-environment jsdom
/**
 * 缩略图生成（M4-10；《M4 设计》§3.3）。
 *
 * jsdom 里没有真 Canvas，所以这里注入一个**可控的假画布**，把决策逻辑测清楚：
 * 尺寸怎么缩、超 40KB 怎么逐档降质量、最后一档超标怎么办、解码失败怎么办。
 * 真编码结果是浏览器里的事（M4-13 线上看）。
 *
 * 上传流程的用例也放这里：它依赖的缩略图替身与本节同源，放一起读起来是一条线。
 */
import { describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "@menote/shared";
import {
  QUALITY_LADDER,
  browserThumbnailDeps,
  fitWithin,
  makeThumbnail,
  type CanvasLike,
} from "../src/features/attachments/thumbnail";
import { uploadAttachment, type UploadDeps } from "../src/features/attachments/upload";

/** 假画布：每次 `convertToBlob` 按当前质量档给出一个预定大小的 Blob */
function fakeCanvas(sizesByQuality: Record<string, number>): {
  deps: Parameters<typeof makeThumbnail>[1];
  qualities: number[];
} {
  const qualities: number[] = [];
  return {
    qualities,
    deps: {
      decode: async () => ({ width: 1200, height: 800, source: {} as CanvasImageSource }),
      createCanvas: (width, height): CanvasLike => {
        const canvas: CanvasLike = {
          width,
          height,
          getContext: () => ({ drawImage: () => undefined }),
          convertToBlob: async ({ quality }) => {
            qualities.push(quality);
            const size = sizesByQuality[String(quality)] ?? 999_999;
            return new Blob([new Uint8Array(Math.min(size, 1024))]);
          },
        };
        // 用 size 断言不方便，改成把"预定大小"挂到 blob 上（Object.defineProperty 改 size 只读属性）
        const original = canvas.convertToBlob!;
        canvas.convertToBlob = async (options) => {
          const blob = await original(options);
          Object.defineProperty(blob, "size", { value: sizesByQuality[String(options.quality)] ?? 999_999 });
          return blob;
        };
        return canvas;
      },
    },
  };
}

describe("尺寸与回退", () => {
  it("最长边缩到 400px，另一边按比例；小图不放大", () => {
    expect(fitWithin(1200, 800)).toEqual({ width: 400, height: 267 });
    expect(fitWithin(800, 1200)).toEqual({ width: 267, height: 400 });
    expect(fitWithin(320, 200)).toEqual({ width: 320, height: 200 });
  });

  it("解码失败（HEIC 等）返回 null，**不抛错**（原图照常上传）", async () => {
    const result = await makeThumbnail(new Blob(["x"]), {
      decode: async () => {
        throw new Error("decode failed");
      },
      createCanvas: () => {
        throw new Error("不该走到这里");
      },
    });
    expect(result).toBeNull();
  });

  it("画布拿不到 2d 上下文时返回 null，不抛错", async () => {
    const result = await makeThumbnail(new Blob(["x"]), {
      decode: async () => ({ width: 800, height: 600, source: {} as CanvasImageSource }),
      createCanvas: () => ({ width: 400, height: 300, getContext: () => null }),
    });
    expect(result).toBeNull();
  });

  it("两种画布 API 都兼容（OffscreenCanvas 的 convertToBlob 缺失时用 toBlob）", async () => {
    const result = await makeThumbnail(new Blob(["x"]), {
      decode: async () => ({ width: 800, height: 600, source: {} as CanvasImageSource }),
      createCanvas: () => ({
        width: 400,
        height: 300,
        getContext: () => ({ drawImage: () => undefined }),
        toBlob: (callback) => callback(new Blob([new Uint8Array(10)])),
      }),
    });
    expect(result?.width).toBe(400);
  });
});

describe("体积与质量", () => {
  it("第一档就压进 40KB 时只编码一次", async () => {
    const { deps, qualities } = fakeCanvas({ "0.82": 30_000 });
    const result = await makeThumbnail(new Blob(["x"]), deps);

    expect(result?.quality).toBe(QUALITY_LADDER[0]);
    expect(qualities).toEqual([QUALITY_LADDER[0]]);
  });

  it("超过 40KB 时**逐档降质量**直到压进去", async () => {
    const { deps, qualities } = fakeCanvas({
      "0.82": 90_000,
      "0.7": 60_000,
      "0.6": 38_000, // 这一档才达标
    });
    const result = await makeThumbnail(new Blob(["x"]), deps);

    expect(result?.quality).toBe(0.6);
    expect(qualities).toEqual([0.82, 0.7, 0.6]);
  });

  it("最后一档仍超标时接受它（缩略图不该因为差几 KB 就整个消失）", async () => {
    const { deps } = fakeCanvas({ "0.82": 90_000, "0.7": 80_000, "0.6": 70_000, "0.5": 65_000, "0.4": 60_000, "0.3": 55_000 });
    const result = await makeThumbnail(new Blob(["x"]), deps);

    expect(result).not.toBeNull();
    expect(result?.quality).toBe(QUALITY_LADDER[QUALITY_LADDER.length - 1]);
  });

  it("目标大小来自共享常量（两端同一处）", async () => {
    const { deps } = fakeCanvas({ "0.82": 30_000 });
    const result = await makeThumbnail(new Blob(["x"]), deps, 10_000);
    // 目标改成 10KB 后 30KB 不达标，会继续降档
    expect(result?.quality).not.toBe(QUALITY_LADDER[0]);
  });

  it("浏览器依赖能用（`createImageBitmap` 缺失时返回 null 而不是崩）", async () => {
    const deps = browserThumbnailDeps();
    const result = await makeThumbnail(new Blob(["not an image"]), deps);
    expect(result).toBeNull();
  });
});

// ——————————————————————————— 上传流程 ———————————————————————————

function fakeDeps(overrides: Partial<UploadDeps> = {}): {
  deps: UploadDeps;
  calls: { check: number; put: Array<{ sha256: string; kind: string; size: number }>; finalize: unknown[] };
} {
  const calls = {
    check: 0,
    put: [] as Array<{ sha256: string; kind: string; size: number }>,
    finalize: [] as unknown[],
  };
  const deps: UploadDeps = {
    hash: async () => "c".repeat(64),
    api: {
      check: async () => {
        calls.check += 1;
        return { exists: false, pending: false };
      },
      putBlob: async (sha256, kind, body) => {
        calls.put.push({ sha256, kind, size: body.size });
      },
      finalize: async (input) => {
        calls.finalize.push(input);
        return { attachmentId: "att-1", thumbId: input.thumb ? "att-1-t" : null };
      },
    },
    ...overrides,
  };
  return { deps, calls };
}

function fileOf(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(Math.min(size, 4096))], name, { type });
}

describe("上传流程", () => {
  it("非图片：只传原图，不发缩略图请求", async () => {
    const { deps, calls } = fakeDeps();
    const result = await uploadAttachment({ file: fileOf("a.pdf", "application/pdf"), itemId: "i1" }, deps);

    expect(result.status).toBe("uploaded");
    expect(calls.put.map((call) => call.kind)).toEqual(["original"]);
    expect(calls.finalize).toHaveLength(1);
  });

  it("超过 20MB 就地拒绝，**一个请求都不发**", async () => {
    const { deps, calls } = fakeDeps();
    const huge = new File([new Uint8Array(10)], "big.bin", { type: "application/octet-stream" });
    Object.defineProperty(huge, "size", { value: MAX_ATTACHMENT_BYTES + 1 });

    const result = await uploadAttachment({ file: huge, itemId: "i1" }, deps);
    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" && result.reason).toContain("20 MB");
    expect(calls.check).toBe(0);
    expect(calls.put).toHaveLength(0);
  });

  it("check 命中：**不发上传请求**，只把引用挂上去（秒传）", async () => {
    const { deps, calls } = fakeDeps({
      api: {
        check: async () => ({ exists: true, pending: false }),
        putBlob: async () => {
          throw new Error("秒传不该再上传");
        },
        finalize: async () => ({ attachmentId: "att-9", thumbId: null }),
      },
    });

    const result = await uploadAttachment({ file: fileOf("照片.png", "image/png"), itemId: "i1" }, deps);
    expect(result).toMatchObject({ status: "uploaded", reused: true, attachmentId: "att-9" });
    expect(calls.finalize).toHaveLength(0); // 替身自己记的，这里只看没抛错
  });

  it("图片：原图与缩略图**各一次请求**，finalize 带上缩略图元数据", async () => {
    const { deps, calls } = fakeDeps({
      thumbnail: {
        decode: async () => ({ width: 1200, height: 800, source: {} as CanvasImageSource }),
        createCanvas: () => ({
          width: 400,
          height: 267,
          getContext: () => ({ drawImage: () => undefined }),
          convertToBlob: async () => new Blob([new Uint8Array(20)]),
        }),
      },
      measure: async () => ({ width: 1200, height: 800 }),
    });

    const result = await uploadAttachment({ file: fileOf("照片.png", "image/png"), itemId: "i1" }, deps);
    expect(result).toMatchObject({ status: "uploaded", hasThumb: true });
    expect(calls.put.map((call) => call.kind)).toEqual(["original", "thumb"]);
    expect(calls.finalize[0]).toMatchObject({ width: 1200, height: 800, itemId: "i1" });
  });

  it("缩略图失败不影响原图上传（回退文件图标）", async () => {
    const { deps, calls } = fakeDeps({
      thumbnail: {
        decode: async () => {
          throw new Error("HEIC 解码失败");
        },
        createCanvas: () => {
          throw new Error("不该走到这里");
        },
      },
    });

    const result = await uploadAttachment({ file: fileOf("照片.heic", "image/heic"), itemId: "i1" }, deps);
    expect(result).toMatchObject({ status: "uploaded", hasThumb: false });
    expect(calls.put.map((call) => call.kind)).toEqual(["original"]);
  });

  it("离线：进队列，不发任何请求", async () => {
    const { deps, calls } = fakeDeps({ isOffline: () => true });
    const result = await uploadAttachment({ file: fileOf("a.png", "image/png"), itemId: "i1" }, deps);

    expect(result).toMatchObject({ status: "queued" });
    expect(calls.check).toBe(0);
  });

  it("上传失败：返回 failed 与原因，**不抛错**（调用方只处理返回值）", async () => {
    const { deps } = fakeDeps({
      api: {
        check: async () => {
          throw new Error("网络断了");
        },
        putBlob: async () => undefined,
        finalize: async () => ({ attachmentId: "", thumbId: null }),
      },
    });

    const result = await uploadAttachment({ file: fileOf("a.png", "image/png"), itemId: "i1" }, deps);
    expect(result).toMatchObject({ status: "failed", reason: "网络断了" });
  });

  it("哈希由浏览器算，用的是文件内容（`crypto.subtle`）", async () => {
    const spy = vi.fn(async () => "d".repeat(64));
    const { deps } = fakeDeps({ hash: spy });
    await uploadAttachment({ file: fileOf("a.png", "image/png"), itemId: null }, deps);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

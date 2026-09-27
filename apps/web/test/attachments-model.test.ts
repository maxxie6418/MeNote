// @vitest-environment jsdom
/**
 * 附件模型（M4-10；《M4 设计》§3、《M4 界面稿》§7）。
 *
 * 对着验收条目写：正文引用的写法与解析、下载地址、大小与状态文案、
 * 本地 `blob:` 预览的生命周期（**锁定/离开即撤销**）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "@menote/shared";
import {
  REUSED_NOTICE,
  TOO_LARGE_NOTICE,
  UNAVAILABLE_NOTICE,
  attachmentUrl,
  createPreviewStore,
  extractAttachmentRefs,
  fileSnippet,
  formatBytes,
  imageSnippet,
  isImageMime,
  isTooLarge,
  pendingSnippet,
  safeName,
  uploadPercentLabel,
  uploadStatusLabel,
} from "../src/features/attachments/model";

const SHA = "a".repeat(64);
const OTHER = "b".repeat(64);

describe("下载地址与正文引用", () => {
  it("地址按哈希拼；缩略图加 `?thumb=1`", () => {
    expect(attachmentUrl(SHA)).toBe(`/api/attachments/h/${SHA}`);
    expect(attachmentUrl(SHA, { thumb: true })).toBe(`/api/attachments/h/${SHA}?thumb=1`);
  });

  it("图片与非图片的 Markdown 写法（预览不用自定义语法就能显示）", () => {
    expect(imageSnippet("照片.png", SHA)).toBe(`![照片.png](/api/attachments/h/${SHA})`);
    expect(fileSnippet("报告.pdf", SHA)).toBe(`[报告.pdf](/api/attachments/h/${SHA})`);
    // 文件名里的方括号/圆括号会破坏语法 → 替换成安全字符
    expect(safeName("a[b](c).png")).toBe("a_b__c_.png");
  });

  it("上传中的占位（粘贴后立刻要有反馈）", () => {
    expect(pendingSnippet("照片.png")).toContain("上传中");
    expect(pendingSnippet("照片.png")).toContain("#pending");
  });

  it("从正文抽出引用：去重、保序、大小写不敏感", () => {
    const body = [
      `![图](/api/attachments/h/${SHA})`,
      `[文件](/api/attachments/h/${OTHER})`,
      `![再来一次](/api/attachments/h/${SHA.toUpperCase()})`,
      "普通链接 [官网](https://example.com)",
    ].join("\n");

    expect(extractAttachmentRefs(body)).toEqual([SHA, OTHER]);
  });

  it("正文没引用时返回空数组（上报空引用是合法状态）", () => {
    expect(extractAttachmentRefs("只有文字")).toEqual([]);
  });
});

describe("文件类型与大小", () => {
  it("图片判定：先看 mime，mime 缺失时看扩展名", () => {
    expect(isImageMime("image/png", "x.bin")).toBe(true);
    expect(isImageMime("", "截图.PNG")).toBe(true);
    expect(isImageMime(null, "照片.heic")).toBe(false);
    expect(isImageMime("application/pdf", "a.pdf")).toBe(false);
  });

  it("20MB 是硬线（超了就地拒绝，不进上传）", () => {
    expect(isTooLarge(MAX_ATTACHMENT_BYTES)).toBe(false);
    expect(isTooLarge(MAX_ATTACHMENT_BYTES + 1)).toBe(true);
    expect(TOO_LARGE_NOTICE).toContain("20 MB");
    expect(UNAVAILABLE_NOTICE).toBe("附件不可用");
  });

  it("大小文案三档", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(3 * 1_048_576)).toBe("3.0 MB");
  });
});

describe("上传状态文案", () => {
  it("上传中显示进度计数（落在既有状态栏位置）", () => {
    expect(
      uploadStatusLabel([
        { phase: "done", ratio: 1 },
        { phase: "uploading", ratio: 0.4 },
        { phase: "hashing", ratio: null },
      ]),
    ).toBe("上传中 1 / 3");
  });

  it("有失败时先说失败数量（警告语义优先于进度）", () => {
    expect(
      uploadStatusLabel([
        { phase: "failed", ratio: null },
        { phase: "uploading", ratio: 0.2 },
      ]),
    ).toBe("1 个附件上传失败");
  });

  it("全部离线排队时说清「联网后自动上传」", () => {
    expect(uploadStatusLabel([{ phase: "queued", ratio: null }])).toBe("离线，联网后自动上传");
  });

  it("没有进行中的项时不显示状态文案", () => {
    expect(uploadStatusLabel([])).toBe("");
  });

  it("百分比：算得出就给数字，算不出就给阶段名（不编数字）", () => {
    expect(uploadPercentLabel({ phase: "uploading", ratio: 0.37 })).toBe("37%");
    expect(uploadPercentLabel({ phase: "hashing", ratio: null })).toBe("正在计算文件指纹");
    expect(uploadPercentLabel({ phase: "thumbnail", ratio: null })).toBe("正在生成缩略图");
    expect(uploadPercentLabel({ phase: "queued", ratio: null })).toBe("等待联网");
  });

  it("秒传的提示说清是「复用了同一份」", () => {
    expect(REUSED_NOTICE).toBe("已复用同一文件");
  });
});

describe("本地预览的生命周期", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("创建返回 blob: 地址；同一个 key 重复创建会先撤销旧的", () => {
    let counter = 0;
    const created: string[] = [];
    const revoked: string[] = [];
    vi.stubGlobal("URL", {
      createObjectURL: () => {
        counter += 1;
        const url = `blob:fake-${counter}`;
        created.push(url);
        return url;
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    });

    const store = createPreviewStore();
    const first = store.create("k1", new Blob(["a"]));
    expect(first).toBe("blob:fake-1");
    expect(store.get("k1")).toBe(first);

    const second = store.create("k1", new Blob(["b"]));
    expect(second).toBe("blob:fake-2");
    // 旧的被撤销（大图不撤销会一直占内存）
    expect(revoked).toContain("blob:fake-1");
    expect(store.size()).toBe(1);
  });

  it("revokeAll 把这些地址全撤掉（锁定或离开编辑器时）", () => {
    const revoked: string[] = [];
    let counter = 0;
    vi.stubGlobal("URL", {
      createObjectURL: () => {
        counter += 1;
        return `blob:fake-${counter}`;
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    });

    const store = createPreviewStore();
    store.create("k1", new Blob(["a"]));
    store.create("k2", new Blob(["b"]));
    store.revokeAll();

    expect(revoked).toEqual(["blob:fake-1", "blob:fake-2"]);
    expect(store.size()).toBe(0);
    expect(store.get("k1")).toBeUndefined();
  });
});

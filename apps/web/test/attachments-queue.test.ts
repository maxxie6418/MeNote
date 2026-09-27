// @vitest-environment jsdom
/**
 * 附件上传队列（M4-10；《M4 界面稿》§7.1 / §7.2）。
 *
 * 队列是纯状态机（不挂渲染），所以这些行为都能直接测：
 * 占位先插好再传、秒传不重传、超过 20MB 撤占位并给理由、失败留清单可重试、
 * 状态栏文案、以及"切到别的笔记时看不到上一篇的未完成项"。
 */
import { describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "@menote/shared";
import {
  createAttachmentQueue,
  pendingPlaceholder,
  progressOf,
  type QueueTask,
} from "../src/features/attachments/queue";
import { uploadStatusLabel } from "../src/features/attachments/model";
import type { UploadDeps } from "../src/features/attachments/upload";

function deps(overrides: Partial<UploadDeps> = {}): UploadDeps {
  return {
    hash: async () => "a".repeat(64),
    api: {
      check: async () => ({ exists: false, pending: false }),
      putBlob: async () => ({ key: "k", size: 1 }),
      finalize: async () => ({ attachmentId: "att-1", thumbId: null }),
    },
    ...overrides,
  };
}

/** 收集队列回调的替身 */
function harness(uploadDeps: UploadDeps = deps()) {
  const created: Array<{ task: QueueTask; file: File }> = [];
  const replaced: Array<{ marker: string; text: string }> = [];
  const uploaded: string[] = [];
  const failed: string[] = [];
  const queue = createAttachmentQueue(uploadDeps, {
    onChange: () => undefined,
    onTaskCreated: (task, file) => created.push({ task, file }),
    replaceSnippet: (marker, text) => replaced.push({ marker, text }),
    onUploaded: (task) => uploaded.push(task.filename),
    onFailed: (task) => failed.push(task.filename),
  });
  return { queue, created, replaced, uploaded, failed };
}

function fileOf(name: string, type = "image/png", size = 1024): File {
  const file = new File([new Uint8Array(8)], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("占位与替换", () => {
  it("**先插全部占位再加以上传**（一次拖多个时占位同时出现）", async () => {
    const order: string[] = [];
    const uploadDeps = deps({
      api: {
        check: async () => {
          order.push("check");
          return { exists: false, pending: false };
        },
        putBlob: async () => ({ key: "k", size: 1 }),
        finalize: async () => ({ attachmentId: "att-1", thumbId: null }),
      },
    });

    const created: string[] = [];
    const queue = createAttachmentQueue(uploadDeps, {
      onChange: () => undefined,
      onTaskCreated: (task) => {
        created.push(task.marker);
        order.push(`placeholder:${task.marker}`);
      },
      replaceSnippet: () => undefined,
    });

    await queue.add([fileOf("a.png"), fileOf("b.png")], "i1");
    // 两个占位都在第一次 check 之前出现
    expect(order.slice(0, 3)).toEqual(["placeholder:#pending-1", "placeholder:#pending-2", "check"]);
    expect(created).toHaveLength(2);
  });

  it("上传成功后把占位换成 Markdown 片段（图片用图片语法）", async () => {
    const { queue, replaced, created } = harness();
    await queue.add([fileOf("照片.png")], "i1");

    expect(replaced).toHaveLength(1);
    const marker = created[0]?.task.marker ?? "";
    expect(replaced[0]?.marker).toBe(marker);
    expect(replaced[0]?.text).toBe(`![照片.png](/api/attachments/h/${"a".repeat(64)})`);
    // 占位文本里带标记（可被精准替换）
    expect(pendingPlaceholder(created[0]!.task)).toContain(marker);
  });

  it("非图片附件用链接语法（界面稿 §7.4：可下载的文件链接）", async () => {
    const { queue, replaced } = harness();
    await queue.add([fileOf("报告.pdf", "application/pdf")], "i1");
    expect(replaced[0]?.text).toBe(`[报告.pdf](/api/attachments/h/${"a".repeat(64)})`);
  });

  it("超过 20MB：**撤掉占位**、不进上传、给可见理由", async () => {
    const putBlob = vi.fn(async () => ({ key: "k", size: 1 }));
    const { queue, replaced, failed } = harness(
      deps({ api: { check: async () => ({ exists: false, pending: false }), putBlob, finalize: async () => ({ attachmentId: "x", thumbId: null }) } }),
    );

    await queue.add([fileOf("big.png", "image/png", MAX_ATTACHMENT_BYTES + 1)], "i1");

    expect(putBlob).not.toHaveBeenCalled();
    expect(replaced[0]?.text).toBe(""); // 占位撤掉，理由由状态栏/提示说
    expect(failed).toEqual(["big.png"]);
    expect(queue.tasks()[0]?.status).toBe("rejected");
    expect(queue.tasks()[0]?.reason).toContain("20 MB");
  });
});

describe("秒传与失败", () => {
  it("check 命中：只挂引用，不发上传请求，并标记 reused", async () => {
    const putBlob = vi.fn(async () => ({ key: "k", size: 1 }));
    const { queue, uploaded } = harness(
      deps({
        api: {
          check: async () => ({ exists: true, pending: false }),
          putBlob,
          finalize: async () => ({ attachmentId: "att-existing", thumbId: null }),
        },
      }),
    );

    await queue.add([fileOf("照片.png")], "i1");
    expect(putBlob).not.toHaveBeenCalled();
    expect(uploaded).toEqual(["照片.png"]);
    expect(queue.tasks()[0]).toMatchObject({ status: "done", reused: true, sha256: "a".repeat(64) });
  });

  it("上传失败：状态 failed、原因可见、留在清单里等重试", async () => {
    const { queue, failed } = harness(
      deps({
        api: {
          check: async () => {
            throw new Error("网络断了");
          },
          putBlob: async () => ({ key: "k", size: 1 }),
          finalize: async () => ({ attachmentId: "x", thumbId: null }),
        },
      }),
    );

    await queue.add([fileOf("a.png")], "i1");
    expect(failed).toEqual(["a.png"]);
    expect(queue.tasks()[0]).toMatchObject({ status: "failed", reason: "网络断了" });
    expect(queue.activeCount()).toBe(0);
  });

  it("离线：进队列（queued），联网后 retryAll 会真的上传", async () => {
    let offline = true;
    const putBlob = vi.fn(async () => ({ key: "k", size: 1 }));
    const { queue } = harness(
      deps({
        isOffline: () => offline,
        api: {
          check: async () => ({ exists: false, pending: false }),
          putBlob,
          finalize: async () => ({ attachmentId: "att-1", thumbId: null }),
        },
      }),
    );

    await queue.add([fileOf("a.png")], "i1");
    expect(putBlob).not.toHaveBeenCalled();
    expect(queue.tasks()[0]?.status).toBe("queued");

    offline = false;
    await queue.retryAll("i1");
    expect(putBlob).toHaveBeenCalledTimes(1);
    expect(queue.tasks()[0]?.status).toBe("done");
  });

  it("重试只作用于当前条目（别的笔记的未完成项不跟着重传）", async () => {
    const putBlob = vi.fn(async () => {
      throw new Error("还是不通");
    });
    const { queue } = harness(
      deps({
        api: {
          check: async () => ({ exists: false, pending: false }),
          putBlob,
          finalize: async () => ({ attachmentId: "x", thumbId: null }),
        },
      }),
    );

    await queue.add([fileOf("a.png")], "i1");
    const before = putBlob.mock.calls.length;
    await queue.retryAll("i2");
    expect(putBlob.mock.calls.length).toBe(before);
  });

  it("**依赖项抛错**：不留在「正在上传」，降级成 failed 并可重试（占位保留）", async () => {
    let broken = true;
    const putBlob = vi.fn(async () => {
      if (broken) throw new Error("网关卡住了");
      return { key: "k", size: 1 };
    });
    const { queue, replaced, failed } = harness(
      deps({
        api: {
          check: async () => ({ exists: false, pending: false }),
          putBlob,
          finalize: async () => ({ attachmentId: "att-1", thumbId: null }),
        },
      }),
    );

    await queue.add([fileOf("a.png")], "i1");

    // 关键：不是停在 uploading（那会让状态栏永远显示 N / M），而是 failed 且原因可见
    const [task] = queue.tasks();
    expect(task?.status).toBe("failed");
    expect(task?.reason).toBe("网关卡住了");
    expect(failed).toEqual(["a.png"]);
    // 占位**保留**（文件还在队列里，重试能接着传；与"超限被拒"要撤占位不同）
    expect(replaced.filter((entry) => entry.text === "")).toEqual([]);

    // 修好后重试：真的传上去
    broken = false;
    await queue.retryAll("i1");
    expect(queue.tasks()[0]?.status).toBe("done");
  });
});

describe("状态栏文案", () => {
  it("进度映射：done 的项不算进进度，失败算", async () => {
    const { queue } = harness();
    await queue.add([fileOf("a.png")], "i1");

    const tasks = queue.tasks();
    expect(progressOf(tasks)).toEqual([]); // 全部完成 → 没有进度
    expect(uploadStatusLabel(progressOf(tasks))).toBe("");
  });
});

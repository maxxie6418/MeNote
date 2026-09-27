// @vitest-environment jsdom
/**
 * "上次没传完"的附件在回来时要能看到（界面稿 §7.2）。
 *
 * **背景**：上传队列与 `File` 对象只在本机内存里（设计 §3.2-6 的取舍），刷新即丢。
 * 但本地 `attachmentsMeta.status` 已经把"没传完"记下来了（`pending` / `failed`），
 * 所以"回来时从状态栏能看到未完成项"是可以做到的——本轮把这条线接上
 * （此前 `listUnfinishedAttachments` / `countUnfinishedAttachments` 零调用，属哑数据）。
 *
 * 一句诚实的边界：**只能看到、不能自动续传**——文件已经不在手上，
 * 续传靠重新选一次文件（命中哈希就秒传）。所以界面给的是文案 + 说明，而不是一个点了没用的按钮。
 */
import "fake-indexeddb/auto";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, putAttachmentMeta, type LocalAttachment } from "../src/data/db";
import { leftoverLabel, LEFTOVER_HINT } from "../src/features/attachments/model";
import { useAttachments } from "../src/features/attachments/useAttachments";

afterEach(cleanup);

beforeEach(async () => {
  await db.delete();
  await db.open();
});

function attachment(overrides: Partial<LocalAttachment> = {}): LocalAttachment {
  return {
    attachment_id: "att-1",
    item_id: "i1",
    sha256: "a".repeat(64),
    filename: "照片.png",
    mime: "image/png",
    size_bytes: 2048,
    width: null,
    height: null,
    has_thumb: true,
    status: "pending",
    error: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

/** 把 hook 挂在一个极小组件上（只为读它的返回值） */
function Probe({ itemId }: { itemId: string }) {
  const attachments = useAttachments({ itemId, handle: null });
  return (
    <div>
      <span data-testid="label">{attachments.statusLabel}</span>
      <span data-testid="leftover">{attachments.leftoverCount}</span>
      <span data-testid="tone">{attachments.statusTone ?? "none"}</span>
    </div>
  );
}

describe("文案", () => {
  it("单数与复数、0 不显示", () => {
    expect(leftoverLabel(0)).toBe("");
    expect(leftoverLabel(1)).toBe("有 1 个附件没传完");
    expect(leftoverLabel(3)).toBe("有 3 个附件没传完");
  });

  it("说明里写清「怎么办」（重新选一次文件，已传的会秒传）", () => {
    expect(LEFTOVER_HINT).toContain("重新选择一次");
    expect(LEFTOVER_HINT).toContain("秒传");
  });
});

describe("回来时能看到未完成项", () => {
  it("本地有 pending / failed 的附件时，状态栏显示数量（警告态）", async () => {
    await putAttachmentMeta(attachment({ attachment_id: "a1" }));
    await putAttachmentMeta(attachment({ attachment_id: "a2", status: "failed" }));
    await putAttachmentMeta(attachment({ attachment_id: "a3", status: "uploaded" }));

    render(<Probe itemId="i1" />);

    await waitFor(() => {
      expect(screen.getByTestId("leftover").textContent).toBe("2");
    });
    expect(screen.getByTestId("label").textContent).toBe("有 2 个附件没传完");
    // 未完成属警告语义（不是"正在传"）
    expect(screen.getByTestId("tone").textContent).toBe("warn");
  });

  it("全部传完时状态栏不显示（空文案）", async () => {
    await putAttachmentMeta(attachment({ status: "uploaded" }));
    render(<Probe itemId="i1" />);

    await waitFor(() => {
      expect(screen.getByTestId("leftover").textContent).toBe("0");
    });
    expect(screen.getByTestId("label").textContent).toBe("");
    expect(screen.getByTestId("tone").textContent).toBe("none");
  });

  it("只看当前这一篇的未完成项（切条目不该串台）", async () => {
    await putAttachmentMeta(attachment({ attachment_id: "a1", item_id: "i1" }));
    await putAttachmentMeta(attachment({ attachment_id: "b1", item_id: "i2" }));

    render(<Probe itemId="i2" />);
    await waitFor(() => {
      expect(screen.getByTestId("leftover").textContent).toBe("1");
    });
  });
});

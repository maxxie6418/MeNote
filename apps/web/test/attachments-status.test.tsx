// @vitest-environment jsdom
/**
 * 状态栏的附件行（M4-10；《M4 界面稿》§7.2）与编辑器取文件的小工具（§7.1）。
 *
 * 要点：**实时计数可见**、失败走警告色并给可见的「重试」、锁定态不显示附件行
 * （锁定时正文区是占位，状态栏也不该漏出内容面的计数）。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocStatusBar } from "../src/features/notes/ui/DocStatusBar";
import { filesFromDataTransfer } from "../src/app/editor/Editor";
import type { NoteEditorSnapshot } from "../src/features/notes/model";

afterEach(cleanup);

const SNAPSHOT: NoteEditorSnapshot = {
  sizeLabel: "1.2 KB",
  sizeLevel: "ok",
  saveState: "synced",
  bytes: 1200,
};

describe("状态栏的附件行", () => {
  it("上传中显示进度计数（落在既有状态栏，不新增第二条）", () => {
    render(
      <DocStatusBar
        snapshot={SNAPSHOT}
        attachments={{ label: "上传中 1 / 3", tone: "busy" }}
      />,
    );
    expect(screen.getByText("上传中 1 / 3")).toBeTruthy();
    // 既有内容还在（大小与同步状态）
    expect(screen.getByText("1.2 KB")).toBeTruthy();
    expect(screen.getByText("已同步")).toBeTruthy();
  });

  it("失败时给警告色与可见的「重试」入口（点击回调真的被调）", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <DocStatusBar
        snapshot={SNAPSHOT}
        attachments={{ label: "1 个附件上传失败", tone: "warn", onRetry }}
      />,
    );

    const line = document.querySelector(".doc-status__attach") as HTMLElement;
    expect(line.className).toContain("doc-status__attach--warn");

    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("不在传时不显示附件行（空文案不占位）", () => {
    render(<DocStatusBar snapshot={SNAPSHOT} attachments={{ label: "", tone: "busy" }} />);
    expect(document.querySelector(".doc-status__attach")).toBeNull();
  });

  it("锁定态不显示附件行（锁定时正文区是占位，计数也不该漏出来）", () => {
    render(
      <DocStatusBar
        snapshot={SNAPSHOT}
        encryption={{ encrypted: true, unlocked: false }}
        attachments={{ label: "上传中 1 / 3", tone: "busy" }}
      />,
    );
    expect(document.querySelector(".doc-status__attach")).toBeNull();
    expect(screen.getByText("已加密")).toBeTruthy();
  });
});

describe("从剪贴板/拖放数据取文件", () => {
  function transfer(files: File[], itemFiles?: File[]): DataTransfer {
    // `files` 用真数组（可迭代）：实现里是 `[...data.files]`，假件也必须可展开
    const items = (itemFiles ?? files).map((file) => ({
      kind: "file",
      getAsFile: () => file,
      type: file.type,
    }));
    return { files, items } as unknown as DataTransfer;
  }

  it("从 `items` 取文件（剪贴板图片在部分浏览器里只有 items）", () => {
    const file = new File(["x"], "粘贴的图.png", { type: "image/png" });
    expect(filesFromDataTransfer(transfer([], [file]))).toEqual([file]);
  });

  it("`items` 为空时退回 `files`（文件夹拖入会走这条）", () => {
    const file = new File(["x"], "a.pdf", { type: "application/pdf" });
    expect(filesFromDataTransfer(transfer([file], []))).toEqual([file]);
  });

  it("没有文件时返回空数组（普通文字粘贴不该被拦）", () => {
    expect(filesFromDataTransfer(null)).toEqual([]);
    expect(filesFromDataTransfer(transfer([], []))).toEqual([]);
  });
});

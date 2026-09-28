// @vitest-environment jsdom
/**
 * 标题输入框（2026-09-28 用户反馈"新建笔记输入标题延迟特别高、几乎无法输入正确的文字"）。
 *
 * 根因：标题框受控在**本地库里那份已提交的标题**上，而每敲一个字都 `await refresh()`
 * （6 张表 + 全量正文摘要 + 搜索索引重扫），异步回灌把刚敲的字按回去。
 * 实测（808 条笔记、60ms/字）：输入 10 个字**只剩 1 个**，伴随一条 294ms 主线程长任务。
 *
 * 本文件把 `TitleInput` 的契约钉死：
 * 1. 输入**立刻**回显（不等任何 await / 防抖）；
 * 2. 空闲 400ms 提交**一次**，且提交的是最终值；
 * 3. 失焦、卸载（切换条目）**立刻**提交——不提交就等于丢掉刚敲的标题；
 * 4. 外部值变化：本地没有待提交内容才采纳（别把用户正在敲的字顶掉）。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMMIT_IDLE_MS, TitleInput } from "../src/features/notes/ui/TitleInput";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function titleBox(): HTMLInputElement {
  return screen.getByLabelText("标题") as HTMLInputElement;
}

describe("标题输入框：本地回显 + 防抖提交", () => {
  it("输入立刻回显，不等提交", () => {
    const onCommit = vi.fn();
    render(<TitleInput value="旧标题" onCommit={onCommit} />);

    fireEvent.change(titleBox(), { target: { value: "新标题" } });

    expect(titleBox().value).toBe("新标题");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("空闲 400ms 才提交，且只提交最终值一次", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(<TitleInput value="" onCommit={onCommit} />);

    fireEvent.change(titleBox(), { target: { value: "性" } });
    act(() => {
      vi.advanceTimersByTime(COMMIT_IDLE_MS - 100);
    });
    fireEvent.change(titleBox(), { target: { value: "性能测" } });
    act(() => {
      vi.advanceTimersByTime(COMMIT_IDLE_MS - 100);
    });
    // 还在敲：一次都不该提交（否则又成了"每个字一次全库刷新"）
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("性能测");
  });

  it("失焦立刻提交", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(<TitleInput value="" onCommit={onCommit} />);

    fireEvent.change(titleBox(), { target: { value: "会议纪要" } });
    fireEvent.blur(titleBox());

    expect(onCommit).toHaveBeenCalledWith("会议纪要");
  });

  it("卸载前提交（切换条目不许把刚敲的标题带走）", () => {
    const onCommit = vi.fn();
    const { unmount } = render(<TitleInput value="" onCommit={onCommit} />);

    fireEvent.change(titleBox(), { target: { value: "未保存的标题" } });
    unmount();

    expect(onCommit).toHaveBeenCalledWith("未保存的标题");
  });

  it("值没变就不提交（防抖后重复提交同一份内容没有意义）", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(<TitleInput value="原标题" onCommit={onCommit} />);

    fireEvent.change(titleBox(), { target: { value: "原标题" } });
    act(() => {
      vi.advanceTimersByTime(COMMIT_IDLE_MS + 50);
    });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("外部值变化且本地没有待提交内容 → 采纳（同步下来 / 重新载入）", () => {
    const onCommit = vi.fn();
    const { rerender } = render(<TitleInput value="原标题" onCommit={onCommit} />);

    rerender(<TitleInput value="别处改过的标题" onCommit={onCommit} />);

    expect(titleBox().value).toBe("别处改过的标题");
  });

  it("本地有待提交内容时，外部值不顶掉用户正在敲的字", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const { rerender } = render(<TitleInput value="原标题" onCommit={onCommit} />);

    fireEvent.change(titleBox(), { target: { value: "我正在敲的字" } });
    rerender(<TitleInput value="别处改过的标题" onCommit={onCommit} />);
    expect(titleBox().value).toBe("我正在敲的字");

    act(() => {
      vi.advanceTimersByTime(COMMIT_IDLE_MS + 50);
    });
    expect(onCommit).toHaveBeenCalledWith("我正在敲的字");
  });
});

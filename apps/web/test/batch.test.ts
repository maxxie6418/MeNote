// @vitest-environment node
/**
 * 批量标记的执行器（M3-8；《隐私锁设计》§8）。
 *
 * 这里钉住三条设计口径：**逐条执行**（不是一次请求）、**单条失败跳过、其余继续**
 * （不做全成功或全失败）、**逐条回报进度**（界面显示"处理中 12 / 40"）。
 */
import { describe, expect, it, vi } from "vitest";
import { progressLabel, runBatch } from "../src/features/notes/batch";

describe("runBatch", () => {
  it("按顺序逐条执行，并逐条回报进度", async () => {
    const order: number[] = [];
    const progress: Array<{ done: number; total: number }> = [];

    const result = await runBatch({
      items: [1, 2, 3],
      run: async (item) => {
        order.push(item);
      },
      onProgress: (value) => progress.push(value),
    });

    expect(order).toEqual([1, 2, 3]);
    expect(progress).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
    expect(result).toEqual({ done: 3, failures: [] });
  });

  it("单条失败只跳过那一条，其余照常处理（不做全成功或全失败）", async () => {
    const processed: string[] = [];
    const progress: number[] = [];

    const result = await runBatch({
      items: ["a", "b", "c"],
      run: async (item) => {
        if (item === "b") throw new Error("目标文件夹不存在");
        processed.push(item);
      },
      onProgress: (value) => progress.push(value.done),
    });

    expect(processed).toEqual(["a", "c"]);
    expect(result.done).toBe(3);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.item).toBe("b");
    expect(result.failures[0]?.reason).toBe("目标文件夹不存在");
    // 失败的那条也算"处理过"，进度不能卡住
    expect(progress).toEqual([1, 2, 3]);
  });

  it("抛出的不是 Error 时给一句兜底原因（不把 undefined 显示给用户）", async () => {
    const result = await runBatch({
      items: [1],
      run: async () => {
        throw "字符串异常";
      },
    });
    expect(result.failures[0]?.reason).toBe("未知错误");
  });

  it("空清单直接返回（不回调进度）", async () => {
    const onProgress = vi.fn();
    const result = await runBatch({ items: [], run: vi.fn(), onProgress });
    expect(result).toEqual({ done: 0, failures: [] });
    expect(onProgress).not.toHaveBeenCalled();
  });
});

describe("进度文案", () => {
  it("与设计里的写法一致：处理中 12 / 40", () => {
    expect(progressLabel({ done: 12, total: 40 })).toBe("处理中 12 / 40");
  });
});

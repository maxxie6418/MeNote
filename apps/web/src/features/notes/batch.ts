/**
 * 批量标记的执行器（M3-8；《隐私锁设计》§8）。
 *
 * 设计口径逐条落在这里：
 * - **逐条提交**（不是一次请求塞进去）：单条失败**跳过**并记录，**不做"全成功或全失败"**；
 * - **进度可见**：每处理一条回报一次（界面显示"处理中 12 / 40"）；
 * - **中断续做**：真正的持久化在 outbox（每条 patch 各自入队），所以中途关页面、断网、
 *   刷新都不会丢——未推送的 op 还在 outbox 里，下次同步继续。**这里不自己存队列**。
 *
 * 纯函数式：不碰 Dexie、不碰网络，只负责"按顺序跑、数进度、收集失败"，
 * 因此可以直接单测（含"某些条失败"这种不方便在真实环境里造的场景）。
 */

export interface BatchProgress {
  /** 已处理完的条数（含失败） */
  done: number;
  total: number;
}

export interface BatchFailure<T> {
  item: T;
  /** 失败原因（取异常的 message，给用户看的那一句） */
  reason: string;
}

export interface BatchResult<T> {
  done: number;
  failures: Array<BatchFailure<T>>;
}

export interface RunBatchInput<T> {
  items: readonly T[];
  /** 对单条执行的动作（通常是"写本地 + 入队"） */
  run: (item: T) => Promise<void>;
  /** 每条处理完回调一次（含失败的那条） */
  onProgress?: (progress: BatchProgress) => void;
}

export async function runBatch<T>(input: RunBatchInput<T>): Promise<BatchResult<T>> {
  const { items, run, onProgress } = input;
  const failures: Array<BatchFailure<T>> = [];
  let done = 0;

  for (const item of items) {
    try {
      await run(item);
    } catch (error) {
      failures.push({
        item,
        reason: error instanceof Error && error.message ? error.message : "未知错误",
      });
    }
    done += 1;
    onProgress?.({ done, total: items.length });
  }

  return { done, failures };
}

/** 进度文案（"处理中 12 / 40"）——界面与提示共用一个写法 */
export function progressLabel(progress: BatchProgress): string {
  return `处理中 ${progress.done} / ${progress.total}`;
}

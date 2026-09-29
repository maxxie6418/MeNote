/**
 * 试验页的性能读数。只回答两件事：刚才那个动作花了多久，以及长任务是不是紧跟在它后面。
 *
 * 不记内存、不记帧率曲线——那些数字晃，对不上「卡在哪」。
 */

export interface LabAction {
  label: string;
  /** `performance.now()`，动作开始 */
  startedAt: number;
  /** 到下一帧绘制的毫秒；还没画完是 null */
  paintMs: number | null;
}

export interface LabLongTask {
  /** 相对 `performance.now()` 的起点 */
  startedAt: number;
  ms: number;
  /** 800ms 内刚发生的动作；对不上就是 null，不编一个原因 */
  after: string | null;
}

const ATTRIBUTE_WINDOW_MS = 800;
export const LONG_TASK_WINDOW_MS = 60_000;

export function labNow(): number {
  return performance.now();
}

/** 丢掉窗口外的长任务。`now` 由观察回调传入，不在渲染期读时钟。 */
export function retainRecentLongTasks(
  tasks: readonly LabLongTask[],
  now: number,
  windowMs = LONG_TASK_WINDOW_MS,
): LabLongTask[] {
  return tasks.filter((task) => now - task.startedAt <= windowMs);
}

/** 长任务开始前 800ms 内最近的一个动作。对不上就返回 null。 */
export function attributeLongTask(actions: readonly LabAction[], taskStartedAt: number): string | null {
  let best: LabAction | null = null;
  for (const action of actions) {
    const gap = taskStartedAt - action.startedAt;
    if (gap < 0 || gap > ATTRIBUTE_WINDOW_MS) continue;
    if (!best || action.startedAt > best.startedAt) best = action;
  }
  return best?.label ?? null;
}

/** 调用方先把窗口外的任务丢掉。这里只汇总手里这份，渲染期不再读时钟。 */
export function summarizeLongTasks(tasks: readonly LabLongTask[]): {
  count: number;
  maxMs: number;
  latest: LabLongTask | null;
} {
  const recent = tasks;
  let maxMs = 0;
  let latest: LabLongTask | null = null;
  for (const task of recent) {
    if (task.ms > maxMs) maxMs = task.ms;
    if (!latest || task.startedAt > latest.startedAt) latest = task;
  }
  return { count: recent.length, maxMs, latest };
}

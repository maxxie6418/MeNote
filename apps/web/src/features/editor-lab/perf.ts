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

/**
 * 编辑器生命周期读数（编辑拓展阶段 B / Task B3；阶段 C / Task C1 改为测真实视图）。
 *
 * 为什么不用 `querySelectorAll("[data-editor]")`：那只说明 DOM 里**看起来**有几个宿主，
 * 看不出视图有没有真的建好、卸载时有没有把监听撤干净——而"连续切换后计数回不到基线"
 * 正是要抓的那类泄漏。
 *
 * 谁在报（C1 的关键修正）：上报点是 `app/editor/Editor.tsx` 里 `EditorView` 真的建/毁、
 * 真的挂/撤监听、真的走 `Compartment` 重配置的那一刻，**不是**试验页外壳的 React 挂/卸。
 * 外壳 effect 与视图生命周期只是通常同进同出，一旦分岔（视图已销毁而宿主还挂着），
 * 数 DOM 或数 effect 的读数都会谎报，而这条读数存在的理由正是抓这种情况。
 *
 * `modeSwitches` 单独记：它必须**不影响**活跃实例与监听数。切换档位只重配置，
 * 重建文档的话实例数会往上爬、撤销历史也会丢，那正是文档 §五 第 5 条要防的。
 */
export interface LabLifecycleSnapshot {
  activeEditors: number;
  activeListeners: number;
  /** 累计的档位重配置次数（只读开关与即时渲染共用一个计数） */
  modeSwitches: number;
}

export interface EditorLabMeter {
  /** 编辑器视图真的建好了 */
  created(): LabLifecycleSnapshot;
  /** 编辑器视图真的销毁了 */
  destroyed(): LabLifecycleSnapshot;
  /** 编辑器真的把自己的更新监听挂上了 */
  listenerAdded(): LabLifecycleSnapshot;
  /** 编辑器真的把监听撤掉了 */
  listenerRemoved(): LabLifecycleSnapshot;
  /** 档位换了扩展，但**没有**重建文档 */
  modeReconfigured(): LabLifecycleSnapshot;
  snapshot(): LabLifecycleSnapshot;
}

/** 纯计数器：不知道谁在报，只保证成对上报时回到基线。 */
export function createEditorLabMeter(): EditorLabMeter {
  let editors = 0;
  let listeners = 0;
  let modeSwitches = 0;
  const snapshot = (): LabLifecycleSnapshot => ({
    activeEditors: editors,
    activeListeners: listeners,
    modeSwitches,
  });

  return {
    created: () => {
      editors += 1;
      return snapshot();
    },
    /*
      少配一次 `created` 也不数成负数——负的活跃数会掩盖漏报，比不报更糟。
      三个计数共用这一条：漏报要显形（对不上基线），但不能变成负数。
    */
    destroyed: () => {
      editors = Math.max(0, editors - 1);
      return snapshot();
    },
    listenerAdded: () => {
      listeners += 1;
      return snapshot();
    },
    listenerRemoved: () => {
      listeners = Math.max(0, listeners - 1);
      return snapshot();
    },
    modeReconfigured: () => {
      modeSwitches += 1;
      return snapshot();
    },
    snapshot,
  };
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

/**
 * 长任务只在能对上刚才的动作时才写原因。对不上就空着，不编一个。
 */
import { describe, expect, it } from "vitest";
import {
  attributeLongTask,
  retainRecentLongTasks,
  summarizeLongTasks,
  type LabAction,
  type LabLongTask,
} from "../src/features/editor-lab/perf";

function action(label: string, startedAt: number): LabAction {
  return { label, startedAt, paintMs: 1 };
}

describe("试验页性能归因", () => {
  it("800ms 内最近的动作算原因", () => {
    const actions = [action("切到短文", 1000), action("切到仅预览", 1500)];
    expect(attributeLongTask(actions, 1600)).toBe("切到仅预览");
  });

  it("早于动作、或超过 800ms，不对上", () => {
    const actions = [action("按键", 1000)];
    expect(attributeLongTask(actions, 999)).toBeNull();
    expect(attributeLongTask(actions, 1801)).toBeNull();
  });

  it("近一分钟的汇总只数窗口内的，并指出最近一条", () => {
    const tasks: LabLongTask[] = [
      { startedAt: 0, ms: 90, after: "旧的" },
      { startedAt: 50_000, ms: 40, after: null },
      { startedAt: 55_000, ms: 70, after: "切到代码块" },
    ];
    const recent = retainRecentLongTasks(tasks, 60_001);
    expect(summarizeLongTasks(recent)).toEqual({
      count: 2,
      maxMs: 70,
      latest: tasks[2],
    });
  });
});

/**
 * 长任务只在能对上刚才的动作时才写原因。对不上就空着，不编一个。
 */
import { describe, expect, it } from "vitest";
import {
  createEditorLabMeter,
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

describe("编辑器生命周期计数", () => {
  it("建/毁、挂/撤成对上报时，快照回到基线", () => {
    const meter = createEditorLabMeter();
    expect(meter.snapshot()).toMatchObject({ activeEditors: 0, activeListeners: 0 });

    expect(meter.created()).toMatchObject({ activeEditors: 1, activeListeners: 0 });
    expect(meter.listenerAdded()).toMatchObject({ activeEditors: 1, activeListeners: 1 });
    expect(meter.listenerRemoved()).toMatchObject({ activeEditors: 1, activeListeners: 0 });
    expect(meter.destroyed()).toMatchObject({ activeEditors: 0, activeListeners: 0 });
  });

  it("20 次 edit/live 切换后活动实例和监听数回到基线", () => {
    const meter = createEditorLabMeter();
    meter.created();
    meter.listenerAdded();
    for (let index = 0; index < 20; index += 1) meter.modeReconfigured();
    expect(meter.snapshot()).toMatchObject({ activeEditors: 1, activeListeners: 1 });
  });

  it("销毁编辑器会同时回收活动实例与监听", () => {
    const meter = createEditorLabMeter();
    meter.created();
    meter.listenerAdded();
    meter.destroyed();
    meter.listenerRemoved();
    expect(meter.snapshot()).toMatchObject({ activeEditors: 0, activeListeners: 0 });
  });

  it("重配置只累计次数，不多算实例与监听（20 次切换后各自仍是 1）", () => {
    const meter = createEditorLabMeter();
    meter.created();
    meter.listenerAdded();
    for (let index = 0; index < 20; index += 1) meter.modeReconfigured();
    const snapshot = meter.snapshot();
    expect(snapshot.activeEditors).toBe(1);
    expect(snapshot.activeListeners).toBe(1);
    expect(snapshot.modeSwitches).toBe(20);
  });

  it("连开两个编辑器各报一次，卸掉一个后还剩一个", () => {
    const meter = createEditorLabMeter();
    meter.created();
    meter.created();
    expect(meter.destroyed().activeEditors).toBe(1);
  });

  it("多撤一次不会数成负数（漏报要显形，但不能变成负的活跃数）", () => {
    const meter = createEditorLabMeter();
    expect(meter.destroyed().activeEditors).toBe(0);
    expect(meter.listenerRemoved().activeListeners).toBe(0);
  });
});

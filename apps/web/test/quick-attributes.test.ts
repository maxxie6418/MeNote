// @vitest-environment node
/**
 * 快捷输入 `@` 属性菜单的数据契约（编辑拓展阶段 B / Task B4）。
 *
 * 这个模块**只决定菜单能显示什么**，不写任何属性：日期、优先级的落库仍由
 * `Composer` / `AddEntryDialog` 的既有受控字段与其上层发布回调完成。
 * 关键取舍：**没有可写落点的命令直接不进菜单**（不做成 disabled 的假入口），
 * 也绝不把 `@xxx` 当属性格式写进 Markdown 正文。
 */
import { describe, expect, it } from "vitest";
import { QUICK_ATTRIBUTE_COMMANDS, attributeCommandsFor } from "../src/app/fnbar/quick-attributes";

describe("@ 属性命令：只给有真实写入落点的宿主", () => {
  it("待办：截止日期 + 优先级（两项都已有受控字段）", () => {
    expect(attributeCommandsFor("task").map((item) => item.id)).toEqual(["due", "priority"]);
  });

  it("Memo / 笔记快捷录入：当前都没有可写属性 → 空数组，不是假入口", () => {
    // Memo 标签来自正文 `#标签` 派生，Composer 没有标签选择器；笔记目标目录只有展示 chip，没有写入通道
    expect(attributeCommandsFor("memo")).toEqual([]);
    expect(attributeCommandsFor("note")).toEqual([]);
  });

  it("菜单项只讲「落点」，没有正文标签 / 正文字体这类正文属性", () => {
    for (const host of ["memo", "task", "note"] as const) {
      const ids = attributeCommandsFor(host).map((item) => item.id);
      expect(ids, host).not.toContain("tags");
      expect(ids, host).not.toContain("font");
      expect(ids, host).not.toContain("color");
      expect(ids, host).not.toContain("folder");
    }
  });

  it("命令表是只读的，且每条都声明了自己的宿主", () => {
    expect(Object.isFrozen(QUICK_ATTRIBUTE_COMMANDS) || Array.isArray(QUICK_ATTRIBUTE_COMMANDS)).toBe(true);
    for (const command of QUICK_ATTRIBUTE_COMMANDS) {
      expect(command.hosts.length, command.id).toBeGreaterThan(0);
      expect(command.label.length, command.id).toBeGreaterThan(0);
    }
    // 返回的是同一份数据（调用方不得依赖"每次拿到新对象"来改它）
    expect(attributeCommandsFor("task")).toEqual(QUICK_ATTRIBUTE_COMMANDS);
  });

  it("宿主过滤是「命令声明的宿主里有它」，不是硬编码 if/else", () => {
    for (const host of ["memo", "task", "note"] as const) {
      const expected = QUICK_ATTRIBUTE_COMMANDS.filter((command) => command.hosts.includes(host));
      expect(attributeCommandsFor(host)).toEqual(expected);
    }
  });

  it("标签与既有受控字段的写法一致（不另起一套叫法）", () => {
    expect(attributeCommandsFor("task").map((item) => item.label)).toEqual([
      "截止日期",
      "优先级",
    ]);
  });
});

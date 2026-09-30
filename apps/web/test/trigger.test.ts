// @vitest-environment node
/**
 * 命令触发词的判定（编辑拓展阶段 B）。
 *
 * 这条规则只有一份实现（`editor/trigger.ts`），正文编辑器与快捷输入都从它取结果，
 * 所以边界要在这里一次钉死——`12/34` 里那个斜杠、代码块里的 `/`、输入法组合后的 `/`，
 * 在哪儿都不该弹出菜单。
 */
import { describe, expect, it } from "vitest";
import { insideCodeFence, triggerAt } from "../src/app/editor/trigger";
import { slashQueryAt } from "../src/app/editor/Editor";
import { triggerAt as quickTriggerAt } from "../src/app/fnbar/QuickComposer";

describe("触发位置：行首或空白之后", () => {
  it("行首的 / 与 @ 都算", () => {
    expect(triggerAt("/", 1)).toEqual({ kind: "/", query: "", start: 0, caret: 1 });
    expect(triggerAt("/加", 2)).toEqual({ kind: "/", query: "加", start: 0, caret: 2 });
    expect(triggerAt("@", 1)).toEqual({ kind: "@", query: "", start: 0, caret: 1 });
  });

  it("空白之后的也算（换行、空格、Tab 都是空白）", () => {
    expect(triggerAt("# 标题\n/加", "# 标题\n/加".length)?.query).toBe("加");
    expect(triggerAt("甲 /加", 4)?.query).toBe("加");
    expect(triggerAt("甲\t@", "甲\t@".length)).toEqual({ kind: "@", query: "", start: 2, caret: 3 });
  });

  it("紧跟在文字后面的不算（那是内容里的斜杠）", () => {
    expect(triggerAt("12/34", 5)).toBeNull();
    expect(triggerAt("正文/", 3)).toBeNull();
    expect(triggerAt("a@b", 3)).toBeNull();
  });

  it("触发词到光标之间有空白 → 已经不是在输入命令", () => {
    expect(triggerAt("/加 粗", 5)).toBeNull();
    expect(triggerAt("@due 明天", 7)).toBeNull();
  });

  it("取光标前最近的那个触发词（前面的 / 不影响）", () => {
    const text = "/旧 /新";
    expect(triggerAt(text, text.length)).toEqual({ kind: "/", query: "新", start: 3, caret: 5 });
  });

  it("光标在触发词之前或文本为空时不触发", () => {
    expect(triggerAt("", 0)).toBeNull();
    expect(triggerAt("/加", 0)).toBeNull();
    expect(triggerAt("/加", 5)).toBeNull();
  });
});

describe("代码围栏内不触发", () => {
  it("围栏内（奇数个围栏行）不算，围栏外算", () => {
    expect(triggerAt("```\n/加", 6)).toBeNull();
    expect(triggerAt("~~~\n@", 5)).toBeNull();
    expect(triggerAt("```\n```\n\n/加", 11)).toEqual({ kind: "/", query: "加", start: 9, caret: 11 });
  });

  it("insideCodeFence 只数光标之前的部分", () => {
    expect(insideCodeFence("```\n", 2)).toBe(false); // 还没换行
    expect(insideCodeFence("```\n", 4)).toBe(true);
    expect(insideCodeFence("```\n```\n", 8)).toBe(false);
  });
});

describe("两个宿主取到的是同一份判定", () => {
  it("正文只要 `/`，录入框要 `/` 与 `@`", () => {
    expect(slashQueryAt("甲 /加", 4)).toBe("加");
    expect(slashQueryAt("甲 @", 3)).toBeNull(); // 正文不吃 `@`（属性只属于快捷输入）
    expect(quickTriggerAt("甲 @", 3)?.kind).toBe("@");
  });

  it("同一段文本下，两边对 `/` 的判断完全一致", () => {
    const texts = ["/加", "甲 /加", "12/34", "/加 粗", "```\n/加", "```\n```\n/加"];
    for (const text of texts) {
      const caret = text.length;
      const body = slashQueryAt(text, caret);
      const quick = quickTriggerAt(text, caret);
      expect(quick?.kind === "/" ? quick.query : null, text).toBe(body);
    }
  });
});

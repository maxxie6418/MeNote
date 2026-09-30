// @vitest-environment node
/**
 * 正文编辑器的格式命令桥（编辑拓展阶段 B）。
 *
 * `Editor` 里真正动文本的两处——`slashQueryAt`（要不要出菜单）与 `applyFormatAt`
 * （执行命令时先吃掉 `/查询` 触发段）——是纯函数，单独测比透过 CodeMirror 视图测更稳：
 * 试验页用例为了在 jsdom 下跑起来把 `Editor` 换成了替身，这一层就补上"替身之外"的部分。
 */
import { describe, expect, it } from "vitest";
import { applyFormatAt, slashQueryAt } from "../src/app/editor/Editor";

describe("slashQueryAt：正文里的 `/` 触发词", () => {
  it("行首 / 空白后算，文字后不算", () => {
    expect(slashQueryAt("/加", 2)).toBe("加");
    expect(slashQueryAt("甲\n/加", 4)).toBe("加");
    expect(slashQueryAt("12/34", 5)).toBeNull();
  });

  it("代码围栏内不算（正文里那段是代码）", () => {
    expect(slashQueryAt("```\n/加", 6)).toBeNull();
  });
});

describe("applyFormatAt：执行命令并吃掉触发段", () => {
  it("空选区 + 触发词：删掉 `/加粗` 再在光标处插标记，正文里不留命令名", () => {
    const result = applyFormatAt("/加粗", { from: 3, to: 3 }, "bold");
    expect(result.text).toBe("****");
    expect(result.selection).toEqual({ from: 2, to: 2 });
  });

  it("触发词只吃掉自己那一段，前面写的内容留着", () => {
    const text = "开会 /引用";
    const result = applyFormatAt(text, { from: text.length, to: text.length }, "quote");
    expect(result.text).toBe("> 开会 ");
  });

  it("有选区时按普通命令处理（选中的内容不该被当成触发词）", () => {
    const result = applyFormatAt("买牛奶", { from: 0, to: 3 }, "bold");
    expect(result.text).toBe("**买牛奶**");
    expect(result.selection).toEqual({ from: 2, to: 5 });
  });

  it("光标不在触发位置时按普通命令处理", () => {
    // 行中间的 `/`：`slashQueryAt` 判定不成立，就不会被删
    const result = applyFormatAt("甲/乙", { from: 3, to: 3 }, "bold");
    expect(result.text).toBe("甲/乙****");
  });
});

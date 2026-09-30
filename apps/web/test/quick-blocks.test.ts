import { describe, expect, it } from "vitest";

import {
  columnOfOffset,
  lineOfOffset,
  offsetOfLine,
  splitQuickBlocks,
  type QuickBlock,
} from "../src/app/fnbar/quick-blocks";

/** 只关心切法的用例都用它：把块还原成行下标的"区间串" */
function shape(text: string): string[] {
  return splitQuickBlocks(text).map((block: QuickBlock) => `${block.from}-${block.to}`);
}

function texts(text: string): string[] {
  return splitQuickBlocks(text).map((block: QuickBlock) => block.text);
}

describe("快捷输入切块：块级标记在行首就开新块", () => {
  it("空串没有块（调用方按「一个空输入框」处理）", () => {
    expect(splitQuickBlocks("")).toEqual([]);
  });

  it("单行就是一块", () => {
    expect(texts("正文")).toEqual(["正文"]);
  });

  it("标题 / 无序 / 有序 / 分隔线各自开新块", () => {
    expect(shape("# 标题\n正文")).toEqual(["0-0", "1-1"]);
    expect(shape("- 一\n- 二")).toEqual(["0-0", "1-1"]);
    expect(shape("1. 一\n2. 二")).toEqual(["0-0", "1-1"]);
    expect(shape("正文\n---")).toEqual(["0-0", "1-1"]);
  });

  it("引用有 lazy continuation：没有空行时下一行仍属引用（与 Markdown 渲染一致）", () => {
    expect(shape("> 引用\n正文")).toEqual(["0-1"]);
    expect(shape("> 引用\n\n正文")).toEqual(["0-1", "2-2"]);
    expect(shape("> 引用\n# 标题")).toEqual(["0-0", "1-1"]);
  });

  it("没有标记的连续两行仍是同一块（Markdown 的软换行/段落语义）", () => {
    expect(shape("第一行\n第二行")).toEqual(["0-1"]);
    // lazy continuation：列表项后面那行没有标记，仍属于该项
    expect(shape("- 项目\n续行")).toEqual(["0-1"]);
    // 表格行也是普通行，不该被拆开
    expect(shape("| a | b |\n|---|---|")).toEqual(["0-1"]);
  });
});

describe("快捷输入切块：空行是分隔符，但归前一块的尾部", () => {
  it("空行分隔两块，且空行留在前一块里（这样才能逐字还原）", () => {
    expect(texts("a\n\nb")).toEqual(["a\n", "b"]);
  });

  it("连续空行不制造空块", () => {
    expect(texts("a\n\n\nb")).toEqual(["a\n\n", "b"]);
    expect(shape("a\n\n\nb")).toEqual(["0-2", "3-3"]);
  });

  it("只有空行的输入：文末那一行自成一块（那是光标所在的下一块）", () => {
    expect(texts("\n")).toEqual(["", ""]);
    expect(texts("\n\n")).toEqual(["\n", ""]);
  });
});

describe("快捷输入切块：围栏内不切", () => {
  it("围栏里的 `-` 与 `#` 都不算标记", () => {
    expect(shape("```\n- 不是列表\n# 不是标题\n```")).toEqual(["0-3"]);
    expect(shape("~~~\n> 引用\n~~~")).toEqual(["0-2"]);
  });

  it("围栏可以打断段落：前面有内容就先收掉前一块", () => {
    expect(shape("正文\n```\ncode\n```")).toEqual(["0-0", "1-3"]);
  });

  it("围栏后面还有内容：闭围栏之后另起一块", () => {
    expect(shape("```\ncode\n```\n后文")).toEqual(["0-2", "3-3"]);
  });

  it("未闭合的围栏吃到文末", () => {
    expect(shape("```\na\nb")).toEqual(["0-2"]);
  });
});

describe("快捷输入切块：文末的空行自成一块（回车就提交上一块）", () => {
  it("列表项后面按下的那个空行是**独立一块**，上一项因此可以立刻呈现", () => {
    expect(texts("- 第一项\n")).toEqual(["- 第一项", ""]);
    expect(texts("# 标题\n")).toEqual(["# 标题", ""]);
  });

  it("中间的空行仍归前一块（与上面「空行归前块」的规则并存）", () => {
    expect(texts("a\n\nb")).toEqual(["a\n", "b"]);
    expect(texts("a\n\n")).toEqual(["a\n", ""]);
  });

  it("段落后面按回车也一样提交（Markdown 里这是软换行，但用户按的是 Enter）", () => {
    expect(texts("第一行\n")).toEqual(["第一行", ""]);
  });
});

describe("快捷输入切块：内容永远逐字不变（安全网）", () => {
  const samples = [
    "",
    "a",
    "正文\n第二行",
    "- 一\n- 二\n",
    "a\n\nb",
    "a\n\n\nb",
    "\n",
    "# 标题\n\n- 项\n  续行\n\n```\n- 代码\n```\n收尾",
    "| a | b |\n|---|---|\n| 1 | 2 |",
    "> 引用\n> 引用二\n\n正文",
    "a\r\nb\r\n",
    "- 列表\r\n续行\r\n",
    "前后都有空行\n\n",
    "\n\n前导空行",
  ];

  it.each(samples)("`join('\\n')` 逐字还原原文：%j", (sample: string) => {
    expect(
      splitQuickBlocks(sample)
        .map((block: QuickBlock) => block.text)
        .join("\n"),
    ).toBe(sample);
  });

  it("块区间覆盖每一行且不重叠、不留缝", () => {
    const sample = "# 标题\n\n- 一\n- 二\n\n```\ncode\n```\n尾巴";
    const blocks = splitQuickBlocks(sample);
    const lineCount = sample.split("\n").length;
    expect(blocks[0]?.from).toBe(0);
    expect(blocks[blocks.length - 1]?.to).toBe(lineCount - 1);
    blocks.forEach((block, index) => {
      if (index === 0) return;
      expect(block.from).toBe((blocks[index - 1]?.to ?? -1) + 1);
    });
  });
});

describe("快捷输入切块的偏移工具（把光标钉在块内同一处）", () => {
  it("`lineOfOffset` 数光标前的换行", () => {
    expect(lineOfOffset("abc", 0)).toBe(0);
    expect(lineOfOffset("a\nb", 2)).toBe(1);
    expect(lineOfOffset("a\nb", 1)).toBe(0);
    // 越界夹住，不抛
    expect(lineOfOffset("a\nb", 99)).toBe(1);
    expect(lineOfOffset("a\nb", -1)).toBe(0);
  });

  it("`columnOfOffset` 给行内第几个字符", () => {
    expect(columnOfOffset("a\nbc", 3)).toBe(1);
    expect(columnOfOffset("a\nbc", 2)).toBe(0);
    expect(columnOfOffset("abc", 99)).toBe(3);
  });

  it("`offsetOfLine` 与 `lineOfOffset` 互为逆运算", () => {
    const text = "一\n二\n三";
    for (let line = 0; line <= 3; line += 1) {
      const offset = offsetOfLine(text, line);
      if (line < 3) expect(lineOfOffset(text, offset)).toBe(line);
    }
    expect(offsetOfLine(text, 0)).toBe(0);
    expect(offsetOfLine(text, 1)).toBe(2);
    expect(offsetOfLine(text, 3)).toBe(text.length);
  });
});

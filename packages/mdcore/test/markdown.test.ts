import { describe, expect, it } from "vitest";
import { firstHeading, splitFirstLineAsTitle } from "../src/markdown";

describe("标题取值", () => {
  it("首行是一级标题时取它（Q24 的联动来源）", () => {
    expect(firstHeading("---\nmenote:\n  type: note\n---\n\n# 会议记录\n\n正文")).toBe("会议记录");
    expect(firstHeading("# 直接开头\n\n正文")).toBe("直接开头");
  });

  it("首行是普通段落就不取标题（只认首行即一级标题）", () => {
    expect(firstHeading("先写了一段话\n\n# 后面的标题")).toBeNull();
  });

  it("没有标题返回 null", () => {
    expect(firstHeading("正文而已")).toBeNull();
    expect(firstHeading("## 二级不算")).toBeNull();
  });
});

describe("快速录入框「笔记」模式的首行作标题", () => {
  it("首行作标题，其余为正文，并吃掉首行起始的 #", () => {
    expect(splitFirstLineAsTitle("# 买菜\n\n- 西红柿\n- 鸡蛋")).toEqual({
      title: "买菜",
      body: "- 西红柿\n- 鸡蛋",
    });
  });

  it("只有一行时正文为空", () => {
    expect(splitFirstLineAsTitle("只有标题")).toEqual({ title: "只有标题", body: "" });
  });

  it("首行后的空行都吃掉，不动其它行", () => {
    expect(splitFirstLineAsTitle("标题\n\n\n正文行")).toEqual({ title: "标题", body: "正文行" });
  });
});

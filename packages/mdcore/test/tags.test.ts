import { describe, expect, it } from "vitest";
import { deriveTags, extractInlineTags, mergeTags, normalizeTag } from "../src/tags";

describe("行内标签提取", () => {
  it("基本用法：空白或行首后的 #标签", () => {
    expect(extractInlineTags("今天 #工作 和 #dev")).toEqual(["工作", "dev"]);
    expect(extractInlineTags("#开头就是标签")).toEqual(["开头就是标签"]);
  });

  it("标题不算标签（# 后是空白）", () => {
    expect(extractInlineTags("# 一级标题\n## 二级标题\n正文")).toEqual([]);
  });

  it("网址里的锚点不算标签（# 前不是空白/行首）", () => {
    expect(extractInlineTags("见 https://example.com/page#section 与 a#b")).toEqual([]);
  });

  it("代码块与行内代码里的 # 不算标签", () => {
    const text = "```\n#工作\n```\n\n这是 `#dev` 示例，真正的标签是 #真实";
    expect(extractInlineTags(text)).toEqual(["真实"]);
  });

  it("中文标点作为标签结束符", () => {
    expect(extractInlineTags("记一下 #工作，还有 #生活。")).toEqual(["工作", "生活"]);
  });

  it("开括号后的标签也能取到", () => {
    expect(extractInlineTags("分类（#项目）里的")).toEqual(["项目"]);
  });
});

describe("标签合并与派生", () => {
  it("normalizeTag 去掉起始 # 与空白", () => {
    expect(normalizeTag("  #工作 ")).toBe("工作");
    expect(normalizeTag("##")).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
  });

  it("YAML 在前、正文补充，大小写不敏感去重且保留首次写法", () => {
    expect(mergeTags(["工作", "Dev"], ["dev", "生活", "工作"])).toEqual(["工作", "Dev", "生活"]);
  });

  it("deriveTags = YAML tags + 正文 #标签", () => {
    const doc = `---
menote:
  tags: [工作]
---

今天 #dev 顺手记一笔 #工作
`;
    expect(deriveTags(doc)).toEqual(["工作", "dev"]);
  });

  it("没有标签时返回空数组", () => {
    expect(deriveTags("# 标题\n\n正文没有标签")).toEqual([]);
  });
});

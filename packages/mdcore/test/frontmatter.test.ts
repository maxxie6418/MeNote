import { describe, expect, it } from "vitest";
import {
  buildDocument,
  parseMenoteMeta,
  stripFrontmatter,
  updateMenoteKeys,
} from "../src/frontmatter";

const DOC = `---
menote:
  type: note
  tags: [工作, dev]
  task:
    status: todo
    due: 2026-09-30
    priority: high
---

# 正文标题

内容。
`;

describe("front matter 解析", () => {
  it("取出 type / tags / task 与正文", () => {
    const { meta, body } = parseMenoteMeta(DOC);
    expect(meta.type).toBe("note");
    expect(meta.tags).toEqual(["工作", "dev"]);
    expect(meta.task).toEqual({ status: "todo", due: "2026-09-30", priority: "high" });
    expect(body.startsWith("# 正文标题")).toBe(true);
  });

  it("没有 front matter：整篇都是正文（不抛错）", () => {
    const parsed = parseMenoteMeta("# 只有正文");
    expect(parsed.raw).toBeNull();
    expect(parsed.meta.type).toBeNull();
    expect(parsed.body).toBe("# 只有正文");
  });

  it("围栏没闭合 → 降级为正文（需求 §10.2 的容错要求）", () => {
    const broken = "---\nmenote:\n  type: note\n\n# 正文";
    const parsed = parseMenoteMeta(broken);
    expect(parsed.raw).toBeNull();
    expect(parsed.body).toBe(broken);
  });

  it("tags 也支持块序列写法", () => {
    const parsed = parseMenoteMeta("---\nmenote:\n  tags:\n    - a\n    - b\n---\n\n正文");
    expect(parsed.meta.tags).toEqual(["a", "b"]);
  });

  it("task 键存在但字段为空也算清单条目（有无键就是清单标记本身）", () => {
    const parsed = parseMenoteMeta("---\nmenote:\n  task:\n---\n\n正文");
    expect(parsed.meta.task).toEqual({ status: null, due: null, priority: null });
  });

  it("stripFrontmatter 只回正文", () => {
    expect(stripFrontmatter(DOC)).toContain("# 正文标题");
    expect(stripFrontmatter(DOC)).not.toContain("menote:");
  });
});

describe("front matter 改写（安全底线：不认识的键不能丢）", () => {
  const TABLE = `---
menote:
  type: table
  row_id_column: _id
  columns:
    书名: { type: text }
    评分: { type: number }
  views:
    gallery: { image: 封面 }
  tags: [书单]
---

| _id | 书名 |
|---|---|
| a | 三体 |
`;

  it("只改命中的键，表格的 columns / views 原样保留", () => {
    const updated = updateMenoteKeys(TABLE, { tags: ["书单", "科幻"] });

    expect(updated).toContain("  tags: [书单, 科幻]");
    // 未知键连嵌套内容一字不动
    expect(updated).toContain("  row_id_column: _id");
    expect(updated).toContain("  columns:");
    expect(updated).toContain("    书名: { type: text }");
    expect(updated).toContain("  views:");
    expect(updated).toContain("    gallery: { image: 封面 }");
    expect(updated).toContain("| a | 三体 |");
  });

  it("patch 里没有的键不动；新增的键追加到末尾", () => {
    const updated = updateMenoteKeys("---\nmenote:\n  type: note\n---\n\n正文", {
      tags: ["a"],
    });
    expect(updated).toContain("  type: note");
    expect(updated).toContain("  tags: [a]");
    expect(updated.indexOf("  type: note")).toBeLessThan(updated.indexOf("  tags: [a]"));
  });

  it("task: null 删除整个 task 块（Q23：去掉清单标记即删除字段）", () => {
    const updated = updateMenoteKeys(DOC, { task: null });
    expect(updated).not.toContain("task:");
    expect(updated).not.toContain("status: todo");
    expect(updated).toContain("  tags: [工作, dev]"); // 其它键不受影响
    expect(updated).toContain("# 正文标题");
  });

  it("原本没有 front matter 时按 patch 新建一个", () => {
    const updated = updateMenoteKeys("# 正文", { type: "note", tags: ["x"] });
    expect(updated.startsWith("---\nmenote:\n")).toBe(true);
    expect(updated).toContain("  type: note");
    expect(updated).toContain("  tags: [x]");
    expect(updated.endsWith("# 正文")).toBe(true);
  });

  it("含逗号的标签会加引号，且能原样解析回来", () => {
    const built = buildDocument(
      { type: null, tags: ['a,b', "c"], task: null, preservedLines: [] },
      "正文",
    );
    expect(built).toContain('tags: ["a,b", c]');
    expect(parseMenoteMeta(built).meta.tags).toEqual(["a,b", "c"]);
  });

  it("buildDocument 在没有任何 meta 时直接返回正文", () => {
    expect(buildDocument({ type: null, tags: [], task: null, preservedLines: [] }, "正文")).toBe(
      "正文",
    );
  });
});

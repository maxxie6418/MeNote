// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/app/editor/markdown";

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("Markdown 渲染", () => {
  it("渲染标题、加粗、列表与代码", () => {
    const html = renderMarkdown("# 标题\n\n**粗体**\n\n- 一\n- 二\n\n`code`");
    const doc = parse(html);
    expect(doc.querySelector("h1")?.textContent).toBe("标题");
    expect(doc.querySelector("strong")?.textContent).toBe("粗体");
    expect(doc.querySelectorAll("li")).toHaveLength(2);
    expect(doc.querySelector("code")?.textContent).toBe("code");
  });

  it("原始 HTML 不作为元素出现（只作为文本）", () => {
    const doc = parse(
      renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n**正文**'),
    );

    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.body.textContent).toContain("<script>");
    expect(doc.querySelector("strong")?.textContent).toBe("正文");
  });

  it("外链统一带 rel=noopener noreferrer，且不给 target", () => {
    const doc = parse(renderMarkdown("[官网](https://example.com)\n\nhttps://example.org"));

    const links = [...doc.querySelectorAll("a")];
    expect(links.length).toBeGreaterThanOrEqual(2); // 一个手写链接 + 一个 linkify 出来的
    for (const link of links) {
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.getAttribute("target")).toBeNull();
    }
  });

  it("javascript: 协议不会变成 href", () => {
    const doc = parse(renderMarkdown("[点我](javascript:alert(1))"));

    for (const link of doc.querySelectorAll("a")) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
    }
  });
});

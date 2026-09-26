/**
 * 从条目 md 里取标题（需求 §7.1、Q24 联动口径）。
 *
 * Q24 定：按钮新建不预填一级标题；标题仍是「未命名笔记」，而**正文首行是一级标题时自动取用**；
 * 用户手动改过标题后不再联动。所以这里只提供两个纯函数，联动与否由界面层按"用户是否手改过"决定。
 */
import { stripFrontmatter } from "./frontmatter";

/** 正文里第一个一级标题的文本（`# 标题` → `标题`），没有则 null */
export function firstHeading(markdown: string): string | null {
  const body = stripFrontmatter(markdown);
  for (const line of body.split("\n")) {
    const matched = /^#\s+(.+?)\s*#*\s*$/.exec(line.trimEnd());
    if (matched?.[1]) return matched[1].trim();
    // 正文开头若已是普通段落，就不再往下找标题（只认"首行即一级标题"）
    if (line.trim() !== "") return null;
  }
  return null;
}

/**
 * 快速录入框的「笔记」模式：**首行作标题**，其余为正文。
 * 首行会被去掉起始的 `#` 与首尾空白；首行之后允许一个空行。
 */
export function splitFirstLineAsTitle(text: string): { title: string; body: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const first = (lines[0] ?? "").trim().replace(/^#+\s*/, "").trim();
  let rest = lines.slice(1);
  while (rest.length > 0 && (rest[0] ?? "").trim() === "") rest = rest.slice(1);
  return { title: first, body: rest.join("\n").trimEnd() };
}

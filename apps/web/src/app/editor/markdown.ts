/**
 * Markdown 渲染与安全（架构 §3.4）。
 *
 * - `html: false`：markdown-it **不放行原始 HTML**；
 * - 渲染结果再过一遍 DOMPurify：双保险，且未来若放开白名单标签时仍有兜底；
 * - 外链统一加 `rel="noopener noreferrer"`（不给 `target`，避免把用户带出应用）。
 */
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});

const defaultLinkOpen = md.renderer.rules.link_open;
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token) token.attrSet("rel", "noopener noreferrer");
  if (defaultLinkOpen) return defaultLinkOpen(tokens, idx, options, env, self);
  return self.renderToken(tokens, idx, options);
};

/** Markdown → 安全 HTML 字符串（仅供 `dangerouslySetInnerHTML` 使用） */
export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(md.render(source));
}

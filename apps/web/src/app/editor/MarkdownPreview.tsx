/**
 * Markdown 预览（架构 §3.4）。单独一个组件，便于与编辑器一起被**动态导入**成独立分包
 * （架构 §14.1 要求 Markdown 渲染不进首屏）。
 */
import { renderMarkdown } from "./markdown";

export function MarkdownPreview({ source }: { source: string }) {
  return (
    <div
      className="markdown-body"
      // 内容已经 markdown-it（不放行原始 HTML）+ DOMPurify 双重处理
      dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }}
    />
  );
}

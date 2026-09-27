/**
 * Markdown 预览（架构 §3.4）。单独一个组件，便于与编辑器一起被**动态导入**成独立分包
 * （架构 §14.1 要求 Markdown 渲染不进首屏）。
 *
 * M4-10：附件引用要能"看出是什么"——非图片附件补大小、找不到对象时标"不可用"（界面稿 §7.4）。
 * 元数据由调用方从本地库读好后传进来（预览层不碰数据访问，与"UI 只做展示"的分工一致）。
 */
import {
  decorateAttachmentSizes,
  renderMarkdown,
  type AttachmentRenderMeta,
} from "./markdown";

export interface MarkdownPreviewProps {
  source: string;
  /** 本地已知的附件（`sha256 -> 元数据`）：标"不可用"与补大小用 */
  attachments?: Record<string, AttachmentRenderMeta>;
}

export function MarkdownPreview({ source, attachments }: MarkdownPreviewProps) {
  const html = renderMarkdown(source, { attachments });
  return (
    <div
      className="markdown-body"
      // 内容已经 markdown-it（不放行原始 HTML）+ DOMPurify 双重处理
      dangerouslySetInnerHTML={{
        __html: attachments ? decorateAttachmentSizes(html, attachments) : html,
      }}
    />
  );
}

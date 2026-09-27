/**
 * Markdown 预览（架构 §3.4）。单独一个组件，便于与编辑器一起被**动态导入**成独立分包
 * （架构 §14.1 要求 Markdown 渲染不进首屏）。
 *
 * M4-10：附件引用要能"看出是什么"——非图片附件补大小、找不到对象时标"不可用"（界面稿 §7.4）。
 * 元数据由调用方从本地库读好后传进来（预览层不碰数据访问，与"UI 只做展示"的分工一致）。
 */
import { useMemo } from "react";
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
  /*
    **必须记忆化**：`renderMarkdown` 是 markdown-it 全文解析 + DOMPurify 净化 + 附件大小正则，
    而这个组件在正文区的**每次渲染**都会跑（切换条目重挂一次、分隔屏下每个键都还要再跑一次）。
    实测（jsdom，4KB 中文）：单次 `renderMarkdown` 约 23ms —— 2000 篇的库上叠加列表重渲染，
    就是用户感觉到的"卡"（2026-09-27 实测）。依赖只有 `source` 与附件元数据，
    两者不变时结果完全一致，没有记忆化的风险。
  */
  const html = useMemo(() => {
    const rendered = renderMarkdown(source, { attachments });
    return attachments ? decorateAttachmentSizes(rendered, attachments) : rendered;
  }, [source, attachments]);

  return (
    <div
      className="markdown-body"
      // 内容已经 markdown-it（不放行原始 HTML）+ DOMPurify 双重处理
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

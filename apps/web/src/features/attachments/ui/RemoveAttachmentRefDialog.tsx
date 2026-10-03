/**
 * 「移除附件引用」弹窗（M10-新 · M6 批 2b；《M4 界面稿》§7.6 的候选 C）。
 *
 * **入口取舍**：功能拆解 M10-新 定的默认是「更多菜单为主 + 选中后常驻小工具条为辅」，
 * 两个入口都不靠悬停。本轮只落了**更多菜单**这一个——常驻小工具条要给 CodeMirror 加
 * 「选区 → 是哪张图」的上报（`EditorHandle` 目前只有 `read` / `insert` / `replace` /
 * `applyFormat`），代价大、收益小，没有接口就别做半成品。
 *
 * **语义必须说清**：移除引用**不等于删除文件**——只从这篇正文的附件章节里删掉那一条，
 * 文件本身要等到**没有任何地方引用满 30 天**才被孤儿清理带走。这句写在弹窗头部（后果要
 * 可见，`DESIGN.md` §5.4-2），30 天那条口径收进 `InfoHint`（§5.4-1 不许平铺）。
 *
 * 组件**不改正文**：它只把要删掉的那一段原文交回宿主，由宿主用
 * `EditorHandle.replace(marker, "")` 落进编辑器——视图与光标状态才和手删一致，
 * 保存链路也照常走。列表解析复用 `extractAttachmentRefsWithNames`，不另写一套。
 */
import { useState } from "react";
import { extractAttachmentRefsWithNames } from "@menote/shared";
import { Button } from "../../../app/ui/Controls";
import { InfoHint } from "../../../app/ui/InfoHint";
import { Modal } from "../../../app/ui/Modal";
import { attachmentRefLabel, planAttachmentRefRemoval } from "../model";

export interface RemoveAttachmentRefDialogProps {
  /** 打开那一刻的正文（宿主从编辑器侧拿到的**当前**文本，不是打开条目时的快照） */
  body: string;
  onClose: () => void;
  /** 交回"要删掉的那一段原文"；宿主拿它去 `EditorHandle.replace(marker, "")` */
  onRemove: (marker: string) => void;
}

export function RemoveAttachmentRefDialog({ body, onClose, onRemove }: RemoveAttachmentRefDialogProps) {
  /**
   * 自己留一份正文：移除一行后立刻从列表里消失。
   * 不等编辑器回灌是因为回灌要走保存链路（落草稿 + 入队），弹窗会明显慢半拍。
   */
  const [text, setText] = useState(body);
  const refs = extractAttachmentRefsWithNames(text);

  function remove(sha256: string): void {
    const plan = planAttachmentRefRemoval(text, sha256);
    if (!plan) return;
    setText(plan.body);
    onRemove(plan.marker);
  }

  return (
    <Modal
      open
      title="移除附件引用"
      desc="只从这篇正文的附件章节移除引用，文件本身不会被删除。"
      onClose={onClose}
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          完成
        </Button>
      }
    >
      {refs.length > 0 ? (
        <p className="hint-line">
          这篇正文当前引用 {refs.length} 个附件。
          <InfoHint label="移除引用说明">
            移除后正文里那一行会删掉，文件仍然留着；它要等到没有任何地方引用满 30 天之后，才会被孤儿清理带走。
          </InfoHint>
        </p>
      ) : (
        <p className="hint-line">
          这一篇已经没有可移除的附件引用了。
          <InfoHint label="移除引用说明">
            移除引用只是从正文里删掉那一行，文件仍然留着；没有任何地方引用满 30 天之后才会被清理。
          </InfoHint>
        </p>
      )}

      {refs.map((ref) => (
        <div key={ref.sha256} className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">{attachmentRefLabel(ref.filename)}</span>
          </div>
          <div className="setrow__control">
            <Button
              variant="secondary"
              size="sm"
              title="从正文里删掉这一行引用（文件不删，仍可从别处引用）"
              onClick={() => remove(ref.sha256)}
            >
              移除引用
            </Button>
          </div>
        </div>
      ))}
    </Modal>
  );
}

/**
 * 正文底部状态栏（DESIGN.md §6.6：保存与同步状态、大小都在这里）。
 *
 * 文案规则（DESIGN.md §5.4）：警告、破坏性后果、实时计数**必须保持可见**，不得收进 `InfoHint`；
 * 状态用**文字**表达，颜色只是辅助（禁止项 #4）。
 * 样式类名留给主题层（M1-10 按 DESIGN.md 令牌落 CSS），这里不写任何颜色。
 */
import type { NoteEditorSnapshot, SaveState } from "../model";

const SAVE_LABEL: Record<SaveState, string> = {
  synced: "已同步",
  pending: "待上传",
  failed: "上传失败",
  conflict: "冲突",
  blocked: "已达硬上限",
};

export interface DocStatusBarProps {
  snapshot: NoteEditorSnapshot;
}

export function DocStatusBar({ snapshot }: DocStatusBarProps) {
  const { sizeLabel, sizeLevel, saveState } = snapshot;

  return (
    <div className="doc-status" role="status" aria-live="polite">
      <span className={`doc-status__size doc-status__size--${sizeLevel}`}>{sizeLabel}</span>

      {sizeLevel === "soft" && (
        <span className="doc-status__hint doc-status__hint--warn">
          文档内容过大，建议拆分为多篇
        </span>
      )}
      {sizeLevel === "hard" && (
        <span className="doc-status__hint doc-status__hint--danger">
          已达硬上限，无法继续保存，请拆分内容
        </span>
      )}

      <span className={`doc-status__save doc-status__save--${saveState}`}>
        {SAVE_LABEL[saveState]}
      </span>
    </div>
  );
}

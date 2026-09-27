/**
 * 正文底部状态栏（DESIGN.md §6.6：保存与同步状态、大小都在这里）。
 *
 * 文案规则（DESIGN.md §5.4）：警告、破坏性后果、实时计数**必须保持可见**，不得收进 `InfoHint`；
 * 状态用**文字**表达，颜色只是辅助（禁止项 #4）。
 * 样式类名留给主题层（M1-10 按 DESIGN.md 令牌落 CSS），这里不写任何颜色。
 *
 * M3-10 起这里还承载两件事（《隐私锁设计》§9.2-④）：
 * 1. **加密状态常驻一条**：单篇的"已加密 / 已解密" + 隐私锁的档位行（如"加密空间 · 已解锁 · 本次会话"）；
 * 2. **即将自动锁定的提示**：`minutes` 档剩 30 秒时提示"未保存的内容会先保存"——
 *    只说**先保存**，不提任何"加密"字样（与明文存储模型一致；文案红线见设计 §9.3）。
 */
import { useTicker } from "../../../app/ui/useTicker";
import type { NoteEditorSnapshot, SaveState } from "../model";

const SAVE_LABEL: Record<SaveState, string> = {
  synced: "已同步",
  pending: "待上传",
  failed: "上传失败",
  conflict: "冲突",
  blocked: "已达硬上限",
};

/** 剩多少毫秒时提示"即将自动锁定"（设计 §9.2：30 秒） */
export const AUTO_LOCK_NOTICE_MS = 30_000;

export interface DocStatusBarProps {
  snapshot: NoteEditorSnapshot;
  /**
   * 单篇加密状态（M3-7）：锁定时只显示"已加密"，
   * **不显示实时大小**——那是内容面的信息（设计 §9.2）。
   */
  encryption?: { encrypted: boolean; unlocked: boolean };
  /**
   * 隐私锁档位行（M3-10，设计 §9.2-④）：例如"加密空间 · 已解锁 · 本次会话"。
   * `onLock` 给「立即锁定」出口（设备长期档时文案是「锁定此设备」）。
   */
  privacyLine?: {
    text: string;
    /** N 分钟档的到期时刻（用于自动锁定提示）；其它档为 null */
    expiresAt: number | null;
    onLock?: () => void;
    lockLabel?: string;
  } | null;
  /**
   * 附件上传状态（M4-10；界面稿 §7.2）：**实时计数必须可见**，落在**既有**状态栏里，
   * 不新增第二条状态栏。失败时给可见的「重试」次操作。
   */
  attachments?: {
    label: string;
    tone: "busy" | "warn";
    onRetry?: () => void;
  } | null;
  /** 便于测试固定"现在"；给了就不挂每秒定时器 */
  now?: number;
}

export function DocStatusBar({ snapshot, encryption, privacyLine, attachments, now }: DocStatusBarProps) {
  const { sizeLabel, sizeLevel, saveState } = snapshot;
  const locked = encryption?.encrypted === true && !encryption.unlocked;

  // 只有"有到期时刻、且没被固定住时间"时才需要每秒刷新（别的档位没有倒计时）
  const ticking = useTicker(privacyLine?.expiresAt != null && now === undefined);
  const currentMs = now ?? ticking;
  const remainingMs =
    privacyLine?.expiresAt != null ? Math.max(0, privacyLine.expiresAt - currentMs) : null;
  const aboutToLock = remainingMs !== null && remainingMs <= AUTO_LOCK_NOTICE_MS;

  return (
    <div className="doc-status" role="status" aria-live="polite">
      {encryption?.encrypted ? (
        <span className={`pill ${locked ? "pill--err" : "pill--busy"}`}>
          {locked ? "已加密" : "已加密 · 本次已解锁"}
        </span>
      ) : null}

      {privacyLine ? (
        <>
          <span className="doc-status__hint">{privacyLine.text}</span>
          {privacyLine.onLock ? (
            <button type="button" className="btn btn--sm" onClick={privacyLine.onLock}>
              {privacyLine.lockLabel ?? "立即锁定"}
            </button>
          ) : null}
        </>
      ) : null}

      {aboutToLock ? (
        <span className="doc-status__hint doc-status__hint--warn">
          即将自动锁定，未保存的内容会先保存
        </span>
      ) : null}

      {/* 锁定时不显示大小（内容面信息），只保留加密状态 */}
      {locked ? null : (
        <span className={`doc-status__size doc-status__size--${sizeLevel}`}>{sizeLabel}</span>
      )}

      {attachments && attachments.label !== "" && !locked ? (
        <span
          className={`doc-status__attach${attachments.tone === "warn" ? " doc-status__attach--warn" : ""}`}
        >
          {attachments.label}
          {attachments.tone === "warn" && attachments.onRetry ? (
            <button type="button" className="btn btn--sm" onClick={attachments.onRetry}>
              重试
            </button>
          ) : null}
        </span>
      ) : null}

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

/**
 * 解锁框（`components.md` §八 `UnlockModal`；《隐私锁设计》§9.2、界面稿 §二）。
 *
 * 四种触发共用这一个框：顶栏胶囊、空间节点、Memo/待办占位、单篇加密条目。
 * 差别只有标题与档位块：**单篇场景不显示档位**（它的时效固定为本次浏览器会话，设计 §4.5）。
 *
 * 三条纪律：
 * 1. 密码**只在本地校验**（对照 `verifier`），服务端不参与；错密码时本地计次并逐次加等待；
 * 2. 「忘记隐私密码」不是死链：走 `onForgot` 去设置 › 隐私锁 重置（设计 §6.12）；
 * 3. 离线且本地没有材料时禁用提交并说明原因（设计 §4.6），不做"点了没反应"。
 *
 * **关闭即弃**：组件自己不清状态，由调用方在关闭时改 `key` 让它重新挂载——
 * 这样"密码、错误、等待"天然不会跨次残留，也避免在 effect 里同步 setState。
 */
import { useEffect, useRef, useState } from "react";
import { Field } from "../../../app/ui/Controls";
import { Modal } from "../../../app/ui/Modal";
import { Button } from "../../../app/ui/Controls";
import {
  PRIVACY_TIERS,
  TIER_LABELS,
  unlockBackoffSeconds,
  type PrivacyTier,
} from "../model";

export interface UnlockModalProps {
  open: boolean;
  /** `scope` = 隐私锁（可临时选档位）；`item` = 单篇（逐篇解密，不显示档位） */
  variant?: "scope" | "item";
  /** 设置里的默认档位 */
  defaultTier: PrivacyTier;
  /** N 分钟档的分钟数（用于文案） */
  minutes: number;
  onClose: () => void;
  /** 校验并开门禁；返回 `false` 表示密码不对 */
  onSubmit: (password: string, tier: PrivacyTier) => Promise<boolean>;
  /** 「忘记隐私密码」：去设置 › 隐私锁 重置 */
  onForgot: () => void;
  /** 无本地材料（离线且没缓存）→ 置灰并说明需要联网 */
  unavailable?: boolean;
}

export function UnlockModal({
  open,
  variant = "scope",
  defaultTier,
  minutes,
  onClose,
  onSubmit,
  onForgot,
  unavailable = false,
}: UnlockModalProps) {
  const [password, setPassword] = useState("");
  const [tier, setTier] = useState<PrivacyTier>(defaultTier);
  const [failures, setFailures] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitLeft, setWaitLeft] = useState(0);
  const waitTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (waitLeft <= 0) return undefined;
    waitTimer.current = setInterval(() => {
      setWaitLeft((left) => Math.max(0, left - 1));
    }, 1_000);
    return () => {
      if (waitTimer.current) clearInterval(waitTimer.current);
      waitTimer.current = null;
    };
  }, [waitLeft]);

  const blockingWait = waitLeft > 0;
  const canSubmit = !busy && !unavailable && !blockingWait && password !== "";

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await onSubmit(password, variant === "item" ? "session" : tier);
      if (ok) {
        onClose();
        return;
      }
      const next = failures + 1;
      setFailures(next);
      const wait = unlockBackoffSeconds(next);
      setWaitLeft(wait);
      setError(
        wait > 0 ? `隐私密码错误；请等待 ${wait} 秒后再试` : "隐私密码错误，请重试",
      );
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={variant === "item" ? "解锁此篇" : "解锁隐私锁"}
      desc={
        variant === "item"
          ? "单篇加密需要逐篇解密；本次浏览器会话内有效，可随时手动锁上。"
          : `解锁后范围内内容可见（${TIER_LABELS[tier]}${
              tier === "minutes" ? ` · ${minutes} 分钟` : ""
            }）。单篇加密的条目仍需各自解密。`
      }
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? "校验中…" : "解锁"}
          </Button>
        </>
      }
    >
      <Field
        label="隐私密码"
        type="password"
        autoComplete="current-password"
        value={password}
        error={error ?? undefined}
        onChange={(event) => setPassword(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
      />

      {variant === "scope" ? (
        <fieldset className="radioset">
          <legend>本次解锁档位</legend>
          {PRIVACY_TIERS.map((option) => (
            <label key={option} className="radioset__item">
              <input
                type="radio"
                name="unlock-tier"
                checked={tier === option}
                onChange={() => setTier(option)}
              />
              <span>{TIER_LABELS[option]}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {unavailable ? (
        <p className="field__error" role="alert">
          本地没有校验材料，需要联网校验隐私密码。
        </p>
      ) : null}

      <button type="button" className="link" onClick={onForgot}>
        忘记隐私密码
      </button>
    </Modal>
  );
}

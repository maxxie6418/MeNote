/**
 * 隐私锁在组合根的两处接线（M3-9）。
 *
 * 从 `App.tsx` 抽出来的：入口文件有 500 行预算，而这两块都只依赖"隐私锁组装层 + 设置"，
 * 与笔记/同步那摊逻辑无关。抽出来后 `App` 只写一行插槽和一个弹框。
 *
 * **解锁框用 `key` 控制"关闭即弃"**：开/关各一个 key，关闭后再打开是重新挂载，
 * 于是密码、错误提示、等待倒计时都不会跨次残留（也不需要在弹框内部用 effect 清状态）。
 */
import type { UserSettings } from "@menote/shared";
import { PrivacyCapsule } from "../features/privacy/ui/PrivacyCapsule";
import { UnlockModal } from "../features/privacy/ui/UnlockModal";
import type { PrivacyLockState } from "../features/privacy/usePrivacyLock";
import type { PrivacyTier } from "../features/privacy/model";

export interface PrivacySlotProps {
  privacy: PrivacyLockState;
  onRequestUnlock: () => void;
}

/** 顶栏第 ⑤ 槽：未启用时返回 null（整个槽位不渲染） */
export function PrivacySlot({ privacy, onRequestUnlock }: PrivacySlotProps) {
  return (
    <PrivacyCapsule
      lockState={privacy.runtime.lockState}
      tier={privacy.runtime.tier}
      expiresAt={privacy.runtime.expiresAt}
      onRequestUnlock={onRequestUnlock}
      onLockAll={privacy.lockAll}
      onChangeTier={privacy.setTier}
      onLockDevice={privacy.lockAll}
    />
  );
}

export interface AppUnlockModalProps {
  open: boolean;
  privacy: PrivacyLockState;
  settings: UserSettings;
  onClose: () => void;
  /** 「忘记隐私密码」：去设置 › 隐私锁 重置 */
  onForgot: () => void;
}

/** 全应用共用的解锁出口：胶囊、Memo/待办占位、单篇加密都指向它 */
export function AppUnlockModal({
  open,
  privacy,
  settings,
  onClose,
  onForgot,
}: AppUnlockModalProps) {
  return (
    <UnlockModal
      key={open ? "unlock-open" : "unlock-closed"}
      open={open}
      defaultTier={settings.privacy.tier}
      minutes={settings.privacy.minutes}
      onClose={onClose}
      onSubmit={(password: string, tier: PrivacyTier) => privacy.unlock(password, tier)}
      onForgot={onForgot}
      unavailable={!privacy.enabled && !privacy.ready}
    />
  );
}

/**
 * 隐私锁页 ②「隐私密码」卡（M3 界面稿 §四②）：修改 + 忘记后重置。
 *
 * 从 `PrivacySettingsPage.tsx` 抽出（2026-09-28）：一是那张页已接近 500 行预算，
 * 二是这一卡自带三个密码草稿、两处校验与一个确认框，自成一块。
 *
 * 三条纪律（与页面同源，别在这里放松）：
 * 1. **改密不是"重新加密"**：内容密钥 K 不变——这句保证收进 `InfoHint`（口径），
 *    而"重置需要联网、失败时原因要看得见"这类**前置条件与失败原因必须可见**；
 * 2. 重置是破坏性动作 → 走 `ConfirmDialog` 二次确认，并明说**旧备份解不开**；
 * 3. 离线时"修改 / 重置"两个入口置灰并可见说明"需要联网"。
 */
import { useState } from "react";
import { Button } from "../../../../app/ui/Controls";
import { ConfirmDialog } from "../../../../app/ui/ConfirmDialog";
import { InfoHint } from "../../../../app/ui/InfoHint";
import { messageOf } from "./helpers";
import { PasswordRow } from "./PasswordRow";

export interface PrivacyPasswordCardProps {
  busy: boolean;
  changePassword: (oldPassword: string, newPassword: string) => Promise<boolean>;
  resetPassword: (newPassword: string) => Promise<void>;
  /**
   * 重新包裹内容密钥（2026-09-28）：输入当前隐私密码 → 服务端用**当前**根机密派生的键
   * 重包 `k_wrapped_backup` 一次。只在"实例根机密变更过 / 从旧版本升级上来"时才需要。
   */
  rewrapContentKey: (password: string) => Promise<boolean>;
  /** 锁定态：这个修复动作要在解锁态做（可用性与原因都可见，不只靠 `title`） */
  locked: boolean;
  /** 离线：联网入口都要置灰并说明原因 */
  offline: boolean;
  /** 成功提示交回页面统一显示（`role="status"` 只留一处） */
  onNote: (text: string) => void;
}

export function PrivacyPasswordCard({
  busy,
  changePassword,
  resetPassword,
  rewrapContentKey,
  locked,
  offline,
  onNote,
}: PrivacyPasswordCardProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRepeat, setNewRepeat] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  /** 「重新包裹内容密钥」的错误（与改密分开显示，免得一次操作把另一处的报错清掉） */
  const [rewrapError, setRewrapError] = useState<string | null>(null);

  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetRepeat, setResetRepeat] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  async function submitChange(): Promise<void> {
    if (newPassword === "") {
      setPasswordError("请输入新的隐私密码");
      return;
    }
    if (newPassword !== newRepeat) {
      setPasswordError("两次输入的新密码不一致");
      return;
    }
    setPasswordError(null);
    try {
      const ok = await changePassword(currentPassword, newPassword);
      if (!ok) {
        setPasswordError("当前隐私密码不正确");
        return;
      }
      onNote("隐私密码已修改；已加密的内容不受影响。");
      setCurrentPassword("");
      setNewPassword("");
      setNewRepeat("");
    } catch (error) {
      setPasswordError(messageOf(error, "修改失败，请检查网络后重试"));
    }
  }

  /**
   * 重新包裹内容密钥：用**同一个**「当前隐私密码」输入框，不新造第二套密码输入。
   * 只在"实例根机密变更过 / 从旧版本升级上来"时才用得到——用途写进 `InfoHint`，
   * 而前置条件（锁定 / 离线）与失败原因**保持可见**。
   */
  async function submitRewrap(): Promise<void> {
    if (currentPassword === "") {
      setRewrapError("请先填写当前隐私密码");
      return;
    }
    setRewrapError(null);
    try {
      const ok = await rewrapContentKey(currentPassword);
      if (!ok) {
        setRewrapError("当前隐私密码不正确");
        return;
      }
      onNote("内容密钥已重新包裹；「忘记隐私密码 → 重置」这条路恢复可用。");
      setCurrentPassword("");
    } catch (error) {
      setRewrapError(messageOf(error, "重新包裹失败，请检查网络后重试"));
    }
  }

  async function submitReset(): Promise<void> {
    if (resetPasswordValue === "") {
      setResetError("请输入新的隐私密码");
      return;
    }
    if (resetPasswordValue !== resetRepeat) {
      setResetError("两次输入的新密码不一致");
      return;
    }
    setResetError(null);
    try {
      await resetPassword(resetPasswordValue);
      onNote("已重置隐私密码；内容密钥没有变，已加密的内容都还在。");
      setResetPasswordValue("");
      setResetRepeat("");
    } catch (error) {
      setResetError(messageOf(error, "重置失败，请检查网络后重试"));
    }
  }

  return (
    <>
      <section className="setcard" aria-label="隐私密码">
        <h3 className="setcard__title">
          隐私密码
          <InfoHint label="隐私密码说明">
            隐私密码只用于本机校验，不会上传。修改密码时内容密钥不变，因此不会重新加密一遍内容；
            重置只是换一把打开同一把密钥的钥匙。
          </InfoHint>
        </h3>

        {offline ? (
          <p className="setrow__desc field__error">离线：修改与重置都需要联网（门禁材料在服务端）。</p>
        ) : null}

        <PasswordRow
          name="当前隐私密码"
          autoComplete="current-password"
          value={currentPassword}
          onChange={setCurrentPassword}
        />
        <PasswordRow
          name="新的隐私密码"
          autoComplete="new-password"
          value={newPassword}
          onChange={setNewPassword}
          error={passwordError}
        />
        <PasswordRow
          name="再输入一次新密码"
          autoComplete="new-password"
          value={newRepeat}
          onChange={setNewRepeat}
        />
        <div className="setrow">
          <div className="setrow__label" />
          <Button
            size="sm"
            disabled={busy || offline}
            title={offline ? "修改隐私密码需要联网" : undefined}
            onClick={() => void submitChange()}
          >
            修改密码
          </Button>
        </div>

        {/*
          重新包裹内容密钥（2026-09-28）：**运维修复入口**，不是日常操作。
          用途进 `InfoHint`；不可用的原因（锁定 / 离线）**可见**，不靠 `title`；
          它复用上面那个「当前隐私密码」输入框，不新造第二套密码输入。
        */}
        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">
              重新包裹内容密钥
              <InfoHint label="重新包裹内容密钥说明">
                只在实例的根机密变更过、或从旧版本升级上来时才需要：它把内容密钥交给服务端，
                用当前机密重包一次，让「忘记隐私密码 → 重置」重新可用。不改密码、不动内容。
              </InfoHint>
            </span>
            {locked ? (
              <span className="setrow__desc">先解锁隐私锁（或在解锁框里输入密码）后可用</span>
            ) : offline ? (
              <span className="setrow__desc">离线：这一步需要联网（要在服务端重包）</span>
            ) : (
              <span className="setrow__desc">用上面的「当前隐私密码」</span>
            )}
            {rewrapError ? (
              <span className="field__error" role="alert">
                {rewrapError}
              </span>
            ) : null}
          </div>
          <Button
            size="sm"
            disabled={busy || offline || locked}
            title={locked ? "先解锁隐私锁" : offline ? "需要联网" : undefined}
            onClick={() => void submitRewrap()}
          >
            重新包裹
          </Button>
        </div>

        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">忘记隐私密码</span>
            {/* 前置条件与失败原因保持可见（DESIGN.md §5.4-2），不收进 InfoHint */}
            <span className="setrow__desc">
              重置需要联网：服务端会用实例机密解出内容密钥，再用新密码重新包一份
            </span>
            {resetError ? (
              <span className="field__error" role="alert">
                {resetError}
              </span>
            ) : null}
          </div>
        </div>
        <PasswordRow
          name="重置为新的隐私密码"
          autoComplete="new-password"
          value={resetPasswordValue}
          onChange={setResetPasswordValue}
        />
        <PasswordRow
          name="再输入一次新密码（重置）"
          autoComplete="new-password"
          value={resetRepeat}
          onChange={setResetRepeat}
        />
        <div className="setrow">
          <div className="setrow__label" />
          {/* 重置是破坏性操作（DESIGN.md §6.5）：二次确认 + 明说"旧备份解不开" */}
          <Button
            size="sm"
            disabled={busy || offline}
            title={offline ? "重置隐私密码需要联网" : undefined}
            onClick={() => setConfirmReset(true)}
          >
            重置隐私密码
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmReset}
        title="重置隐私密码"
        desc="用一个新密码替换现在的隐私密码，旧密码立即失效。"
        confirmLabel="确认重置"
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          void submitReset();
        }}
      >
        <p>
          <strong>已经用旧密码加密的备份将解不开</strong>；本机内容不受影响。
        </p>
      </ConfirmDialog>
    </>
  );
}

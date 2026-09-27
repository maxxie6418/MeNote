/**
 * 设置页「隐私锁」分类（M3-9；界面稿 §四、设计 §7）。
 *
 * 四块：**状态**（启用 / 关闭）、**解锁档位**（三档 + N 分钟）、**隐私范围**（Memo 纳入 + 正文可搜）、
 * **隐私密码**（改密 / 重置）。这四块之外都是**即时生效 + 入队同步**（`onPatchSettings`），
 * 只有"启用 / 关闭 / 改密 / 重置"是联网动作——它们要写服务端的门禁材料。
 *
 * 三条纪律：
 * 1. **破坏性动作给理由与后果**：关闭隐私锁会先被服务端拦下（还有隐私内容），拦下来的原因必须显示；
 * 2. **重置不是"删数据"**：内容密钥 K 不变，只换包裹它的密码——文案必须说清，免得用户以为要丢内容；
 * 3. 错误、校验、实时状态**必须可见**（DESIGN.md §5.4-2），不收进 `InfoHint`。
 *
 * 版式只用既有类：`.setcard` / `.setrow` / `.radioset` / `.toggle` / `.field__input` / `.field__error`。
 */
import { useState } from "react";
import { PRIVACY_MINUTES_OPTIONS, type PrivacySettings } from "@menote/shared";
import { Button } from "../../../app/ui/Controls";
import { PRIVACY_TIERS, TIER_LABELS, type PrivacyTier } from "../../privacy/model";

/** 组装层里这块页面用到的部分（其余动作与本页无关） */
export interface PrivacyLockActions {
  enabled: boolean;
  busy: boolean;
  lockState: "disabled" | "locked" | "unlocked";
  enable: (password: string) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<boolean>;
  resetPassword: (newPassword: string) => Promise<void>;
  disable: () => Promise<void>;
}

export interface PrivacySettingsPageProps {
  lock: PrivacyLockActions;
  settings: PrivacySettings;
  onPatchSettings: (partial: { privacy: PrivacySettings }) => void;
}

const TIER_HINT: Record<PrivacyTier, string> = {
  minutes: "解锁后过一段时间自动锁上（默认档）",
  session: "关掉所有 Menote 标签页就锁上",
  device: "这台设备一直开着，直到手动锁定（公用电脑不要选）",
};

/** 从错误里取一句"能读懂的话"：服务端给了 message 就用它，否则给兜底文案 */
function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** 一行"名称 + 说明 + 输入框"：版式与设置页其它分类一致 */
function PasswordRow({
  name,
  desc,
  value,
  onChange,
  autoComplete,
  error,
}: {
  name: string;
  desc?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  error?: string | null;
}) {
  return (
    <div className="setrow">
      <div className="setrow__label">
        <span className="setrow__name">{name}</span>
        {desc ? <span className="setrow__desc">{desc}</span> : null}
        {error ? (
          <span className="field__error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      <input
        type="password"
        className="field__input"
        aria-label={name}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function PrivacySettingsPage({ lock, settings, onPatchSettings }: PrivacySettingsPageProps) {
  const [enableOpen, setEnableOpen] = useState(false);
  const [enablePassword, setEnablePassword] = useState("");
  const [enableRepeat, setEnableRepeat] = useState("");
  const [enableError, setEnableError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRepeat, setNewRepeat] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetRepeat, setResetRepeat] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [disableError, setDisableError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function patchPrivacy(partial: Partial<PrivacySettings>): void {
    onPatchSettings({ privacy: { ...settings, ...partial } });
  }

  async function submitEnable(): Promise<void> {
    if (enablePassword === "") {
      setEnableError("请先设置隐私密码");
      return;
    }
    if (enablePassword !== enableRepeat) {
      setEnableError("两次输入的隐私密码不一致");
      return;
    }
    setEnableError(null);
    try {
      await lock.enable(enablePassword);
      setEnableOpen(false);
      setEnablePassword("");
      setEnableRepeat("");
      setNote("隐私锁已启用；现在可以给单篇笔记加密，或把内容放进加密空间。");
    } catch (error) {
      setEnableError(messageOf(error, "启用失败，请检查网络后重试"));
    }
  }

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
    setNote(null);
    try {
      const ok = await lock.changePassword(currentPassword, newPassword);
      if (!ok) {
        setPasswordError("当前隐私密码不正确");
        return;
      }
      setNote("隐私密码已修改；已加密的内容不受影响。");
      setCurrentPassword("");
      setNewPassword("");
      setNewRepeat("");
    } catch (error) {
      setPasswordError(messageOf(error, "修改失败，请检查网络后重试"));
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
    setNote(null);
    try {
      await lock.resetPassword(resetPasswordValue);
      setNote("已重置隐私密码；内容密钥没有变，已加密的内容都还在。");
      setResetPasswordValue("");
      setResetRepeat("");
    } catch (error) {
      setResetError(messageOf(error, "重置失败，请检查网络后重试"));
    }
  }

  async function submitDisable(): Promise<void> {
    setDisableError(null);
    setNote(null);
    try {
      await lock.disable();
      setNote("隐私锁已关闭；加密空间与单篇标记都已在关闭前清空。");
    } catch (error) {
      setDisableError(messageOf(error, "关闭失败，请稍后重试"));
    }
  }

  return (
    <>
      <section className="setcard" aria-label="隐私锁状态">
        <h3 className="setcard__title">隐私锁</h3>
        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">
              {lock.enabled
                ? `已启用（当前${lock.lockState === "unlocked" ? "已解锁" : "已锁定"}）`
                : "未启用"}
            </span>
            <span className="setrow__desc">
              {lock.enabled
                ? "隐私范围里的内容在锁定状态下不显示；解锁用隐私密码。"
                : "启用后可以给单篇笔记加密，或把内容放进加密空间。"}
            </span>
            {disableError ? (
              <span className="field__error" role="alert">
                {disableError}
              </span>
            ) : null}
          </div>
          {lock.enabled ? (
            <Button size="sm" variant="danger" disabled={lock.busy} onClick={() => void submitDisable()}>
              关闭隐私锁
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => setEnableOpen(true)}>
              启用隐私锁
            </Button>
          )}
        </div>

        {enableOpen && !lock.enabled ? (
          <>
            <PasswordRow
              name="设置隐私密码"
              desc="只用于本机校验，不会上传；忘记后可用实例的备份凭据重置"
              autoComplete="new-password"
              value={enablePassword}
              onChange={setEnablePassword}
              error={enableError}
            />
            <PasswordRow
              name="再输入一次"
              autoComplete="new-password"
              value={enableRepeat}
              onChange={setEnableRepeat}
            />
            <div className="setrow">
              <div className="setrow__label">
                <span className="setrow__desc">启用需要联网（材料要写进服务端）</span>
                <button type="button" className="link" onClick={() => setEnableOpen(false)}>
                  取消
                </button>
              </div>
              <Button size="sm" variant="primary" disabled={lock.busy} onClick={() => void submitEnable()}>
                启用
              </Button>
            </div>
          </>
        ) : null}
      </section>

      <section className="setcard" aria-label="解锁档位">
        <h3 className="setcard__title">解锁档位</h3>
        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">默认解锁时长</span>
            <span className="setrow__desc">每次解锁时还可以在顶栏胶囊里临时改档</span>
          </div>
          <div className="radioset" role="group" aria-label="默认解锁时长">
            {PRIVACY_TIERS.map((option) => (
              <button
                key={option}
                type="button"
                className="radioset__item"
                aria-pressed={settings.tier === option}
                title={TIER_HINT[option]}
                onClick={() => patchPrivacy({ tier: option })}
              >
                {TIER_LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">「N 分钟」档的时长</span>
            <span className="setrow__desc">只影响「N 分钟」这一档</span>
          </div>
          <div className="radioset" role="group" aria-label="「N 分钟」档的时长">
            {PRIVACY_MINUTES_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className="radioset__item"
                aria-pressed={settings.minutes === option}
                onClick={() => patchPrivacy({ minutes: option })}
              >
                {option} 分钟
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="setcard" aria-label="隐私范围">
        <h3 className="setcard__title">范围与搜索</h3>
        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">Memo 也受隐私锁保护</span>
            <span className="setrow__desc">开启后，锁定时 Memo 与待办整屏以「已锁定」占位</span>
          </div>
          <button
            type="button"
            role="switch"
            className="toggle"
            aria-checked={settings.scope.memo}
            aria-label="Memo 也受隐私锁保护"
            onClick={() => patchPrivacy({ scope: { memo: !settings.scope.memo } })}
          />
        </div>

        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">解锁期间可搜索正文</span>
            <span className="setrow__desc">关闭后，即使解锁也只按标题与标签命中</span>
          </div>
          <button
            type="button"
            role="switch"
            className="toggle"
            aria-checked={settings.search_bodies_when_unlocked}
            aria-label="解锁期间可搜索正文"
            onClick={() =>
              patchPrivacy({
                search_bodies_when_unlocked: !settings.search_bodies_when_unlocked,
              })
            }
          />
        </div>
      </section>

      {lock.enabled ? (
        <section className="setcard" aria-label="隐私密码">
          <h3 className="setcard__title">隐私密码</h3>
          <p className="setrow__desc">修改与重置都需要联网（门禁材料在服务端）。</p>

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
            <div className="setrow__label">
              <span className="setrow__desc">内容密钥不变，改密不会动已加密的内容</span>
            </div>
            <Button size="sm" disabled={lock.busy} onClick={() => void submitChange()}>
              修改密码
            </Button>
          </div>

          <div className="setrow">
            <div className="setrow__label">
              <span className="setrow__name">忘记隐私密码</span>
              <span className="setrow__desc">
                重置只需要设置新密码：内容密钥不变，已加密的内容不会丢，也不会重新加密一遍
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
            <div className="setrow__label">
              <span className="setrow__desc">重置需要实例配置好备份凭据；没配好会明确报错</span>
            </div>
            <Button size="sm" disabled={lock.busy} onClick={() => void submitReset()}>
              重置隐私密码
            </Button>
          </div>

          {note ? (
            <p className="setrow__desc" role="status">
              {note}
            </p>
          ) : null}
        </section>
      ) : null}

      {!lock.enabled && note ? (
        <p className="setrow__desc" role="status">
          {note}
        </p>
      ) : null}
    </>
  );
}

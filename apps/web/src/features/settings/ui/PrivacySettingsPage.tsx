/**
 * 设置页「隐私锁」分类（M3-9；**界面稿 §四的六张卡，顺序即操作顺序**、设计 §7）。
 *
 * ① **状态**（未启用＝用途 + 主按钮「启用隐私锁」；已启用＝状态文字 + 「立即锁定」）
 * ② **隐私密码**（修改 / 忘记后重置）—— 拆到 `privacy/PrivacyPasswordCard.tsx`
 * ③ **解锁档位**（三档 + N 分钟）
 * ④ **隐私范围**（加密空间只读行 + Memo 开关 + 预留扩展位）
 * ⑤ **搜索**（解锁时是否按正文命中，独立成卡）
 * ⑥ **关闭隐私锁**（独立危险区卡片）
 *
 * 四条纪律：
 * 1. **未启用时只显示 ①**（界面稿 §四：没启用就没有密码、档位、范围可言）；
 * 2. **离线时**「启用 / 修改 / 重置 / 关闭」四个入口置灰并**可见地**说明"需要联网"
 *    （档位 / 范围 / 搜索是本地设置，离线照样能改）；
 * 3. 破坏性动作（关闭 / 重置）走 `ConfirmDialog` 二次确认，文案写清影响范围与能否恢复；
 * 4. 错误、校验、实时状态**必须可见**（`DESIGN.md` §5.4-2），不收进 `InfoHint`。
 *
 * 版式只用既有类：`.setcard` / `.setrow` / `.radioset` / `.toggle` / `.field__input` / `.field__error`。
 */
import { useState } from "react";
import { PRIVACY_MINUTES_OPTIONS, type PrivacySettings } from "@menote/shared";
import { Button } from "../../../app/ui/Controls";
import { ConfirmDialog } from "../../../app/ui/ConfirmDialog";
import { InfoHint } from "../../../app/ui/InfoHint";
import { PRIVACY_TIERS, TIER_LABELS, type PrivacyTier } from "../../privacy/model";
import { messageOf } from "./privacy/helpers";
import { PasswordRow } from "./privacy/PasswordRow";
import { PrivacyPasswordCard } from "./privacy/PrivacyPasswordCard";

/** 组装层里这块页面用到的部分（其余动作与本页无关） */
export interface PrivacyLockActions {
  enabled: boolean;
  busy: boolean;
  lockState: "disabled" | "locked" | "unlocked";
  /** 「立即锁定」（界面稿 §四①）：锁上全部已解锁内容 */
  lockAll: () => void;
  enable: (password: string) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<boolean>;
  resetPassword: (newPassword: string) => Promise<void>;
  disable: () => Promise<void>;
}

export interface PrivacySettingsPageProps {
  lock: PrivacyLockActions;
  settings: PrivacySettings;
  onPatchSettings: (partial: { privacy: PrivacySettings }) => void;
  /**
   * 离线（由 `App` 用既有的同步状态传入：引擎在 `navigator.onLine === false` 时报 offline）。
   * **不自己发明全局状态**；缺省 `false`（组件本身不知道网络）。
   */
  offline?: boolean;
}

const TIER_HINT: Record<PrivacyTier, string> = {
  minutes: "解锁后过一段时间自动锁上（默认档）",
  session: "关掉所有 Menote 标签页就锁上",
  device: "这台设备一直开着，直到手动锁定（公用电脑不要选）",
};

export function PrivacySettingsPage({
  lock,
  settings,
  onPatchSettings,
  offline = false,
}: PrivacySettingsPageProps) {
  const [enableOpen, setEnableOpen] = useState(false);
  const [enablePassword, setEnablePassword] = useState("");
  const [enableRepeat, setEnableRepeat] = useState("");
  const [enableError, setEnableError] = useState<string | null>(null);
  const [disableError, setDisableError] = useState<string | null>(null);
  /** 关闭隐私锁的二次确认（重置那处在密码卡里） */
  const [confirmDisable, setConfirmDisable] = useState(false);
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

  const locked = lock.lockState === "locked";

  return (
    <>
      {/* ① 状态 */}
      <section className="setcard" aria-label="隐私锁状态">
        <h3 className="setcard__title">隐私锁</h3>
        <div className="setrow">
          <div className="setrow__label">
            <span className="setrow__name">
              {lock.enabled ? `已启用（当前${locked ? "已锁定" : "已解锁"}）` : "未启用"}
            </span>
            <span className="setrow__desc">
              {lock.enabled
                ? "隐私范围里的内容在锁定状态下不显示；解锁用隐私密码。"
                : "启用后可以给单篇笔记加密，或把内容放进加密空间。"}
            </span>
            {/* 离线时的前置条件**平铺可见**（入口已置灰，不能只靠 title 说明原因） */}
            {offline && !lock.enabled ? (
              <span className="field__error" role="status">
                离线：启用需要联网（门禁材料要写进服务端）
              </span>
            ) : null}
          </div>
          {lock.enabled ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={locked}
              title={locked ? "当前已经是锁定状态" : "立即锁上全部已解锁内容"}
              onClick={() => lock.lockAll()}
            >
              立即锁定
            </Button>
          ) : enableOpen ? null : (
            /*
              展开启用表时**收起这个入口**：否则卡片里会同时出现「启用隐私锁」与表单里的「启用」
              两个实心主色按钮（DESIGN.md §5.1【禁止】同一区域两个并列主色按钮）。
            */
            <Button
              size="sm"
              variant="primary"
              disabled={offline}
              title={offline ? "启用需要联网：门禁材料要写进服务端" : undefined}
              onClick={() => setEnableOpen(true)}
            >
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
                {/*
                  前置条件：离线时**可见**地说明（按钮也置灰），在线时收进 InfoHint。
                */}
                {offline ? (
                  <span className="field__error" role="status">
                    离线：启用需要联网（门禁材料要写进服务端）
                  </span>
                ) : (
                  <InfoHint label="启用需要联网的说明">
                    启用会把门禁材料写进服务端，所以需要联网；档位、范围与搜索这些偏好是本地设置，
                    离线也能改。
                  </InfoHint>
                )}
                <button type="button" className="link" onClick={() => setEnableOpen(false)}>
                  取消
                </button>
              </div>
              <Button
                size="sm"
                variant="primary"
                disabled={lock.busy || offline}
                title={offline ? "启用需要联网" : undefined}
                onClick={() => void submitEnable()}
              >
                启用
              </Button>
            </div>
          </>
        ) : null}
      </section>

      {/* ②③④⑤⑥ 只在已启用时出现（界面稿 §四：未启用只显示 ①） */}
      {lock.enabled ? (
        <>
          <PrivacyPasswordCard
            busy={lock.busy}
            changePassword={lock.changePassword}
            resetPassword={lock.resetPassword}
            offline={offline}
            onNote={setNote}
          />

          {/* ③ 解锁档位 */}
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

          {/* ④ 隐私范围 */}
          <section className="setcard" aria-label="隐私范围">
            <h3 className="setcard__title">隐私范围</h3>
            {/* 只读行：加密空间恒在范围内（M3 界面稿 §四④）。禁用原因**写在可见文案里**，不靠悬停 */}
            <div className="setrow">
              <div className="setrow__label">
                <span className="setrow__name">加密空间</span>
                <span className="setrow__desc">始终在隐私范围内，不可关闭</span>
              </div>
              <button
                type="button"
                role="switch"
                className="toggle"
                aria-checked
                aria-label="加密空间始终在隐私范围内"
                disabled
                title="加密空间是隐私锁的核心范围，不能关掉"
              />
            </div>

            <div className="setrow">
              <div className="setrow__label">
                <span className="setrow__name">Memo 也受隐私锁保护</span>
                <span className="setrow__desc">锁定时 Memo 与待办整屏以「已锁定」占位</span>
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

            {/* 预留扩展位：以后新增的内容类型会在这里加开关（M3 界面稿 §四④） */}
            <div className="setrow">
              <div className="setrow__label">
                <span className="setrow__desc">预留扩展位：接入新的内容类型时，会在这里加开关。</span>
              </div>
            </div>
          </section>

          {/* ⑤ 搜索（独立成卡：只管"解锁后按不按正文命中"） */}
          <section className="setcard" aria-label="隐私与搜索">
            <h3 className="setcard__title">
              搜索
              <InfoHint label="搜索范围说明">
                只作用于正文：关闭后，即使已解锁也只按标题与标签命中；不改变锁定状态下"什么都不命中"
                这条规则。
              </InfoHint>
            </h3>
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

          {/* ⑥ 关闭隐私锁：独立危险区卡片 */}
          <section className="setcard" aria-label="关闭隐私锁">
            <h3 className="setcard__title">关闭隐私锁</h3>
            <div className="setrow">
              <div className="setrow__label">
                <span className="setrow__name">关闭后不再保护任何内容</span>
                <span className="setrow__desc">
                  加密空间与单篇加密会先被清空；还有隐私内容时服务端会拒绝并说明原因。
                </span>
                {/* 服务端拒绝的原因必须可见（DESIGN.md §5.4-2） */}
                {disableError ? (
                  <span className="field__error" role="alert">
                    {disableError}
                  </span>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="danger"
                disabled={lock.busy || offline}
                title={offline ? "关闭隐私锁需要联网" : undefined}
                onClick={() => setConfirmDisable(true)}
              >
                关闭隐私锁
              </Button>
            </div>
          </section>
        </>
      ) : null}

      {/* 成功提示只留一处（role=status）：无论启用与否都读得到 */}
      {note ? (
        <p className="setrow__desc" role="status">
          {note}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmDisable}
        title="关闭隐私锁"
        desc="关闭后，加密空间与单篇加密的内容会重新可见，单篇加密的标记也会取消。"
        confirmLabel="确认关闭"
        onClose={() => setConfirmDisable(false)}
        onConfirm={() => {
          setConfirmDisable(false);
          void submitDisable();
        }}
      >
        <p>已经加密的内容不会丢失，但不再受隐私锁保护；重新启用需要再设一次隐私密码。</p>
      </ConfirmDialog>
    </>
  );
}

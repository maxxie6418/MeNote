/**
 * 设置页在组合根里的接线（M2-7 建；M3-9 从 `App.tsx` 抽出，为入口文件的行数预算让位）。
 *
 * 抽出来的另一个好处：**实例级注册开关**（只有 owner 能读）与它的两个状态/副作用一起搬进来，
 * `App` 不必再为"某个分类页要不要注册开关"持有状态。
 *
 * 隐私锁分类的内容（`privacyPage`）由调用方组装后传进来：设置页负责分类与版式，
 * 隐私锁的状态机在 `features/privacy`，两边互不认识。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { RegistrationState, UserSettings } from "@menote/shared";
import { adminApi } from "../data/api/endpoints";
import { SettingsPanel } from "../features/settings/ui/SettingsPanel";
import type { ThemeMode } from "./theme/useTheme";
import type { SettingsPageId } from "./router";
import { pushToast } from "./ui/Toast";

export interface SettingsViewProps {
  page: SettingsPageId;
  onNavigate: (page: SettingsPageId) => void;
  role: "owner" | "member";
  themeMode: ThemeMode;
  onThemeMode: (mode: ThemeMode) => void;
  userSettings: UserSettings;
  onPatchSettings: (partial: Partial<UserSettings>) => void;
  /** 已绑定当前用户名：改的是登录密码（与隐私密码无关） */
  onChangeLoginPassword: (current: string, next: string) => Promise<string>;
  onLogout: () => void;
  privacyPage?: ReactNode;
  /** 「版本与回收站」分类的内容（M4-11）：策略设置 + 回收站入口 */
  versionsPage?: ReactNode;
  /** 返回笔记区（设置是独立页，需要有出口） */
  onBackToNotes?: () => void;
}

export function SettingsView({
  page,
  onNavigate,
  role,
  themeMode,
  onThemeMode,
  userSettings,
  onPatchSettings,
  onChangeLoginPassword,
  onLogout,
  privacyPage,
  versionsPage,
  onBackToNotes,
}: SettingsViewProps) {
  const [registration, setRegistration] = useState<RegistrationState | null>(null);

  // 进入「实例」分类时读实例级注册开关（仅 owner 有权限；失败就当作读不到）
  useEffect(() => {
    if (page !== "instance" || role !== "owner") return;
    void adminApi
      .getRegistration()
      .then(setRegistration)
      .catch(() => setRegistration(null));
  }, [page, role]);

  /**
   * 改注册开关（`功能拆解` M19-02：开关含**到期自动关闭**）。
   * `closeAt = 0` 表示不自动到期——清空日期时必须显式传 0：接口按 `closeAt === undefined`
   * 判断"这次不更新 close_at"，传 undefined 会清不掉原来的到期时间。
   */
  const changeRegistration = useCallback(async (open: boolean, closeAt: number) => {
    const next = await adminApi.setRegistration(open, closeAt);
    setRegistration(next);
    if (!open) pushToast("已关闭注册", "success");
    else pushToast(closeAt > 0 ? "已开放注册（到期自动关闭）" : "已开放注册", "success");
  }, []);

  return (
    <SettingsPanel
      page={page}
      onNavigate={onNavigate}
      role={role}
      themeMode={themeMode}
      onThemeMode={onThemeMode}
      userSettings={userSettings}
      onPatchSettings={onPatchSettings}
      registrationOpen={registration?.open ?? false}
      registrationCloseAt={registration?.close_at ?? 0}
      onChangeRegistration={changeRegistration}
      onChangePassword={async (current, next) => {
        pushToast(await onChangeLoginPassword(current, next), "success");
      }}
      onLogout={onLogout}
      privacyPage={privacyPage}
      versionsPage={versionsPage}
      onBackToNotes={onBackToNotes}
    />
  );
}

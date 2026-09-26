/**
 * 设置（结构见 `docs/modules/Menote-M1-界面稿-v1.md` §六；DESIGN.md §2.7：左列分类导航与右侧内容各自滚动）。
 *
 * M1 只放 3 个分类（通用 / 账户与安全 / 实例管理），其余分类在 M2/M6 补内容后再进导航——避免空入口。
 * 「实例管理」仅 owner 可见。
 */
import { useState, type FormEvent } from "react";
import { Button, Field } from "../../../app/ui/Controls";
import type { ThemeMode } from "../../../app/theme/useTheme";
import type { SettingsPageId } from "../../../app/router";

const PAGE_META: Record<SettingsPageId, { title: string; summary: string }> = {
  general: { title: "通用", summary: "启动视图、主题等通用偏好" },
  account: { title: "账户与安全", summary: "登录密码与会话" },
  instance: { title: "实例管理", summary: "本实例的注册开关与用量（仅管理员）" },
};

const NAV_ORDER: readonly SettingsPageId[] = ["general", "account", "instance"];

const THEME_OPTIONS: ReadonlyArray<{ id: ThemeMode; label: string; desc: string }> = [
  { id: "light", label: "浅色", desc: "默认" },
  { id: "dark", label: "深色", desc: "深色下单独核对语义色" },
  { id: "system", label: "跟随系统", desc: "随系统主题变化" },
];

export interface SettingsPanelProps {
  page: SettingsPageId;
  onNavigate: (page: SettingsPageId) => void;
  role: "owner" | "member";
  themeMode: ThemeMode;
  onThemeMode: (mode: ThemeMode) => void;
  registrationOpen: boolean;
  onToggleRegistration: (open: boolean) => Promise<void>;
  onChangePassword: (current: string, next: string) => Promise<void>;
  onLogout: () => void;
}

export function SettingsPanel({
  page,
  onNavigate,
  role,
  themeMode,
  onThemeMode,
  registrationOpen,
  onToggleRegistration,
  onChangePassword,
  onLogout,
}: SettingsPanelProps) {
  const pages = NAV_ORDER.filter((candidate) => candidate !== "instance" || role === "owner");
  const meta = PAGE_META[page];

  return (
    <div className="settings">
      <nav className="settings__nav" aria-label="设置分类">
        <div className="nav">
          {pages.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="nav-item"
              aria-current={candidate === page}
              onClick={() => onNavigate(candidate)}
            >
              {PAGE_META[candidate].title}
            </button>
          ))}
        </div>
      </nav>

      <div className="settings__body">
        <header className="settings__head">
          <h2>{meta.title}</h2>
          <p>
            {meta.summary} · 共 {pages.length} 个分类
          </p>
        </header>

        {page === "general" ? (
          <section className="setcard" aria-label="界面偏好">
            <h3 className="setcard__title">界面偏好</h3>
            <div className="setrow">
              <div className="setrow__label">
                <span className="setrow__name">主题</span>
                <span className="setrow__desc">切换只改主题属性，不整页重渲染</span>
              </div>
              <div className="radioset" role="group" aria-label="主题">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="radioset__item"
                    aria-pressed={themeMode === option.id}
                    title={option.desc}
                    onClick={() => onThemeMode(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="setrow">
              <div className="setrow__label">
                <span className="setrow__name">启动视图</span>
                <span className="setrow__desc">首页 / 最近编辑 / 收藏将在 M2 提供</span>
              </div>
              <span className="setrow__desc">M2</span>
            </div>
          </section>
        ) : null}

        {page === "account" ? (
          <AccountPage onChangePassword={onChangePassword} onLogout={onLogout} />
        ) : null}

        {page === "instance" ? (
          <section className="setcard" aria-label="实例管理">
            <h3 className="setcard__title">注册开关</h3>
            <div className="setrow">
              <div className="setrow__label">
                <span className="setrow__name">允许新用户注册</span>
                <span className="setrow__desc">
                  关闭后登录页不再显示注册入口；已登录用户不受影响
                </span>
              </div>
              <button
                type="button"
                role="switch"
                className="toggle"
                aria-checked={registrationOpen}
                aria-label="允许新用户注册"
                onClick={() => void onToggleRegistration(!registrationOpen)}
              />
            </div>
            <div className="setrow">
              <div className="setrow__label">
                <span className="setrow__name">成员账户管理</span>
                <span className="setrow__desc">将在 M6 提供</span>
              </div>
              <span className="setrow__desc">M6</span>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function AccountPage({
  onChangePassword,
  onLogout,
}: {
  onChangePassword: (current: string, next: string) => Promise<void>;
  onLogout: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const mismatch = repeat !== "" && repeat !== next;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (next !== repeat) {
      setError("两次输入的新密码不一致");
      return;
    }

    setError(null);
    setDone(false);
    setBusy(true);
    try {
      await onChangePassword(current, next);
      setDone(true);
      setCurrent("");
      setNext("");
      setRepeat("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "修改失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="setcard" aria-label="账户与安全">
      <h3 className="setcard__title">修改登录密码</h3>
      <form className="authcard__form" onSubmit={submit} noValidate>
        <Field
          label="当前登录密码"
          type="password"
          value={current}
          autoComplete="current-password"
          onChange={(event) => setCurrent(event.target.value)}
        />
        <Field
          label="新登录密码"
          type="password"
          value={next}
          autoComplete="new-password"
          onChange={(event) => setNext(event.target.value)}
        />
        <Field
          label="再输一次新密码"
          type="password"
          value={repeat}
          autoComplete="new-password"
          error={mismatch ? "两次输入的新密码不一致" : undefined}
          onChange={(event) => setRepeat(event.target.value)}
        />

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        {done ? <p className="authcard__hint">登录密码已修改；其他设备的登录已失效。</p> : null}

        <Button
          variant="primary"
          type="submit"
          disabled={busy || current === "" || next === "" || mismatch}
        >
          {busy ? "提交中…" : "修改登录密码"}
        </Button>
      </form>

      <div className="setrow" style={{ marginTop: "var(--sp-4)" }}>
        <div className="setrow__label">
          <span className="setrow__name">退出登录</span>
          <span className="setrow__desc">只清除本机会话；本机缓存的笔记不会被删除</span>
        </div>
        <Button variant="danger" size="sm" onClick={onLogout}>
          退出登录
        </Button>
      </div>
    </section>
  );
}

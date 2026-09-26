/**
 * 设置（结构见 `docs/modules/Menote-M1-界面稿-v1.md` §六；DESIGN.md §2.7：左列分类导航与右侧内容各自滚动）。
 *
 * M1 只放 3 个分类（通用 / 账户与安全 / 实例管理），其余分类在 M2/M6 补内容后再进导航——避免空入口。
 * 「实例管理」仅 owner 可见。
 */
import { useState, type FormEvent } from "react";
import type { EditorMode, StartView, UserSettings } from "@menote/shared";
import { Button, Field } from "../../../app/ui/Controls";
import type { ThemeMode } from "../../../app/theme/useTheme";
import type { SettingsPageId } from "../../../app/router";
import { CardQuickMenu } from "./CardQuickMenu";

const PAGE_META: Record<SettingsPageId, { title: string; summary: string }> = {
  general: { title: "通用", summary: "启动视图、时区、主题与快捷菜单" },
  account: { title: "账户与安全", summary: "登录密码与会话" },
  editor: { title: "编辑器", summary: "默认编辑模式" },
  privacy: { title: "隐私锁", summary: "加密空间与门禁（M3 提供）" },
  versions: { title: "版本与回收站", summary: "版本历史与回收站（M4 提供）" },
  instance: { title: "实例管理", summary: "本实例的注册开关与用量（仅管理员）" },
};

/**
 * 导航顺序即需求 §7.5 的最终形态顺序，但**只列出本里程碑已实现的分类**（避免点进去空页面）：
 * 备份 / 分享 / MCP / 数据管理 等各自里程碑再进导航。
 */
const NAV_ORDER: readonly SettingsPageId[] = [
  "general",
  "account",
  "editor",
  "privacy",
  "versions",
  "instance",
];

/** 常用时区（第一版给常见几档 + 当前值；完整时区表等有需要再补） */
const TIMEZONE_OPTIONS = [
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

const START_VIEW_OPTIONS: ReadonlyArray<{ id: StartView; label: string }> = [
  { id: "home", label: "首页" },
  { id: "recent", label: "最近编辑" },
  { id: "starred", label: "收藏" },
];

const EDITOR_MODE_OPTIONS: ReadonlyArray<{ id: EditorMode; label: string; desc: string }> = [
  { id: "split", label: "双栏", desc: "左编辑右预览，默认" },
  { id: "edit", label: "仅编辑", desc: "只显示编辑区" },
  { id: "preview", label: "仅预览", desc: "只显示预览区" },
];

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
  /** 跟随账号同步的设置（M2-7）；主题不在其中（设备级偏好） */
  userSettings: UserSettings;
  onPatchSettings: (partial: Partial<UserSettings>) => void;
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
  userSettings,
  onPatchSettings,
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
          <>
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
                  <span className="setrow__desc">打开应用时先进哪个视图</span>
                </div>
                <div className="radioset" role="group" aria-label="启动视图">
                  {START_VIEW_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="radioset__item"
                      aria-pressed={userSettings.start_view === option.id}
                      onClick={() => onPatchSettings({ start_view: option.id })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="setrow">
                <div className="setrow__label">
                  <span className="setrow__name">时区</span>
                  <span className="setrow__desc">Memo 时间轴与待办日期按它分天</span>
                </div>
                <select
                  className="field__input"
                  aria-label="时区"
                  value={userSettings.timezone}
                  onChange={(event) => onPatchSettings({ timezone: event.target.value })}
                >
                  {[...new Set([userSettings.timezone, ...TIMEZONE_OPTIONS])].map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <CardQuickMenu
              selected={userSettings.quick_menu}
              onChange={(quickMenu) => onPatchSettings({ quick_menu: quickMenu })}
            />
          </>
        ) : null}

        {page === "editor" ? (
          <section className="setcard" aria-label="编辑器">
            <h3 className="setcard__title">默认编辑模式</h3>
            <div className="setrow">
              <div className="setrow__label">
                <span className="setrow__name">打开笔记时的模式</span>
                <span className="setrow__desc">随时可以在正文区手动切换</span>
              </div>
              <div className="radioset" role="group" aria-label="默认编辑模式">
                {EDITOR_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="radioset__item"
                    aria-pressed={userSettings.editor_mode === option.id}
                    title={option.desc}
                    onClick={() => onPatchSettings({ editor_mode: option.id })}
                  >
                    {option.label}
                  </button>
                ))}
                {/* 第四档「即时渲染」细则【后续定】，M2 置灰并说明原因（DESIGN.md §6.1） */}
                <button
                  type="button"
                  className="radioset__item"
                  disabled
                  title="「即时渲染」的细则还没定，M2 先不提供"
                >
                  即时渲染
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {page === "privacy" ? (
          <section className="setcard" aria-label="隐私锁">
            <h3 className="setcard__title">隐私锁</h3>
            <div className="setrow">
              <div className="setrow__label">
                <span className="setrow__name">加密空间</span>
                <span className="setrow__desc">
                  启用隐私锁、修改隐私密码、解锁档位与时长都在 M3 提供；M2 只做界面占位。
                </span>
              </div>
              <button
                type="button"
                className="btn btn--sm"
                disabled
                title="隐私锁将在 M3 提供"
              >
                启用
              </button>
            </div>
          </section>
        ) : null}

        {page === "versions" ? (
          <section className="setcard" aria-label="版本与回收站">
            <h3 className="setcard__title">版本与回收站</h3>
            <div className="setrow">
              <div className="setrow__label">
                <span className="setrow__name">回收站</span>
                <span className="setrow__desc">
                  封存间隔、保留策略与回收站本体在 M4 提供；删除的条目会在那时先入回收站。
                </span>
              </div>
              <button type="button" className="btn btn--sm" disabled title="回收站将在 M4 提供">
                打开回收站
              </button>
            </div>
          </section>
        ) : null}

        {page === "account" ? (
          <>
            <AccountPage onChangePassword={onChangePassword} onLogout={onLogout} />
            <section className="setcard" aria-label="登录设备与会话">
              <h3 className="setcard__title">登录设备与会话</h3>
              <div className="setrow">
                <div className="setrow__label">
                  <span className="setrow__name">已登录设备</span>
                  <span className="setrow__desc">
                    设备列表与"踢出其他设备"将在后续里程碑提供；当前改密码会使其他设备的会话立即失效。
                  </span>
                </div>
                <span className="setrow__desc">后续</span>
              </div>
            </section>
          </>
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

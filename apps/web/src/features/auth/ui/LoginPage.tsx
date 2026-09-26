/**
 * 登录页（拆解 M01-03；结构见 `docs/modules/Menote-M1-界面稿-v1.md` §一）。
 *
 * - 主操作只有「登录」一个；
 * - 用户名或密码错误时服务端返回统一文案，直接就地显示；
 * - 冷却/断网也走同一处就地提示（不弹窗，DESIGN.md 禁止项 #7）；
 * - 注册入口仅在**注册开关打开或库中还没有用户**时显示。
 */
import { useState, type FormEvent } from "react";
import { Button, Field } from "../../../app/ui/Controls";
import { authErrorMessage } from "../model";

export interface LoginPageProps {
  onLogin: (username: string, password: string) => Promise<unknown>;
  onGoRegister: () => void;
  showRegisterEntry: boolean;
  notice?: string | null;
}

export function LoginPage({ onLogin, onGoRegister, showRegisterEntry, notice }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;

    setError(null);
    setBusy(true);
    try {
      await onLogin(username.trim(), password);
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="authpage">
      <div className="authcard">
        <div className="authcard__brand">
          <span className="brandmark" aria-hidden="true" />
          Menote
        </div>

        <form className="authcard__form" onSubmit={submit} noValidate>
          <Field
            label="用户名"
            value={username}
            autoComplete="username"
            autoFocus
            onChange={(event) => setUsername(event.target.value)}
          />
          <Field
            label="登录密码"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />

          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}

          {notice ? <p className="authcard__hint">{notice}</p> : null}

          <Button
            variant="primary"
            type="submit"
            disabled={busy || username.trim() === "" || password === ""}
          >
            {busy ? "登录中…" : "登录"}
          </Button>
        </form>

        {showRegisterEntry ? (
          <Button variant="ghost" size="sm" onClick={onGoRegister}>
            还没有账号？注册
          </Button>
        ) : null}
      </div>
    </div>
  );
}

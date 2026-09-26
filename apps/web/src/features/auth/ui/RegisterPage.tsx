/**
 * 注册页（拆解 M01-01/02；结构见 `docs/modules/Menote-M1-界面稿-v1.md` §二）。
 *
 * - 库中无用户时（`firstUser`）显示"第一个注册的账号将成为管理员"；
 * - 两次密码不一致就地提示；
 * - 注册未开放时服务端返回 403，文案直接就地显示（不隐藏页面，用户能看到原因）。
 */
import { useState, type FormEvent } from "react";
import { Button, Field } from "../../../app/ui/Controls";
import { authErrorMessage } from "../model";

export interface RegisterPageProps {
  onRegister: (username: string, password: string) => Promise<unknown>;
  onGoLogin: () => void;
  firstUser: boolean;
}

export function RegisterPage({ onRegister, onGoLogin, firstUser }: RegisterPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = repeat !== "" && repeat !== password;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;

    if (password !== repeat) {
      setError("两次输入的密码不一致");
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await onRegister(username.trim(), password);
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

        {firstUser ? (
          <p className="authcard__hint">第一个注册的账号将成为管理员（owner）。</p>
        ) : null}

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
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
          />
          <Field
            label="再输一次登录密码"
            type="password"
            value={repeat}
            autoComplete="new-password"
            error={mismatch ? "两次输入的密码不一致" : undefined}
            onChange={(event) => setRepeat(event.target.value)}
          />

          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}

          <Button
            variant="primary"
            type="submit"
            disabled={busy || username.trim() === "" || password === "" || mismatch}
          >
            {busy ? "注册中…" : "注册"}
          </Button>
        </form>

        <Button variant="ghost" size="sm" onClick={onGoLogin}>
          已有账号？登录
        </Button>
      </div>
    </div>
  );
}

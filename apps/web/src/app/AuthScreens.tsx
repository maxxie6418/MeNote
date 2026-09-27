/**
 * 未登录时的两屏（M1 建；M3-5 从 `App.tsx` 抽出，为入口文件的行数预算让位）。
 *
 * 只做渲染：路由判断与 auth 动作都由 `App` 注入——这个组件不认识 `useAuth`，
 * 这样它既可以被单测直接渲染，也不会把认证状态机拖进界面层。
 */
import { LoginPage } from "../features/auth/ui/LoginPage";
import { RegisterPage } from "../features/auth/ui/RegisterPage";
import type { Route } from "./router";
import { IconSprite } from "./ui/Icon";
import { InsecureContextBanner } from "./ui/InsecureContextBanner";
import { ToastHost } from "./ui/Toast";

export interface AuthScreensProps {
  /** 当前路由（只用到 `login` / `register` 两种） */
  route: Route;
  hasUsers: boolean;
  registrationOpen: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
  onRegister: (username: string, password: string) => Promise<void>;
  onGoLogin: () => void;
  onGoRegister: () => void;
}

export function AuthScreens({
  route,
  hasUsers,
  registrationOpen,
  onLogin,
  onRegister,
  onGoLogin,
  onGoRegister,
}: AuthScreensProps) {
  return (
    <>
      <IconSprite />
      <InsecureContextBanner />
      {route.name === "register" ? (
        <RegisterPage firstUser={!hasUsers} onRegister={onRegister} onGoLogin={onGoLogin} />
      ) : (
        <LoginPage
          showRegisterEntry={registrationOpen || !hasUsers}
          onLogin={onLogin}
          onGoRegister={onGoRegister}
        />
      )}
      <ToastHost />
    </>
  );
}

/** 还在检查登录状态：也给一屏（带诊断横幅，避免"白屏没解释"） */
export function AuthLoading() {
  return (
    <>
      <IconSprite />
      <InsecureContextBanner />
      <div className="authpage">正在检查登录状态…</div>
    </>
  );
}

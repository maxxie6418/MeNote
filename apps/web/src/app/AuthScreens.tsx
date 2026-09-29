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
// 站点图标本体（与 favicon / 顶栏 / 登录注册页同一份文件）：那一屏要分别驱动「云」和「书」，
// 而 `<img>` 里的内容页面 CSS 够不着，所以按 `?raw` 内联原文——图形仍然只有这一份。
import logoMarkup from "../../public/icon.svg?raw";

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

/**
 * 还在检查登录状态：**把站点图标本体做成"云与书竖直微跳"的加载动画**（带诊断横幅，避免"白屏没解释"）。
 *
 * 三条口径（用户 2026-09-29 拍板）：
 * 1. **不写可见文字**：去掉原来那行"正在检查登录状态…"，屏上只留图形。但 `DESIGN.md` §5.5-4
 *    「图标不可作唯一表意手段」与 §6.1「禁止静默等待」的意图不能丢——状态文字用
 *    `.visually-hidden` 留在 DOM 里，读屏照常念得到，只是不占版面；
 * 2. **图形只有一份**：内联的正是 `public/icon.svg`（favicon / 顶栏 / 登录注册页同一个文件），
 *    `.mn-cloud` / `.mn-book` 两个分组由那份文件提供；不复制 path、不新建第二份插画。
 *    内联的是**构建期常量**（仓库内文件，不是用户输入），所以这里用 `dangerouslySetInnerHTML` 是安全的；
 * 3. 动效在 `DESIGN.md` §6.8 登记为**仅这一屏的例外**：云上移、书下移各约 3px、1.8s 往返、不旋转；
 *    `prefers-reduced-motion` 由全局块兜住（动画停住，只剩静态 logo）。
 *
 * 这一屏只渲染装饰图形与状态文字，所以不再需要图标 sprite（`IconSprite` 已从这里移除；
 * 上面的登录 / 注册两屏照旧带它）。
 */
export function AuthLoading() {
  return (
    <>
      <InsecureContextBanner />
      <div className="authpage">
        <div className="authloading" role="status">
          {/* 装饰性插画：语义由下面那行状态文字承担，所以整块对辅助技术隐藏 */}
          <div
            className="authloading__logo"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: logoMarkup }}
          />
          <span className="visually-hidden">正在检查登录状态…</span>
        </div>
      </div>
    </>
  );
}

/**
 * 会话鉴权中间件（架构 §2.3.2：`middleware/session.ts`）。
 *
 * 1 次 SHA-256 + 1 次 D1 读（§14.2 的预算）；跨天时多 1 次写（滑动续期）。
 */
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "@menote/shared";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { DomainError } from "../errors";
import { resolveSession } from "../services/sessions";
import type { AppEnv } from "../types";

/**
 * `Secure` 只在 https 下开：生产（Workers）恒为 https；本地 Vite dev 是 `http://localhost`，
 * 强制 `Secure` 会被浏览器丢弃 Cookie（设计稿《认证与会话设计》§4 的 dev 注意事项）。
 */
function isSecureRequest(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === "https:";
}

export function setSessionCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: isSecureRequest(c),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/", secure: isSecureRequest(c) });
}

/** 需要登录的路由挂它；成功后 `c.get("user")` / `c.get("tokenHash")` 可用 */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) throw new DomainError("unauthenticated", "请先登录");

  const session = await resolveSession(c.env.DB, token, Date.now());
  if (!session) {
    clearSessionCookie(c);
    throw new DomainError("unauthenticated", "登录已过期，请重新登录");
  }

  c.set("user", session.user);
  c.set("tokenHash", session.tokenHash);
  await next();
});

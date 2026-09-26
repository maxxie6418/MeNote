/**
 * API 响应的安全头（架构 §13.2 的"其他响应头"）。
 *
 * 静态资源的安全头由 `apps/web/public/_headers` 下发（M0 已有，含 CSP），但那只覆盖由
 * Static Assets 返回的资源；**Worker 的 `/api/*` 响应不带**，这里补最小的两项：
 * `nosniff` 防止内容类型嗅探，`Referrer-Policy` 与前端保持一致。
 * 对 JSON / 纯文本响应，CSP 意义不大，故不在这里加。
 */
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

/** 设置安全头；成功响应与错误响应都调用它（错误响应不走中间件后置逻辑） */
export function applySecurityHeaders(c: Context<AppEnv>): void {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
}

export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  try {
    await next();
  } finally {
    applySecurityHeaders(c);
  }
});

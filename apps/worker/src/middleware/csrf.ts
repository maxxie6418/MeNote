/**
 * CSRF 守卫（架构 §13.2）。
 *
 * 两层：
 * 1. **主防线**：所有非安全方法必须带 `X-Menote: 1`。跨站表单无法自定义请求头，跨站 fetch
 *    带自定义头会先触发 CORS 预检，而本服务不返回 CORS 放行头，因此这一层就足以拦住 CSRF。
 * 2. **次防线**：`Origin` 在场时必须与请求自身的 origin 一致。**Origin 缺失时放行**——
 *    浏览器发起的跨站写请求一定带 Origin，缺失只可能是非浏览器客户端（无 Cookie，不构成 CSRF），
 *    而本地 Vite dev 场景下严格校验反而会拦掉正常的同源写请求。
 *
 * 不硬编码域名：期望值取自请求 URL（架构 §15.5）。
 */
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from "@menote/shared";
import { createMiddleware } from "hono/factory";
import { DomainError } from "../errors";
import type { AppEnv } from "../types";

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

export const csrfGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  if (c.req.header(CSRF_HEADER_NAME) !== CSRF_HEADER_VALUE) {
    throw new DomainError("csrf", "缺少 CSRF 标记");
  }

  const origin = c.req.header("Origin");
  if (origin !== undefined && origin !== new URL(c.req.url).origin) {
    throw new DomainError("csrf", "请求来源校验失败");
  }

  await next();
});

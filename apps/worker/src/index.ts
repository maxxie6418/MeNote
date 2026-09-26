// 唯一 Worker 入口（架构 §2.3.1）：只做装配——创建 Hono、挂中间件与子路由、导出
// fetch/scheduled，并把领域错误转成统一错误体。业务代码一律在 routes/ 与 services/。
import { apiErrorBody } from "@menote/shared";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { DomainError } from "./errors";
import { configGuard } from "./middleware/config-guard";
import { csrfGuard } from "./middleware/csrf";
import { schemaGuard } from "./middleware/schema";
import { applySecurityHeaders, securityHeaders } from "./middleware/security-headers";
import auth from "./routes/auth";
import folders from "./routes/folders";
import health from "./routes/health";
import items from "./routes/items";
import settings from "./routes/settings";
import sync from "./routes/sync";
import type { AppEnv, EnvBindings } from "./types";

const app = new Hono<AppEnv>();

// 中间件顺序即处理顺序：安全头 → 表结构就绪（§15.4）→ CSRF（§13.2）→ 必备机密存在性
app.use("/api/*", securityHeaders);
app.use("/api/*", schemaGuard);
app.use("/api/*", csrfGuard);
/**
 * 只有**真正要用 AUTH_PEPPER** 的端点在缺少机密时 fail-closed（绝不用空密钥算 HMAC）：
 * prelogin 要用它派生假盐，login/register/password 要用它算校验值。
 *
 * 刻意**不拦**这些：`/api/auth/registration-state`（只读两个布尔量，不做 HMAC）、
 * `/api/auth/me`、`/api/auth/logout`（会话令牌是 SHA-256，不用机密）、`/api/admin/*`（要有 owner 会话才进得来）。
 * 否则首次部署忘配机密时，前端连"库中没有用户"都读不到，会停在登录页且没有注册入口——
 * 用户只能看到一句 503，连该做什么都不清楚。
 */
app.use("/api/auth/prelogin", configGuard);
app.use("/api/auth/login", configGuard);
app.use("/api/auth/register", configGuard);
app.use("/api/auth/password", configGuard);

app.route("/api", health);
app.route("/api", auth);
app.route("/api", items);
app.route("/api", folders);
app.route("/api", sync);
app.route("/api", settings);

app.notFound((c) => {
  applySecurityHeaders(c);
  return c.json(apiErrorBody("not_found", "资源不存在"), 404);
});

app.onError((err, c) => {
  applySecurityHeaders(c);
  if (err instanceof DomainError) {
    return c.json(
      apiErrorBody(err.code, err.message, err.detail),
      err.status as ContentfulStatusCode,
    );
  }
  console.error("unhandled error:", err);
  return c.json(apiErrorBody("retry_later", "服务暂时不可用"), 503);
});

export default {
  fetch: app.fetch,
  // Cron 分派器自 M4 起接入（架构 §12.1）；M0-M1 为空壳占位
  scheduled: () => {},
} satisfies ExportedHandler<EnvBindings>;

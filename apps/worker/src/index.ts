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
// 需要 AUTH_PEPPER 的接口：缺失时 fail-closed（不用空密钥算 HMAC）
app.use("/api/auth/*", configGuard);
app.use("/api/admin/*", configGuard);

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

// 唯一 Worker 入口（架构 §2.3.1）：只做装配——创建 Hono、挂载子路由、导出
// fetch/scheduled。业务代码一律在 routes/ 与 services/，入口超 100 行即结构违规。
import { Hono } from "hono";
import { apiErrorBody } from "@menote/shared";
import { schemaGuard } from "./middleware/schema";
import health from "./routes/health";
import type { EnvBindings } from "./types";

const app = new Hono<{ Bindings: EnvBindings }>();

// 表结构就绪守卫（架构 §15.4）：只装配，判定逻辑在 middleware/schema.ts
app.use("/api/*", schemaGuard);

app.route("/api", health);

app.notFound((c) => c.json(apiErrorBody("not_found", "资源不存在"), 404));

app.onError((err, c) => {
  console.error("unhandled error:", err);
  return c.json(apiErrorBody("retry_later", "服务暂时不可用"), 503);
});

export default {
  fetch: app.fetch,
  // Cron 分派器自 M4 起接入（架构 §12.1）；M0 为空壳占位
  scheduled: () => {},
} satisfies ExportedHandler<EnvBindings>;

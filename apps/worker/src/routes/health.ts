import { Hono } from "hono";
import { APP_NAME, type HealthResponse } from "@menote/shared";
import type { EnvBindings } from "../types";

const app = new Hono<{ Bindings: EnvBindings }>();

// M0 冒烟端点：验证部署链路（静态资源托管 + Worker API + D1 绑定就绪）
app.get("/health", (c) => {
  const body: HealthResponse = {
    ok: true,
    app: APP_NAME,
    time: new Date().toISOString(),
  };
  return c.json(body);
});

export default app;

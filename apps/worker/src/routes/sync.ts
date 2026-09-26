/**
 * 增量同步路由（架构 §2.3.2：`routes/sync.ts`）。只解析游标并转服务层。
 */
import type { SyncResponse } from "@menote/shared";
import { Hono } from "hono";
import { DomainError } from "../errors";
import { requireSession } from "../middleware/session";
import { pullSync } from "../services/sync";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

app.get("/sync", requireSession, async (c) => {
  const raw = c.req.query("cursor") ?? "0";
  const cursor = Number.parseInt(raw, 10);
  if (!Number.isInteger(cursor) || cursor < 0) {
    throw new DomainError("invalid", "游标不合法");
  }

  const body: SyncResponse = await pullSync(c.env.DB, c.get("user").id, cursor);
  return c.json(body);
});

export default app;

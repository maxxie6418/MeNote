/**
 * MCP 令牌管理的路由（M6 批 1；设计 §3.4）。
 *
 * 四个接口**全部走会话**（`requireSession`）：与 `routes/shares.ts` 同一套——管理令牌是
 * 用户在自己账号里做的事，MCP 协议那侧（`routes/mcp.ts`）是另一条路，两者不共享中间件。
 * 挂在 `/api/mcp/tokens` 下，于是 `index.ts` 的 `app.use("/api/*")` 自动给它盖上
 * 安全头、schema 自愈与 CSRF 三层，中间件不必在这里重挂一遍。
 */
import { CreateMcpTokenRequestSchema, McpTokenIdSchema } from "@menote/shared";
import { Hono } from "hono";
import * as v from "valibot";
import { DomainError } from "../errors";
import { requireSession } from "../middleware/session";
import { readJsonBody } from "../validation";
import {
  createApiToken,
  listApiTokens,
  listTokenAudit,
  revokeApiToken,
} from "../services/mcp/tokens";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

app.post("/mcp/tokens", requireSession, async (c) => {
  const parsed = v.safeParse(CreateMcpTokenRequestSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");
  return c.json(await createApiToken(c.env.DB, c.get("user").id, parsed.output, Date.now()), 201);
});

app.get("/mcp/tokens", requireSession, async (c) => {
  return c.json(await listApiTokens(c.env.DB, c.get("user").id, Date.now()));
});

app.delete("/mcp/tokens/:id", requireSession, async (c) => {
  const id = v.safeParse(McpTokenIdSchema, c.req.param("id"));
  if (!id.success) throw new DomainError("invalid", "令牌 ID 格式不合法");
  return c.json(await revokeApiToken(c.env.DB, c.get("user").id, id.output, Date.now()));
});

app.get("/mcp/tokens/:id/audit", requireSession, async (c) => {
  const id = v.safeParse(McpTokenIdSchema, c.req.param("id"));
  if (!id.success) throw new DomainError("invalid", "令牌 ID 格式不合法");
  const rawLimit = c.req.query("limit");
  let limit: number | undefined;
  if (rawLimit !== undefined) {
    limit = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(limit) || limit < 1) throw new DomainError("invalid", "limit 不合法");
  }
  return c.json(
    await listTokenAudit(
      c.env.DB,
      c.get("user").id,
      id.output,
      { limit, cursor: c.req.query("cursor") ?? null },
      Date.now(),
    ),
  );
});

export default app;

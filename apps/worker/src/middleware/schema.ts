/**
 * 表结构就绪守卫（架构 §15.4）：每个 isolate 的首次业务请求触发运行时自愈迁移。
 *
 * 口径见 `docs/modules/Menote-数据模型与迁移设计-v1.md` §4：
 * 迁移未完成或失败时返回 503 `retry_later`，由客户端稍后重试（不缓存失败状态）。
 *
 * 本文件是 middleware 层直接调用 `db/` 的唯一例外——它属基础设施装配，不读业务数据，
 * 因此不违反 `routes → services → db` 的分层（架构 §2.3.3）。
 */
import { apiErrorBody } from "@menote/shared";
import { createMiddleware } from "hono/factory";
import { ensureSchema } from "../db";
import type { EnvBindings } from "../types";

/**
 * 存活探针路径：不依赖 D1。
 * 这样迁移出问题时仍能区分"Worker 挂了"与"表结构没就绪"，也避免健康检查自身被守卫拦掉。
 */
const LIVENESS_PATHS: ReadonlySet<string> = new Set(["/api/health"]);

export const schemaGuard = createMiddleware<{ Bindings: EnvBindings }>(async (c, next) => {
  if (LIVENESS_PATHS.has(c.req.path)) {
    await next();
    return;
  }

  const result = await ensureSchema(c.env.DB);
  if (!result.ok) {
    return c.json(apiErrorBody("retry_later", "服务正在初始化，请稍后重试"), 503);
  }

  await next();
});

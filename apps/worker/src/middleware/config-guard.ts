/**
 * 必备机密的存在性检查（fail-closed）。
 *
 * 为什么不在 `wrangler.jsonc` 用 `"secrets": { "required": [...] }`：那是 **deploy 的硬门禁**，
 * 机密没设时 `wrangler deploy` 直接失败；而首次部署时 Worker 尚不存在、无法先设机密，
 * 等于把一键部署/Workers Builds 永久堵死（M1-10 实测踩到）。
 *
 * 这里改成运行时检查：缺机密时相关接口明确返回 503 并说明缺什么，运维一眼能看出该怎么修；
 * 且**绝不会**用空密钥去算 HMAC（那会静默降级成一个不安全的实现）。
 */
import { apiErrorBody } from "@menote/shared";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

export const configGuard = createMiddleware<AppEnv>(async (c, next) => {
  const pepper = c.env.AUTH_PEPPER;
  if (typeof pepper !== "string" || pepper.length === 0) {
    console.error(
      "缺少必备机密 AUTH_PEPPER：认证相关接口不可用。请在部署设置里添加该机密后重新部署。",
    );
    return c.json(
      apiErrorBody("retry_later", "服务未完成配置：缺少 AUTH_PEPPER，请在部署设置中添加后重试"),
      503,
    );
  }
  await next();
});

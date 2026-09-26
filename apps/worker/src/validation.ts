/**
 * 请求体解析小工具：把"读 JSON"与"schema 校验"分开，路由里不出现 try/catch 样板。
 */
import type { Context } from "hono";

/**
 * 读请求体 JSON。
 * 解析失败（空体、非法 JSON、非 JSON Content-Type）返回 `undefined`，
 * 交给 Valibot schema 判为 `invalid`，**不在这里抛 500**。
 */
export async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return (await c.req.json()) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Menote 前后端共享包：常量、类型、错误码与纯函数。
 *
 * 约束（架构 §2.3）：本包不得依赖任何浏览器或 Worker 专有 API，
 * 保证两端都能运行、都能单测。依赖方向：apps/* → packages/shared。
 */

export const APP_NAME = "Menote" as const;

/** 统一错误体（架构 §4.3）：客户端按 code 分派处理 */
export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  detail?: unknown;
}

/** 错误码全集（架构 §4.3 表） */
export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "csrf"
  | "not_found"
  | "rev_conflict"
  | "meta_conflict"
  | "too_large"
  | "invalid"
  | "rate_limited"
  | "retry_later";

/** 错误码 → HTTP 状态（架构 §4.3） */
export const HTTP_STATUS_BY_CODE: Readonly<Record<ApiErrorCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  csrf: 403,
  not_found: 404,
  rev_conflict: 409,
  meta_conflict: 409,
  too_large: 413,
  invalid: 422,
  rate_limited: 429,
  retry_later: 503,
};

/** 组装统一错误体；detail 未传时不输出该字段，保持响应最小 */
export function apiErrorBody(
  code: ApiErrorCode,
  message: string,
  detail?: unknown,
): ApiErrorBody {
  return detail === undefined ? { code, message } : { code, message, detail };
}

/** GET /api/health 响应（M0 部署链路冒烟端点） */
export interface HealthResponse {
  ok: true;
  app: string;
  time: string;
}

// —— 以下按主题分模块，统一从这里再导出（两端只 import "@menote/shared"）——
export * from "./auth";
export * from "./base64url";
export * from "./folders";
export * from "./hash";
export * from "./items";
export * from "./limits";
export * from "./search";
export * from "./settings";
export * from "./sync";
export * from "./text";
export * from "./ulid";

/**
 * Worker 侧的领域错误：服务层与中间件用它表达"该返回哪个统一错误码"，
 * 由入口的 `onError` 统一转成架构 §4.3 的错误体（路由里不写错误格式）。
 *
 * 注意：这里只做"错误码 → HTTP 状态"的映射，值本身来自 `@menote/shared`，两端一致。
 */
import { HTTP_STATUS_BY_CODE, type ApiErrorCode } from "@menote/shared";

export class DomainError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly detail: unknown;

  constructor(code: ApiErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = HTTP_STATUS_BY_CODE[code];
    this.detail = detail;
  }
}

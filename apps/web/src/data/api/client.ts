/**
 * API 传输层（架构 §3.1 的 L5）：统一超时、CSRF 头、错误码映射。
 *
 * 约定：
 * - 同源请求，会话靠 HttpOnly Cookie（`credentials` 默认 same-origin 即可，无需显式带）。
 * - 所有请求带 `X-Menote: 1`（架构 §13.2 的 CSRF 主防线）。
 * - **不做自动重试**：重试与退避属于 outbox（`data/sync/`）的职责，传输层只管一次请求。
 * - 网络失败与超时统一抛 `ApiError("retry_later")`，让上层按可重试处理。
 */
import {
  CSRF_HEADER_NAME,
  CSRF_HEADER_VALUE,
  REQUEST_TIMEOUT_MS,
  type ApiErrorBody,
  type ApiErrorCode,
} from "@menote/shared";

/** 服务端统一错误体对应的客户端异常（架构 §4.3） */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly detail: unknown;

  constructor(code: ApiErrorCode, message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }

  /** 网络/超时等"可以重试"的错误 */
  get retryable(): boolean {
    return this.status === 0 || this.code === "retry_later" || this.code === "rate_limited";
  }
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** 对象 → JSON；字符串 → 原样发送（正文用 `text/markdown`） */
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** 发一次请求并返回原始 `Response`；非 2xx 统一抛 `ApiError` */
export async function apiFetch(path: string, options: ApiRequestOptions = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = (): void => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort);

  const headers: Record<string, string> = { [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE, ...options.headers };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (typeof options.body === "string") {
      body = options.body;
      headers["Content-Type"] ??= "text/markdown; charset=utf-8";
    } else {
      body = JSON.stringify(options.body);
      headers["Content-Type"] ??= "application/json";
    }
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body,
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new ApiError(
      "retry_later",
      aborted ? "请求超时，请重试" : "无法连接服务器，请检查网络后重试",
      0,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }

  // 304 不是错误：条件 GET（If-None-Match）命中时用它表示"本地缓存仍有效"，由调用方处理
  if (!response.ok && response.status !== 304) {
    const body = await readErrorBody(response);
    throw new ApiError(
      body?.code ?? "retry_later",
      body?.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
      body?.detail,
    );
  }

  return response;
}

async function readErrorBody(response: Response): Promise<ApiErrorBody | null> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return null;
  }
}

/** 发一次请求并解析 JSON（204 返回 undefined） */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const response = await apiFetch(path, options);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

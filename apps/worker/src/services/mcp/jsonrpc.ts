/**
 * 无状态 JSON-RPC（设计 §五-2）。
 *
 * 「无状态」的含义：每个 POST 携带**一个** JSON-RPC 消息，服务端直接以 `application/json`
 * 返回结果。不维持会话、不用 SSE、不需要 Durable Objects（设计 §17.1）——所以本文件里
 * 没有任何"记住上一次请求"的状态。
 *
 * ## 错误分两类，这个划分是给客户端用的
 *
 * - **协议层错误**（JSON-RPC error）：方法不存在、消息结构不合法。客户端改不了，只能升级或换客户端；
 * - **业务失败**（`result.isError = true`）：权限不够、参数不对、条目太大、版本冲突。
 *   **这一类故意不用 JSON-RPC error** —— agent 需要能把提示原样转述给用户并自行纠正，
 *   塞进协议错误里它多半只会当成"服务坏了"而重试。
 */
import { DomainError } from "../../errors";
import { McpToolError } from "./parts";

export const JSONRPC_VERSION = "2.0";

/** 声明的协议版本。客户端比它新也照样回它要的结果——多出来的字段它会忽略 */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

export const JSONRPC_ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** 令牌无效 / 已撤销 / 已过期 / 不允许 URL 方式 */
  unauthorized: -32001,
  /** 限速。额外带 HTTP 429，客户端一眼能看出该退避 */
  rateLimited: -32029,
} as const;

export type JsonRpcId = string | number | null;

export interface JsonRpcMessage {
  jsonrpc: string;
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export function success(id: JsonRpcId, result: unknown): Record<string, unknown> {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function failure(id: JsonRpcId, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } };
}

/**
 * 工具结果：MCP 的 `content` 只有 text 通道，所以统一给 `JSON.stringify` 的结构化 JSON。
 *
 * `structuredContent` 一并带上：MCP 规范里客户端可以优先用它（有 schema 校验的客户端
 * 会更喜欢），而老客户端只认 `content` 也照样能读。
 */
export function toolResult(value: unknown, isError = false): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    isError,
  };
}

/** 通知（无 `id`）的判定：JSON-RPC 里没有 `id` 就是通知，返回 202 空体、不回 result */
export function isNotification(message: JsonRpcMessage): boolean {
  return message.id === undefined;
}

/**
 * 解析一个 JSON-RPC 消息。不合法就抛 `ProtocolError`（由路由层翻成对应的错误码）。
 *
 * 这里**不做**"消息不是对象"以外的宽容处理：MCP 的对端是程序不是浏览器用户，
 * 宽容只会让它更难发现问题。
 */
export function parseMessage(raw: unknown): JsonRpcMessage {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ProtocolError(JSONRPC_ERROR.invalidRequest, "请求体必须是 JSON-RPC 消息对象");
  }
  const message = raw as Record<string, unknown>;
  if (message.jsonrpc !== JSONRPC_VERSION) {
    throw new ProtocolError(JSONRPC_ERROR.invalidRequest, "jsonrpc 字段必须是 2.0");
  }
  if (typeof message.method !== "string" || message.method === "") {
    throw new ProtocolError(JSONRPC_ERROR.invalidRequest, "缺少 method");
  }
  if (
    message.id !== undefined &&
    message.id !== null &&
    typeof message.id !== "string" &&
    typeof message.id !== "number"
  ) {
    throw new ProtocolError(JSONRPC_ERROR.invalidRequest, "id 必须是字符串、数字或 null");
  }
  if (message.params !== undefined && typeof message.params !== "object") {
    throw new ProtocolError(JSONRPC_ERROR.invalidParams, "params 必须是对象");
  }
  return message as unknown as JsonRpcMessage;
}

/** 协议层错误：带 JSON-RPC 错误码，由路由层直接翻成 error 响应 */
export class ProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * 把执行期抛出的东西归成两类。
 *
 * `DomainError` 有 `code` 字段可以直接映射：限速 → 429，鉴权 → 401，权限 → 业务失败。
 * `McpToolError` 来自工具实现，一律算业务失败（`isError: true`）。
 * 其它（真 bug）归到 `-32603`——**不要把内部错误信息原样回给客户端**，那会泄露库结构。
 */
export function toProtocolError(error: unknown): ProtocolError {
  if (error instanceof ProtocolError) return error;
  if (error instanceof McpToolError) {
    return new ProtocolError(JSONRPC_ERROR.invalidParams, error.message);
  }
  if (error instanceof DomainError) {
    if (error.code === "rate_limited") return new ProtocolError(JSONRPC_ERROR.rateLimited, error.message);
    if (error.code === "unauthenticated" || error.code === "forbidden") {
      return new ProtocolError(JSONRPC_ERROR.unauthorized, error.message);
    }
    // 其余（not_found / rev_conflict / invalid / too_large…）都是"你换个参数再来"，
    // 归到 invalidParams 并把中文原因带出去——agent 看得懂才能自己纠正
    return new ProtocolError(JSONRPC_ERROR.invalidParams, error.message);
  }
  console.error("mcp internal error:", error);
  return new ProtocolError(JSONRPC_ERROR.internal, "服务内部错误");
}

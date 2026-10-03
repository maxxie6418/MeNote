/**
 * MCP 端点（M6 批 2；架构 §十一 / 设计 §五-1）。
 *
 * 三个入口，刻意**不挂在 `/api` 下**：
 * - `POST /mcp` —— 主方式，`Authorization: Bearer mn_…`；
 * - `POST /mcp/k/<令牌>` —— 兜底，只有显式勾过「允许通过 URL 使用」的令牌能用；
 * - `GET /mcp`  —— **405**。不做 SSE（设计 §17.1：无状态 Streamable HTTP）。
 *
 * ## 刻意不挂的三层中间件
 *
 * - **`csrfGuard`**：MCP 不用 Cookie 鉴权，没有 CSRF 面；
 * - **`requireSession`**：鉴权走令牌，与设置页那条会话路径完全独立；
 * - **`configGuard`**：**不需要 `AUTH_PEPPER`**。令牌是 32 字节高熵随机串，SHA-256 足够
 *   （设计 §17.3「高熵随机串用 SHA-256 即可，无需慢哈希」）——这也是本文件在本项目里
 *   是唯一一个不受"缺机密就 503"约束的服务端路径。
 *
 * `securityHeaders` 与 `schemaGuard` 照挂：前者防内容嗅探，后者保证要读的那三张表已建。
 * 两者都在本文件内挂，入口 `index.ts` 保持只装配。
 */
import { APP_NAME } from "@menote/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { DomainError } from "../errors";
import { schemaGuard } from "../middleware/schema";
import { securityHeaders } from "../middleware/security-headers";
import { readJsonBody } from "../validation";
import {
  authenticateMcp,
  assertMcpPerm,
  assertUrlAllowed,
  bearerToken,
  pathToken,
  type McpPrincipal,
} from "../services/mcp/auth";
import {
  JSONRPC_ERROR,
  MCP_PROTOCOL_VERSION,
  failure,
  isNotification,
  parseMessage,
  success,
  toProtocolError,
  toolResult,
  type JsonRpcId,
} from "../services/mcp/jsonrpc";
import { findTool, listToolsPayload, permLabel } from "../services/mcp/registry";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

/*
  子应用在 `index.ts` 里挂载为 `app.route("/mcp", mcp)`，所以**这里的路径是相对的**：
  `/` 就是对外的 `/mcp`，`/k/:token` 就是 `/mcp/k/:token`。写成 `/mcp` 的话实际路径会是 `/mcp/mcp`。
*/
app.use("*", securityHeaders);
app.use("*", schemaGuard);

/** 无 SSE：GET 一律 405，并说清该用什么（设计 §五-1） */
app.get("/", (c) =>
  c.json(
    { error: "method_not_allowed", message: "MCP 端点只接受 POST（Streamable HTTP，无 SSE）" },
    405,
  ),
);

/**
 * 鉴权失败一律 401，且**不区分**「不存在 / 已撤销 / 已过期」——
 * 区分开就是一份"哪些令牌曾经存在"的清单（防探测，与分享访客侧同思路）。
 * 限速单独走 429 **并且带 JSON-RPC 错误体**（`id` 只能是 null：这一步还没解析请求，
 * 不知道对方的 id 是多少）：客户端既能看 HTTP 状态退避，也能按 `-32029` 精确处理。
 */
async function authenticate(
  c: Context<AppEnv>,
  rawToken: string | null,
  viaUrl: boolean,
): Promise<McpPrincipal | Response> {
  if (!rawToken) return c.json({ error: "unauthorized", message: "令牌无效" }, 401);
  try {
    const principal = await authenticateMcp(c.env.DB, rawToken, Date.now());
    if (viaUrl) assertUrlAllowed(principal);
    return principal;
  } catch (error) {
    if (error instanceof DomainError && error.code === "rate_limited") {
      return c.json(failure(null, JSONRPC_ERROR.rateLimited, error.message), 429);
    }
    return c.json({ error: "unauthorized", message: "令牌无效" }, 401);
  }
}

async function handle(c: Context<AppEnv>, rawToken: string | null, viaUrl: boolean): Promise<Response> {
  const authed = await authenticate(c, rawToken, viaUrl);
  if (authed instanceof Response) return authed;
  const principal = authed;

  let message;
  try {
    message = parseMessage(await readJsonBody(c));
  } catch (error) {
    const protocol = toProtocolError(error);
    return c.json(failure(null, protocol.code, protocol.message), 400);
  }

  // 通知（没有 id）按规范不回任何内容：202 空体
  if (isNotification(message)) return c.body(null, 202);

  const id: JsonRpcId = message.id ?? null;
  try {
    switch (message.method) {
      case "initialize":
        return c.json(
          success(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            // 只报名字不报版本：版本号的唯一来源是根 `package.json`，而它是前端构建期
            // 注入的（AGENTS.md「版本号只有一处来源」）。worker 侧再抄一份就会漂。
            serverInfo: { name: APP_NAME },
          }),
        );

      case "ping":
        return c.json(success(id, {}));

      case "tools/list":
        return c.json(success(id, { tools: listToolsPayload() }));

      case "tools/call": {
        const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
        const tool = typeof params.name === "string" ? findTool(params.name) : undefined;
        if (!tool) {
          return c.json(failure(id, JSONRPC_ERROR.methodNotFound, `没有名为「${String(params.name)}」的工具`));
        }

        try {
          assertMcpPerm(principal, tool.perm, permLabel(tool.perm));
          const result = await tool.run(c.env, principal, (params.arguments ?? {}) as never);
          return c.json(success(id, toolResult(result)));
        } catch (error) {
          /*
            业务失败一律走 `isError: true` 而不是 JSON-RPC error（设计 §5.2）：
            agent 要能把这句中文转述给用户并自己纠正，塞进协议错误里它多半只会当成"服务坏了"重试。
            只有 `internal`（真 bug）与限速例外——前者不能把内部信息回给客户端，后者要让客户端退避。
          */
          const protocol = toProtocolError(error);
          if (protocol.code === JSONRPC_ERROR.internal) {
            return c.json(failure(id, protocol.code, protocol.message));
          }
          if (protocol.code === JSONRPC_ERROR.rateLimited) {
            return c.json(failure(id, protocol.code, protocol.message), 429);
          }
          return c.json(success(id, toolResult({ error: protocol.message }, true)));
        }
      }

      default:
        return c.json(failure(id, JSONRPC_ERROR.methodNotFound, `不支持的方法：${message.method}`));
    }
  } catch (error) {
    const protocol = toProtocolError(error);
    return c.json(failure(id, protocol.code, protocol.message));
  }
}

app.post("/", (c) => handle(c, bearerToken(c.req.header("Authorization")), false));

app.post("/k/:token", (c) => handle(c, pathToken(c.req.param("token")), true));

export default app;

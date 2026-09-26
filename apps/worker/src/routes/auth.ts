/**
 * 认证路由（架构 §2.3.2：`routes/auth.ts`）。只做参数校验与转服务层，**不写业务**。
 */
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  PreloginRequestSchema,
  RegisterRequestSchema,
  type AuthSessionResponse,
  type ChangePasswordResponse,
  type MeResponse,
} from "@menote/shared";
import { Hono } from "hono";
import type { Context } from "hono";
import * as v from "valibot";
import { DomainError } from "../errors";
import { clearSessionCookie, requireSession, setSessionCookie } from "../middleware/session";
import { changePassword, login, prelogin, register } from "../services/auth";
import { deleteSession } from "../services/sessions";
import type { AppEnv } from "../types";
import { readJsonBody } from "../validation";

const app = new Hono<AppEnv>();

function invalid(): DomainError {
  return new DomainError("invalid", "请求内容不合法");
}

/** 客户端 IP：只用 Cloudflare 注入的头；本地 dev / 测试回退为固定串（不取 X-Forwarded-For） */
function clientIp(c: Context<AppEnv>): string {
  return c.req.header("CF-Connecting-IP") ?? "local";
}

app.post("/auth/prelogin", async (c) => {
  const parsed = v.safeParse(PreloginRequestSchema, await readJsonBody(c));
  if (!parsed.success) throw invalid();
  return c.json(await prelogin(c.env.DB, c.env.AUTH_PEPPER, parsed.output.username));
});

app.post("/auth/register", async (c) => {
  const parsed = v.safeParse(RegisterRequestSchema, await readJsonBody(c));
  if (!parsed.success) throw invalid();

  const result = await register(
    c.env.DB,
    c.env.AUTH_PEPPER,
    { username: parsed.output.username, loginKey: parsed.output.login_key },
    Date.now(),
  );

  setSessionCookie(c, result.token);
  const body: AuthSessionResponse = { user: result.user };
  return c.json(body, 201);
});

app.post("/auth/login", async (c) => {
  const parsed = v.safeParse(LoginRequestSchema, await readJsonBody(c));
  if (!parsed.success) throw invalid();

  const result = await login(
    c.env.DB,
    c.env.AUTH_PEPPER,
    { username: parsed.output.username, loginKey: parsed.output.login_key },
    clientIp(c),
    Date.now(),
  );

  setSessionCookie(c, result.token);
  const body: AuthSessionResponse = { user: result.user };
  return c.json(body);
});

app.post("/auth/logout", requireSession, async (c) => {
  await deleteSession(c.env.DB, c.get("tokenHash"));
  clearSessionCookie(c);
  return c.body(null, 204);
});

app.get("/auth/me", requireSession, (c) => {
  const user = c.get("user");
  const body: MeResponse = { id: user.id, username: user.username, role: user.role };
  return c.json(body);
});

app.post("/auth/password", requireSession, async (c) => {
  const parsed = v.safeParse(ChangePasswordRequestSchema, await readJsonBody(c));
  if (!parsed.success) throw invalid();

  const result = await changePassword(
    c.env.DB,
    c.env.AUTH_PEPPER,
    c.get("user"),
    c.get("tokenHash"),
    {
      loginKey: parsed.output.login_key,
      newLoginKey: parsed.output.new_login_key,
      newKdf: parsed.output.new_kdf,
    },
    Date.now(),
  );

  // 服务的内部命名是驼峰；线上契约（@menote/shared）是 snake_case，这里显式转换
  const body: ChangePasswordResponse = { invalidated_sessions: result.invalidatedSessions };
  return c.json(body);
});

export default app;

/**
 * 必备机密缺失时的 fail-closed 行为。
 *
 * 为什么必须测：`wrangler.jsonc` 里不能用 `secrets.required`（那是 deploy 硬门禁，会把首次部署堵死），
 * 所以"缺机密"只能在运行时拦住——拦住的方式必须明确（503 + 说明缺什么），
 * 且**绝不能**用空密钥继续算 HMAC。
 *
 * 同时必须测"哪些端点**不**该被拦"：首次部署忘配机密时，前端仍要能读到注册状态，
 * 从而把用户送到注册页并看到明确原因（而不是停在登录页、连入口都没有）。
 */
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { configGuard } from "../src/middleware/config-guard";
import type { AppEnv } from "../src/types";

function appWithGuard(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // 与 src/index.ts 的挂载方式保持一致
  app.use("/api/auth/prelogin", configGuard);
  app.use("/api/auth/login", configGuard);
  app.use("/api/auth/register", configGuard);
  app.use("/api/auth/password", configGuard);
  app.post("/api/auth/prelogin", (c) => c.json({ ok: true }));
  app.post("/api/auth/login", (c) => c.json({ ok: true }));
  app.post("/api/auth/register", (c) => c.json({ ok: true }));
  app.get("/api/auth/registration-state", (c) => c.json({ open: false, has_users: false }));
  app.get("/api/auth/me", (c) => c.json({ ok: true }));
  app.get("/api/health", (c) => c.json({ ok: true }));
  return app;
}

const env = (pepper?: string): Record<string, unknown> =>
  pepper === undefined ? { DB: {}, ASSETS: {} } : { DB: {}, ASSETS: {}, AUTH_PEPPER: pepper };

describe("configGuard", () => {
  it("缺少 AUTH_PEPPER 时，真正要用机密的端点返回 503 并说明缺什么", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await appWithGuard().request(
      "http://menote.test/api/auth/register",
      { method: "POST" },
      env(),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("retry_later");
    expect(body.message).toContain("AUTH_PEPPER");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("空字符串也算缺失（不能用空密钥算 HMAC）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await appWithGuard().request(
      "http://menote.test/api/auth/prelogin",
      { method: "POST" },
      env(""),
    );

    expect(res.status).toBe(503);
    errorSpy.mockRestore();
  });

  it("缺机密时仍要能读注册状态、健康检查与会话：否则前端停在登录页且没有注册入口", async () => {
    const app = appWithGuard();

    const state = await app.request("http://menote.test/api/auth/registration-state", {}, env());
    expect(state.status).toBe(200);
    expect(await state.json()).toEqual({ open: false, has_users: false });

    expect((await app.request("http://menote.test/api/auth/me", {}, env())).status).toBe(200);
    expect((await app.request("http://menote.test/api/health", {}, env())).status).toBe(200);
  });

  it("配置了就放行", async () => {
    const res = await appWithGuard().request(
      "http://menote.test/api/auth/login",
      { method: "POST" },
      env("pepper"),
    );
    expect(res.status).toBe(200);
  });
});

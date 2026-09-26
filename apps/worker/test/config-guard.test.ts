/**
 * 必备机密缺失时 fail-closed。
 *
 * 为什么必须测：`wrangler.jsonc` 里不能用 `secrets.required`（那是 deploy 硬门禁，会把首次部署堵死），
 * 所以"缺机密"这件事只能在运行时拦住——拦住的方式必须明确（503 + 说明缺什么），
 * 且**绝不能**用空密钥继续算 HMAC。
 */
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { configGuard } from "../src/middleware/config-guard";
import type { AppEnv } from "../src/types";

function appWithGuard(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("/api/auth/*", configGuard);
  app.use("/api/admin/*", configGuard);
  app.get("/api/auth/me", (c) => c.json({ ok: true }));
  app.get("/api/admin/registration", (c) => c.json({ ok: true }));
  app.get("/api/health", (c) => c.json({ ok: true }));
  return app;
}

const env = (pepper?: string): Record<string, unknown> =>
  pepper === undefined ? { DB: {}, ASSETS: {} } : { DB: {}, ASSETS: {}, AUTH_PEPPER: pepper };

describe("configGuard", () => {
  it("缺少 AUTH_PEPPER：认证与实例管理接口返回 503 且说明缺什么", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await appWithGuard().request("http://menote.test/api/auth/me", {}, env());

    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("retry_later");
    expect(body.message).toContain("AUTH_PEPPER");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("空字符串也算缺失（不能用空密钥算 HMAC）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await appWithGuard().request("http://menote.test/api/admin/registration", {}, env(""));

    expect(res.status).toBe(503);
    errorSpy.mockRestore();
  });

  it("配置了就放行；不需要机密的路径不受影响", async () => {
    const guarded = await appWithGuard().request(
      "http://menote.test/api/auth/me",
      {},
      env("pepper"),
    );
    expect(guarded.status).toBe(200);

    const health = await appWithGuard().request("http://menote.test/api/health", {}, env());
    expect(health.status).toBe(200);
  });
});

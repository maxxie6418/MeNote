/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { HealthResponse } from "@menote/shared";

describe("GET /api/health", () => {
  it("返回 200 与固定结构", async () => {
    const res = await SELF.fetch("https://menote.test/api/health");

    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthResponse;
    expect(body.ok).toBe(true);
    expect(body.app).toBe("Menote");
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });

  it("未匹配路径返回统一错误体", async () => {
    const res = await SELF.fetch("https://menote.test/api/none");

    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("not_found");
  });
});

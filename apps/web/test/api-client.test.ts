import { CSRF_HEADER_NAME, ITEM_META_HEADER, decodeItemWriteMeta } from "@menote/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "../src/data/api/client";
import { itemsApi, syncApi } from "../src/data/api/endpoints";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("传输层", () => {
  it("所有请求都带 CSRF 头；对象体自动 JSON 化", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/auth/login", { method: "POST", body: { username: "alice" } });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers[CSRF_HEADER_NAME]).toBe("1");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ username: "alice" }));
  });

  it("字符串体按原样发送并标 text/markdown（正文保存）", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "x", rev: 2, bytes: 3, chars: 3 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/items/x/body", { method: "PUT", body: "# 标题" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(init.body).toBe("# 标题");
    expect(headers["Content-Type"]).toContain("text/markdown");
  });

  it("非 2xx 映射为 ApiError（带 code / status / detail）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ code: "rev_conflict", message: "版本冲突", detail: { rev: 2 } }, 409),
      ),
    );

    await expect(apiRequest("/api/items/x/body", { method: "PUT", body: "x" })).rejects.toMatchObject({
      name: "ApiError",
      code: "rev_conflict",
      status: 409,
      detail: { rev: 2 },
    });
  });

  it("204 返回 undefined；网络失败与超时都归为可重试的 retry_later", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(apiRequest("/api/auth/logout", { method: "POST" })).resolves.toBeUndefined();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const network = await apiRequest("/api/x").catch((error: unknown) => error);
    expect(network).toBeInstanceOf(ApiError);
    expect((network as ApiError).code).toBe("retry_later");
    expect((network as ApiError).retryable).toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            });
          }),
      ),
    );
    const timeout = await apiRequest("/api/x", { timeoutMs: 5 }).catch((error: unknown) => error);
    expect(timeout).toBeInstanceOf(ApiError);
    expect((timeout as ApiError).status).toBe(0);
  });
});

describe("端点封装", () => {
  it("新建条目：元数据在 X-Menote-Meta 头里，正文是请求体", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "i1", rev: 1, bytes: 2, chars: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    await itemsApi.create(
      "i1",
      {
        type: "note",
        title: "标题",
        folder_id: null,
        tags: ["工作"],
        memo_at: null,
        is_task: 0,
        task_status: null,
        task_due: null,
        task_priority: null,
        content_hash: "hash",
      },
      "正文",
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/items/i1");
    const headers = init.headers as Record<string, string>;
    expect(decodeItemWriteMeta(headers[ITEM_META_HEADER] ?? "")).toMatchObject({
      title: "标题",
      tags: ["工作"],
    });
    expect(init.body).toBe("正文");
  });

  it("取正文命中 304 时返回 null，否则返回正文与 ETag", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 304 })));
    await expect(itemsApi.getBody("i1", "hash")).resolves.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("# 正文", {
            status: 200,
            headers: { "Content-Type": "text/markdown", ETag: '"abc"' },
          }),
      ),
    );
    await expect(itemsApi.getBody("i1")).resolves.toEqual({ body: "# 正文", contentHash: "abc" });
  });

  it("拉取响应过共享 schema：非法载荷直接抛错，不污染本地库", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: "不是数组" })));

    await expect(syncApi.pull(0)).rejects.toThrow();
  });
});

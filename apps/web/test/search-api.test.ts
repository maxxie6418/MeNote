// @vitest-environment jsdom
/**
 * 搜索服务端兜底的接口层（M2-6）：参数拼装与响应校验。
 *
 * 只测"我们发出去的请求长什么样"与"不合规的响应会被挡下来"——真实服务端行为由
 * `apps/worker/test/search.test.ts` 负责。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchApi } from "../src/data/api/endpoints";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(payload: unknown, status = 200) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  return calls;
}

const ROW = {
  id: "01JCX",
  type: "note",
  folder_id: null,
  title: "会议记录",
  tags: ["工作"],
  memo_at: null,
  is_task: 0,
  task_status: null,
  updated_at: 1,
  snippet: "讨论了发布方案",
};

describe("searchApi.query", () => {
  it("只带 q 时不拼多余的筛选参数", async () => {
    const calls = stubFetch({ results: [ROW] });
    const response = await searchApi.query({ q: "发布方案" });

    expect(calls[0]).toContain("/api/search?");
    expect(calls[0]).toContain("q=%E5%8F%91%E5%B8%83%E6%96%B9%E6%A1%88");
    expect(calls[0]).not.toContain("type=");
    expect(calls[0]).not.toContain("folder=");
    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.tags).toEqual(["工作"]);
  });

  it("筛选参数按约定拼接（type=all 不发送、folder=root 表示根目录）", async () => {
    const calls = stubFetch({ results: [] });
    await searchApi.query({ q: "a", type: "all", folder: "root", tag: "工作", from: 100 });

    expect(calls[0]).not.toContain("type=all");
    expect(calls[0]).toContain("folder=root");
    expect(calls[0]).toContain("tag=");
    expect(calls[0]).toContain("from=100");
  });

  it("响应不合规时抛出（喂界面的数据不做无条件信任）", async () => {
    stubFetch({ results: [{ id: "x" }] });
    await expect(searchApi.query({ q: "a" })).rejects.toThrow();
  });

  it("服务端错误照常抛出（调用方回退到只有本地结果）", async () => {
    stubFetch({ code: "retry_later", message: "服务暂时不可用" }, 503);
    await expect(searchApi.query({ q: "a" })).rejects.toThrow();
  });
});

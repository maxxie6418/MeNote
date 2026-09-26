import { describe, expect, it } from "vitest";
import { apiErrorBody, HTTP_STATUS_BY_CODE, type ApiErrorCode } from "../src/index";

describe("apiErrorBody", () => {
  it("detail 未传时不输出 detail 字段", () => {
    expect(apiErrorBody("not_found", "条目不存在")).toEqual({
      code: "not_found",
      message: "条目不存在",
    });
  });

  it("detail 传入时原样透传", () => {
    const body = apiErrorBody("rev_conflict", "版本冲突", { rev: 3, content_hash: "abc" });
    expect(body.detail).toEqual({ rev: 3, content_hash: "abc" });
    expect(body.code).toBe("rev_conflict");
  });
});

describe("HTTP_STATUS_BY_CODE", () => {
  const allCodes: ApiErrorCode[] = [
    "unauthenticated",
    "forbidden",
    "csrf",
    "not_found",
    "rev_conflict",
    "meta_conflict",
    "too_large",
    "invalid",
    "rate_limited",
    "retry_later",
  ];

  it("覆盖全部错误码，不多不少", () => {
    expect(Object.keys(HTTP_STATUS_BY_CODE).sort()).toEqual([...allCodes].sort());
  });

  it("状态码与架构 §4.3 表一致", () => {
    expect(HTTP_STATUS_BY_CODE.unauthenticated).toBe(401);
    expect(HTTP_STATUS_BY_CODE.forbidden).toBe(403);
    expect(HTTP_STATUS_BY_CODE.csrf).toBe(403);
    expect(HTTP_STATUS_BY_CODE.not_found).toBe(404);
    expect(HTTP_STATUS_BY_CODE.rev_conflict).toBe(409);
    expect(HTTP_STATUS_BY_CODE.meta_conflict).toBe(409);
    expect(HTTP_STATUS_BY_CODE.too_large).toBe(413);
    expect(HTTP_STATUS_BY_CODE.invalid).toBe(422);
    expect(HTTP_STATUS_BY_CODE.rate_limited).toBe(429);
    expect(HTTP_STATUS_BY_CODE.retry_later).toBe(503);
  });
});

/**
 * 分享的公开访问路由（M5-S1；架构 §十）——**不需要会话**，访客只读。
 *
 * 四个接口（架构定稿）：
 * - `GET  /api/public/shares/:sid`：状态（是否有效、是否要密码、盐与 KDF 参数）；
 * - `POST /api/public/shares/:sid/unlock`：访客浏览器派生校验值后提交，换 1 小时访问令牌；
 * - `GET  /api/public/shares/:sid/content`：单篇原文（令牌放 `X-Menote-Share` 头，不进 URL）；
 * - `GET  /api/public/shares/:sid/att/:sha`：附件（校验属于当前稿引用后从 R2 流式返回）。
 *
 * 失效一律「链接已失效」，不区分撤销 / 过期 / 条目态（架构定稿"实时检查"，防探测）。
 * unlock 是 POST，访客查看器同源发请求时照带 CSRF 头（与主应用同一层守卫，无特例）。
 */
import { ShareIdSchema, SHARE_TOKEN_HEADER, UnlockRequestSchema } from "@menote/shared";
import { Hono } from "hono";
import * as v from "valibot";
import type { AppEnv } from "../types";
import { DomainError } from "../errors";
import { readJsonBody } from "../validation";
import {
  getPublicShareStatus,
  getShareAttachment,
  getShareContent,
  unlockShare,
} from "../services/share-public";

const app = new Hono<AppEnv>();

/** 分享 ID 与附件哈希的参数守卫（哈希 64 位十六进制，与内容寻址同一形状） */
function requireParam(schema: v.GenericSchema<string, string>, value: string): string {
  const parsed = v.safeParse(schema, value);
  if (!parsed.success) throw new DomainError("invalid", "参数格式不合法");
  return parsed.output;
}

app.get("/public/shares/:sid", async (c) => {
  const sid = requireParam(ShareIdSchema, c.req.param("sid"));
  return c.json(await getPublicShareStatus(c.env.DB, sid, Date.now()));
});

app.post("/public/shares/:sid/unlock", async (c) => {
  const sid = requireParam(ShareIdSchema, c.req.param("sid"));
  const parsed = v.safeParse(UnlockRequestSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  return c.json(await unlockShare(c.env, c.env.DB, sid, parsed.output.verifier, ip, Date.now()));
});

app.get("/public/shares/:sid/content", async (c) => {
  const sid = requireParam(ShareIdSchema, c.req.param("sid"));
  const content = await getShareContent(
    c.env,
    c.env.DB,
    sid,
    c.req.header(SHARE_TOKEN_HEADER) ?? "",
    Date.now(),
  );
  return c.json(content);
});

app.get("/public/shares/:sid/att/:sha", async (c) => {
  const sid = requireParam(ShareIdSchema, c.req.param("sid"));
  const sha = requireParam(
    v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
    c.req.param("sha"),
  );
  const attachment = await getShareAttachment(
    c.env,
    c.env.DB,
    sid,
    sha,
    c.req.header(SHARE_TOKEN_HEADER) ?? "",
    Date.now(),
  );
  // R2 的 ReadableStream<any> 与 DOM 的 ReadableStream<Uint8Array> 在 strict 下互不相认，按运行时收窄
  return c.body(attachment.body as unknown as ReadableStream<Uint8Array>, 200, {
    "Content-Type": attachment.mime,
    "Content-Length": String(attachment.size),
    // 内联展示（图片直接看），文件名只作保存建议；文件名来自上传时的登记
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
    "Cache-Control": "private, max-age=300",
  });
});

export default app;

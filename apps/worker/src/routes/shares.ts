/**
 * 分享管理路由（M5-S1；《M5 分享设计》§四：创建 / 列表 / 改密改期 / 撤销，均需会话）。
 *
 * 为什么单列一个路由文件而不是塞进 `items.ts`：分享有自己的生命周期（密码材料、过期、
 * 撤销、公开访问六接口的一半），混在条目 CRUD 里会两摊都说不清；挂载仍走 `index.ts` 装配。
 */
import {
  CreateShareRequestSchema,
  PatchShareRequestSchema,
  ShareIdSchema,
} from "@menote/shared";
import { Hono } from "hono";
import * as v from "valibot";
import type { AppEnv } from "../types";
import { DomainError } from "../errors";
import { requireSession } from "../middleware/session";
import { readJsonBody } from "../validation";
import {
  createShare,
  listShares,
  patchShare,
  revokeShare,
} from "../services/shares";

const app = new Hono<AppEnv>();

app.post("/shares", requireSession, async (c) => {
  const parsed = v.safeParse(CreateShareRequestSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");
  const record = await createShare(c.env.DB, c.get("user").id, parsed.output, Date.now());
  return c.json(record, 201);
});

app.get("/shares", requireSession, async (c) => {
  return c.json(await listShares(c.env.DB, c.get("user").id));
});

app.patch("/shares/:id", requireSession, async (c) => {
  const parsedId = v.safeParse(ShareIdSchema, c.req.param("id"));
  if (!parsedId.success) throw new DomainError("invalid", "分享 ID 格式不合法");
  const parsed = v.safeParse(PatchShareRequestSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");
  const record = await patchShare(
    c.env.DB,
    c.get("user").id,
    parsedId.output,
    parsed.output,
    Date.now(),
  );
  return c.json(record);
});

app.delete("/shares/:id", requireSession, async (c) => {
  const parsedId = v.safeParse(ShareIdSchema, c.req.param("id"));
  if (!parsedId.success) throw new DomainError("invalid", "分享 ID 格式不合法");
  const record = await revokeShare(c.env.DB, c.get("user").id, parsedId.output, Date.now());
  return c.json(record);
});

export default app;

/**
 * 文件夹路由（架构 §2.3.2：`routes/folders.ts`）。
 *
 * M1 只提供创建与改名/移动；笔记本树的展示在 M2。
 */
import { FolderCreateSchema, FolderPatchSchema, isUlid, type FolderWriteResponse } from "@menote/shared";
import { Hono } from "hono";
import * as v from "valibot";
import { DomainError } from "../errors";
import { requireSession } from "../middleware/session";
import { createFolder, patchFolder } from "../services/folders";
import type { AppEnv } from "../types";
import { readJsonBody } from "../validation";

const app = new Hono<AppEnv>();

app.post("/folders", requireSession, async (c) => {
  const parsed = v.safeParse(FolderCreateSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");

  const result = await createFolder(
    c.env.DB,
    c.get("user").id,
    { id: parsed.output.id, parentId: parsed.output.parent_id, name: parsed.output.name },
    Date.now(),
  );

  const response: FolderWriteResponse = result;
  return c.json(response);
});

app.patch("/folders/:id", requireSession, async (c) => {
  const id = c.req.param("id");
  if (!isUlid(id)) throw new DomainError("invalid", "ID 格式不合法");

  const parsed = v.safeParse(FolderPatchSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");

  const result = await patchFolder(c.env.DB, c.get("user").id, id, parsed.output, Date.now());
  const response: FolderWriteResponse = result;
  return c.json(response);
});

export default app;

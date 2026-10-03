/**
 * 回收站路由（M4-6；《M4 设计》§5.1 / §5.2）。
 *
 * 四个动作，**都不收 bulk 一把梭**：
 * - `DELETE /api/items/:id`：移入回收站（软删）；
 * - `POST  /api/items/:id/restore`：恢复（回原位置，原文件夹没了就到根目录）；
 * - `POST  /api/trash/permanent`：永久删除一批（`ids` 最多 10 条，客户端分批）；
 * - `POST  /api/trash/empty`：清空回收站（服务端自己分批）。
 *
 * 为什么单列一个路由文件而不是塞进 `items.ts`：回收站有自己的语义（恢复位置规则、永久删除的
 * 语句预算、墓碑），混在条目 CRUD 里会两摊都说不清；挂载仍走 `index.ts` 的装配。
 */
import {
  PermanentDeleteRequestSchema,
  isUlid,
  type TrashFolderResponse,
  type TrashItemResponse,
} from "@menote/shared";
import { Hono } from "hono";
import * as v from "valibot";
import type { AppEnv } from "../types";
import { DomainError } from "../errors";
import { requireSession } from "../middleware/session";
import { readJsonBody } from "../validation";
import {
  emptyTrash,
  restoreFolder,
  restoreItem,
  softDeleteFolder,
  softDeleteItem,
} from "../services/trash";
import { permanentDeleteItems } from "../services/trash-purge";

const app = new Hono<AppEnv>();

function requireUlid(id: string): string {
  if (!isUlid(id)) throw new DomainError("invalid", "ID 格式不合法");
  return id;
}

app.delete("/items/:id", requireSession, async (c) => {
  const id = requireUlid(c.req.param("id"));
  const result = await softDeleteItem(c.env.DB, c.get("user").id, id, Date.now());
  const response: TrashItemResponse = {
    id: result.id,
    meta_rev: result.meta_rev,
    deleted_at: result.deleted_at,
    folder_id: result.folder_id,
  };
  return c.json(response);
});

app.post("/items/:id/restore", requireSession, async (c) => {
  const id = requireUlid(c.req.param("id"));
  const result = await restoreItem(c.env.DB, c.get("user").id, id, Date.now());
  const response: TrashItemResponse = {
    id: result.id,
    meta_rev: result.meta_rev,
    deleted_at: result.deleted_at,
    folder_id: result.folder_id,
  };
  return c.json(response);
});

app.post("/trash/permanent", requireSession, async (c) => {
  const parsed = v.safeParse(PermanentDeleteRequestSchema, await readJsonBody(c));
  if (!parsed.success) {
    throw new DomainError("invalid", "请求内容不合法；单次最多永久删除 10 条");
  }

  const result = await permanentDeleteItems(c.env.DB, c.get("user").id, parsed.output.ids, Date.now());
  return c.json(result);
});

app.post("/trash/empty", requireSession, async (c) => {
  const result = await emptyTrash(c.env.DB, c.get("user").id, Date.now());
  return c.json(result);
});

// —— 文件夹（连同内容一起进回收站 / 恢复；M4-6 后半）——

app.delete("/folders/:id", requireSession, async (c) => {
  const id = requireUlid(c.req.param("id"));
  const result = await softDeleteFolder(c.env.DB, c.get("user").id, id, Date.now());
  const response: TrashFolderResponse = result;
  return c.json(response);
});

app.post("/folders/:id/restore", requireSession, async (c) => {
  const id = requireUlid(c.req.param("id"));
  const result = await restoreFolder(c.env.DB, c.get("user").id, id, Date.now());
  const response: TrashFolderResponse = result;
  return c.json(response);
});

export default app;

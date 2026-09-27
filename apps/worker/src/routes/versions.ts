/**
 * 版本历史路由（M4-5；《M4 设计》§4）。鉴权 + **条目归属校验**都在这层之上由服务层兜住。
 *
 * 五个动作：列表 / 取单版本正文 / 手动封存 / 恢复 / 「保留」开关。
 * 锁定态下前端**整体不给版本入口**（设计 §4.5），服务端不做额外过滤——门禁是前端的职责。
 */
import { VersionSealSchema } from "@menote/shared";
import { Hono } from "hono";
import * as v from "valibot";
import { DomainError } from "../errors";
import { requireSession } from "../middleware/session";
import {
  getVersionBody,
  listVersions,
  restoreVersion,
  sealVersion,
  setVersionKeep,
} from "../services/versions";
import type { AppEnv } from "../types";
import { readJsonBody } from "../validation";

const app = new Hono<AppEnv>();

/** `GET /api/items/:id/versions?cursor=&limit=`：列表（新的在前） */
app.get("/items/:id/versions", requireSession, async (c) => {
  const cursorRaw = c.req.query("cursor");
  const limitRaw = c.req.query("limit");
  const cursor = cursorRaw === undefined ? null : Number.parseInt(cursorRaw, 10);
  const limit = limitRaw === undefined ? undefined : Number.parseInt(limitRaw, 10);

  const page = await listVersions(c.env.DB, c.get("user").id, c.req.param("id"), {
    cursor: cursor !== null && Number.isFinite(cursor) ? cursor : null,
    limit: limit !== undefined && Number.isFinite(limit) ? limit : undefined,
  });
  return c.json(page);
});

/** `GET /api/versions/:id`：取某个版本的正文（按 `codec` 解压后返回） */
app.get("/versions/:id", requireSession, async (c) => {
  const result = await getVersionBody(c.env, c.get("user").id, c.req.param("id"));
  return c.json(result);
});

/**
 * `POST /api/items/:id/versions`：手动封存（「存为版本」）。
 *
 * 手动版本落库即 `keep = 1`（设计 §4.1），备注走 `label`。
 */
app.post("/items/:id/versions", requireSession, async (c) => {
  const parsed = v.safeParse(VersionSealSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");

  const itemId = c.req.param("id");
  const userId = c.get("user").id;
  const item = await c.env.DB.prepare(
    "SELECT id, rev, title, content_hash, size_bytes FROM items WHERE id = ? AND user_id = ?",
  )
    .bind(itemId, userId)
    .first<{ id: string; rev: number; title: string | null; content_hash: string; size_bytes: number }>();
  if (!item) throw new DomainError("not_found", "条目不存在");

  const bodyRow = await c.env.DB.prepare("SELECT body FROM item_bodies WHERE item_id = ?")
    .bind(itemId)
    .first<{ body: string }>();
  if (!bodyRow) throw new DomainError("not_found", "正文不存在");

  const result = await sealVersion(
    c.env,
    userId,
    itemId,
    {
      reason: "manual",
      label: parsed.output.label ?? null,
      body: bodyRow.body,
      contentHash: item.content_hash,
      title: item.title,
      sizeBytes: item.size_bytes,
      rev: item.rev,
    },
    Date.now(),
  );

  return c.json({ version: result.version, created: result.created });
});

/** `POST /api/versions/:id/restore`：恢复（先封存当前稿 → 覆盖正文 → 版本表不动） */
app.post("/versions/:id/restore", requireSession, async (c) => {
  const result = await restoreVersion(c.env, c.get("user").id, c.req.param("id"), Date.now());
  return c.json(result);
});

/** `PUT /api/versions/:id/keep`：切换「保留」（保留版本不参与稀疏化） */
app.put("/versions/:id/keep", requireSession, async (c) => {
  const parsed = v.safeParse(v.object({ keep: v.boolean() }), await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");

  await setVersionKeep(c.env.DB, c.get("user").id, c.req.param("id"), parsed.output.keep);
  return c.json({ ok: true });
});

export default app;

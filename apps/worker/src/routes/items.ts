/**
 * 条目路由（架构 §2.3.2：`routes/items.ts`）。只做参数/请求头校验与转服务层，不写业务。
 */
import {
  ITEM_BASE_REV_HEADER,
  ITEM_HASH_HEADER,
  ITEM_META_HEADER,
  ItemMetaPatchSchema,
  decodeItemWriteMeta,
  isUlid,
  type ItemBodyWriteResponse,
  type ItemMetaWriteResponse,
} from "@menote/shared";
import { Hono } from "hono";
import type { Context } from "hono";
import * as v from "valibot";
import { DomainError } from "../errors";
import { requireSession } from "../middleware/session";
import { createItem, getItemBody, patchItemMeta, saveItemBody } from "../services/items";
import type { AppEnv } from "../types";
import { readJsonBody } from "../validation";

const app = new Hono<AppEnv>();

/** 客户端可选上报的设备标识：写进 `items.last_device`（需求 §12.2-3 的"跨会话"判断要用） */
const DEVICE_HEADER = "X-Menote-Device";

function requireUlid(id: string): string {
  if (!isUlid(id)) throw new DomainError("invalid", "ID 格式不合法");
  return id;
}

function deviceOf(c: Context<AppEnv>): string | null {
  return c.req.header(DEVICE_HEADER) ?? null;
}

/**
 * 新建（`PUT /api/items/:id`）：ID 由客户端生成，重复提交幂等。
 * 新建与重放都返回 200（PUT 语义；客户端只关心 `rev`）。
 */
app.put("/items/:id", requireSession, async (c) => {
  const id = requireUlid(c.req.param("id"));

  const rawMeta = c.req.header(ITEM_META_HEADER);
  if (!rawMeta) throw new DomainError("invalid", `缺少 ${ITEM_META_HEADER} 请求头`);

  let meta;
  try {
    meta = decodeItemWriteMeta(rawMeta);
  } catch {
    throw new DomainError("invalid", `${ITEM_META_HEADER} 解析失败`);
  }

  const result = await createItem(
    c.env.DB,
    c.get("user").id,
    {
      id,
      type: meta.type,
      title: meta.title,
      folderId: meta.folder_id,
      tags: meta.tags,
      memoAt: meta.memo_at,
      isTask: meta.is_task,
      taskStatus: meta.task_status,
      taskDue: meta.task_due,
      taskPriority: meta.task_priority,
      contentHash: meta.content_hash,
      body: await c.req.text(),
      deviceLabel: deviceOf(c),
    },
    Date.now(),
  );

  const response: ItemBodyWriteResponse = result;
  return c.json(response);
});

/** 取正文：`ETag` 为 `content_hash`，命中 `If-None-Match` 返回 304（架构 §6.1） */
app.get("/items/:id/body", requireSession, async (c) => {
  const id = requireUlid(c.req.param("id"));
  const item = await getItemBody(c.env.DB, c.get("user").id, id);
  if (!item) throw new DomainError("not_found", "条目不存在");

  const etag = `"${item.contentHash}"`;
  if (c.req.header("If-None-Match") === etag) {
    return c.body(null, 304);
  }

  return c.body(item.body, 200, {
    "Content-Type": "text/markdown; charset=utf-8",
    ETag: etag,
  });
});

/** 全文保存：`If-Match: <base_rev>` + `X-Menote-Hash`（架构 §6.1） */
app.put("/items/:id/body", requireSession, async (c) => {
  const id = requireUlid(c.req.param("id"));

  const rawBaseRev = c.req.header(ITEM_BASE_REV_HEADER);
  const contentHash = c.req.header(ITEM_HASH_HEADER);
  if (!rawBaseRev || !contentHash) {
    throw new DomainError("invalid", `缺少 ${ITEM_BASE_REV_HEADER} 或 ${ITEM_HASH_HEADER} 请求头`);
  }

  const baseRev = Number.parseInt(rawBaseRev, 10);
  if (!Number.isInteger(baseRev) || baseRev < 1) {
    throw new DomainError("invalid", "基版本不合法");
  }

  const result = await saveItemBody(
    c.env.DB,
    c.get("user").id,
    id,
    baseRev,
    contentHash,
    await c.req.text(),
    deviceOf(c),
    Date.now(),
  );

  const response: ItemBodyWriteResponse = result;
  return c.json(response);
});

/** 元数据补丁：逐字段可选，独立判定 `meta_rev` */
app.patch("/items/:id/meta", requireSession, async (c) => {
  const id = requireUlid(c.req.param("id"));
  const parsed = v.safeParse(ItemMetaPatchSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");

  const result = await patchItemMeta(c.env.DB, c.get("user").id, id, parsed.output, Date.now());
  const response: ItemMetaWriteResponse = result;
  return c.json(response);
});

export default app;

/**
 * 增量同步的线上形态（协议见 `docs/modules/Menote-同步引擎设计-v1.md` §3）。
 */
import * as v from "valibot";
import { FolderMetaSchema, ItemMetaSchema } from "./items";

const IntSchema = v.pipe(v.number(), v.integer());

/** `GET /api/sync?cursor=N` 的响应：只回元数据，正文另取（架构 §6.1） */
export const SyncResponseSchema = v.object({
  items: v.array(ItemMetaSchema),
  folders: v.array(FolderMetaSchema),
  /** 两类末端序号的**较小值**；客户端据此推进唯一游标 */
  next_cursor: v.pipe(IntSchema, v.minValue(0)),
  has_more: v.boolean(),
  /** 游标早于 `users.tombstone_floor` 时为 true，客户端须清空本地重建 */
  full_resync: v.boolean(),
});
export type SyncResponse = v.InferOutput<typeof SyncResponseSchema>;

/** 正文保存成功（`PUT`/`PATCH /api/items/:id/body`）的响应 */
export const SaveBodyResponseSchema = v.object({
  rev: IntSchema,
  /** 服务端实际字节数（UTF-8），供客户端核对 */
  bytes: v.pipe(IntSchema, v.minValue(0)),
  /** 服务端实际码点数（Character Count），供客户端核对 */
  chars: v.pipe(IntSchema, v.minValue(0)),
});
export type SaveBodyResponse = v.InferOutput<typeof SaveBodyResponseSchema>;

/** 409 `rev_conflict` / `meta_conflict` 的 `detail`（客户端据此区分"真冲突"与"上次已成功"） */
export const ConflictDetailSchema = v.object({
  rev: IntSchema,
  content_hash: v.string(),
});
export type ConflictDetail = v.InferOutput<typeof ConflictDetailSchema>;

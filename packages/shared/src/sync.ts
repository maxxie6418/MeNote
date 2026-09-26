/**
 * 增量同步的线上形态（协议见 `docs/modules/Menote-同步引擎设计-v1.md` §3）。
 */
import * as v from "valibot";
import { FolderMetaSchema, ItemMetaSchema } from "./items";
import { DEFAULT_USER_SETTINGS, UserSettingsPayloadSchema } from "./settings";

const IntSchema = v.pipe(v.number(), v.integer());

/**
 * 设置载荷的兜底值。
 *
 * `settings` 用 `optional` + 默认值，而不是必填：**部署窗口**里新客户端可能遇到还没更新的
 * 旧 Worker（响应里没有这个字段），那不该让整个同步失败——退回默认值即可，下一次拉取会补上。
 */
const SETTINGS_FALLBACK = {
  settings: DEFAULT_USER_SETTINGS,
  rev: 0,
  updated_at: 0,
} as const;

/** `GET /api/sync?cursor=N` 的响应：只回元数据，正文另取（架构 §6.1） */
export const SyncResponseSchema = v.object({
  items: v.array(ItemMetaSchema),
  folders: v.array(FolderMetaSchema),
  /**
   * 用户设置（M2-7）。**不参与游标**：它只有一行、体积极小，每次同步整份带回更简单可靠
   * （若进游标就要把它并进 `next_cursor` 的取小逻辑，收益不抵复杂度）。客户端按 `rev` 决定是否落库。
   */
  settings: v.optional(UserSettingsPayloadSchema, SETTINGS_FALLBACK),
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

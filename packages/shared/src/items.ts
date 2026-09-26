/**
 * 条目与文件夹的线上形态（协议口径见 `docs/modules/Menote-同步引擎设计-v1.md` §3）。
 *
 * 命名规则：**线上字段名 = D1 列名（snake_case）**，两端不做驼峰转换；`user_id` 不出现在
 * 载荷里（服务端按会话确定），`tags` 在 HTTP 上是数组（D1 里存 JSON 字符串）。
 *
 * 类型由 Valibot schema 推导（`InferOutput`），schema 是唯一真相：两端用同一份校验。
 */
import * as v from "valibot";
import { base64UrlDecodeUtf8, base64UrlEncodeUtf8 } from "./base64url";
import { BODY_HARD_LIMIT_BYTES } from "./limits";

/** 内容类型（需求 §2.1） */
export const ItemTypeSchema = v.picklist(["note", "table", "memo"]);
export type ItemType = v.InferOutput<typeof ItemTypeSchema>;

/** D1 里用 INTEGER 0/1 表示的布尔；线上沿用同一表示，避免两端转换不一致 */
const FlagSchema = v.picklist([0, 1]);
const IntSchema = v.pipe(v.number(), v.integer());
const NullableIntSchema = v.nullable(IntSchema);
const TimestampSchema = v.pipe(v.number(), v.integer(), v.minValue(0));

/** 条目元数据（不含正文；正文走 `GET /api/items/:id/body`） */
export const ItemMetaSchema = v.object({
  id: v.string(),
  type: ItemTypeSchema,
  folder_id: v.nullable(v.string()),
  /** Memo 没有独立标题，为 null（需求 §6.5） */
  title: v.nullable(v.string()),
  /** 1 = 单篇加密（仅标记，存储恒为明文，架构 §7.1） */
  enc_self: FlagSchema,
  /** 1 = 位于加密空间内 */
  in_enc_space: FlagSchema,
  size_bytes: v.pipe(IntSchema, v.minValue(0), v.maxValue(BODY_HARD_LIMIT_BYTES)),
  content_hash: v.string(),
  tags: v.array(v.string()),
  memo_at: NullableIntSchema,
  is_task: FlagSchema,
  /** 清单字段的存储字面量 M2 定稿，M1 先按字符串透传（见设计稿 §6 待确认 1） */
  task_status: v.nullable(v.string()),
  task_due: v.nullable(v.string()),
  task_priority: v.nullable(v.string()),
  pinned: FlagSchema,
  starred: FlagSchema,
  /** 正文乐观锁 */
  rev: IntSchema,
  /** 元数据乐观锁 */
  meta_rev: IntSchema,
  sealed_rev: NullableIntSchema,
  sync_seq: IntSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  last_edit_at: NullableIntSchema,
  last_device: v.nullable(v.string()),
  deleted_at: NullableIntSchema,
  /** 计算字段：`deleted_at != null`，客户端据此标记本地删除 */
  deleted: v.boolean(),
});
export type ItemMeta = v.InferOutput<typeof ItemMetaSchema>;

/** 文件夹（普通文件夹 depth 为 1/2；加密空间是每用户一条 depth=0 的内置记录） */
export const FolderMetaSchema = v.object({
  id: v.string(),
  parent_id: v.nullable(v.string()),
  is_enc_space: FlagSchema,
  in_enc_space: FlagSchema,
  name: v.string(),
  depth: v.pipe(IntSchema, v.minValue(0), v.maxValue(2)),
  position: v.number(),
  meta_rev: IntSchema,
  sync_seq: IntSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  deleted_at: NullableIntSchema,
  deleted: v.boolean(),
});
export type FolderMeta = v.InferOutput<typeof FolderMetaSchema>;

/**
 * `PUT /api/items/:id` 的元数据（架构 §6.1：放在 base64url 编码的 `X-Menote-Meta` 请求头里）。
 * 正文走请求体原文，不在这里。
 */
export const ItemWriteMetaSchema = v.object({
  type: ItemTypeSchema,
  title: v.nullable(v.string()),
  folder_id: v.nullable(v.string()),
  tags: v.array(v.string()),
  memo_at: NullableIntSchema,
  is_task: FlagSchema,
  task_status: v.nullable(v.string()),
  task_due: v.nullable(v.string()),
  task_priority: v.nullable(v.string()),
  content_hash: v.string(),
  /** 附件引用；M4 起使用，M1 不传 */
  refs: v.optional(v.array(v.string())),
});
export type ItemWriteMeta = v.InferOutput<typeof ItemWriteMetaSchema>;

/** 元数据 → `X-Menote-Meta` 请求头的值（base64url JSON） */
export function encodeItemWriteMeta(meta: ItemWriteMeta): string {
  return base64UrlEncodeUtf8(JSON.stringify(meta));
}

/** `X-Menote-Meta` 请求头 → 元数据；内容非法时抛错（由路由转成 422 `invalid`） */
export function decodeItemWriteMeta(header: string): ItemWriteMeta {
  return v.parse(ItemWriteMetaSchema, JSON.parse(base64UrlDecodeUtf8(header)) as unknown);
}

/** `PUT /api/items/:id` 放元数据的请求头名（架构 §6.1） */
export const ITEM_META_HEADER = "X-Menote-Meta";
/** `PUT /api/items/:id/body` 的基版本头（架构 §6.1） */
export const ITEM_BASE_REV_HEADER = "If-Match";
/** `PUT /api/items/:id/body` 的内容哈希头（架构 §6.1） */
export const ITEM_HASH_HEADER = "X-Menote-Hash";

/** `PATCH /api/items/:id/meta`：逐字段可选，独立判定 `meta_rev` 冲突 */
export const ItemMetaPatchSchema = v.object({
  base_meta_rev: IntSchema,
  title: v.optional(v.nullable(v.string())),
  folder_id: v.optional(v.nullable(v.string())),
  tags: v.optional(v.array(v.string())),
  pinned: v.optional(FlagSchema),
  starred: v.optional(FlagSchema),
});
export type ItemMetaPatch = v.InferOutput<typeof ItemMetaPatchSchema>;

/** 新建与全文保存的应答：正文大小由服务端实测，供客户端核对 */
export const ItemBodyWriteResponseSchema = v.object({
  id: v.string(),
  rev: IntSchema,
  /** 服务端实测 UTF-8 字节数 */
  bytes: v.pipe(IntSchema, v.minValue(0)),
  /** 服务端实测码点数 */
  chars: v.pipe(IntSchema, v.minValue(0)),
});
export type ItemBodyWriteResponse = v.InferOutput<typeof ItemBodyWriteResponseSchema>;

/** 元数据补丁的应答 */
export const ItemMetaWriteResponseSchema = v.object({
  id: v.string(),
  meta_rev: IntSchema,
});
export type ItemMetaWriteResponse = v.InferOutput<typeof ItemMetaWriteResponseSchema>;

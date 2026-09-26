/**
 * 文件夹的线上形态与请求契约。
 *
 * M1 只用到"建文件夹"和"改名/移动"；层级上限 2 层（需求 §4.5），加密空间（`is_enc_space = 1`
 * 的内置记录）属 M3，M1 不创建。
 */
import * as v from "valibot";

const IntSchema = v.pipe(v.number(), v.integer());
const NameSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(120));

/** `POST /api/folders`：ID 由客户端生成（与条目一致，便于离线新建与幂等重放） */
export const FolderCreateSchema = v.object({
  id: v.string(),
  parent_id: v.nullable(v.string()),
  name: NameSchema,
});
export type FolderCreate = v.InferOutput<typeof FolderCreateSchema>;

/** `PATCH /api/folders/:id`：改名与移动都是元数据操作，按 `meta_rev` 乐观锁 */
export const FolderPatchSchema = v.object({
  base_meta_rev: IntSchema,
  name: v.optional(NameSchema),
  parent_id: v.optional(v.nullable(v.string())),
});
export type FolderPatch = v.InferOutput<typeof FolderPatchSchema>;

/** 写操作的统一应答：返回新的 `meta_rev`，客户端据此更新本地状态 */
export const FolderWriteResponseSchema = v.object({
  id: v.string(),
  meta_rev: IntSchema,
});
export type FolderWriteResponse = v.InferOutput<typeof FolderWriteResponseSchema>;

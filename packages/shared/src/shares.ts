/**
 * 分享（M14）的线上契约（架构 §十「实现为架构定」；本文件只放两端共用的形状与常量）。
 *
 * 关键约束（与认证同源）：
 * - 分享密码的慢哈希（PBKDF2）在**访客浏览器**与**创建者浏览器**里做，服务端只存
 *   盐 / KDF 参数 / 校验值，比对用 HMAC（密钥来自根机密域分离派生，见 worker 服务）。
 * - 访问令牌是**无状态 HMAC 签名**（1 小时），不写库、不可续期。
 * - `extractAttachmentRefs` 也放在 shared：公开附件接口要在 Worker 侧校验
 *   「请求的附件属于被分享条目当前稿的引用」，与 web 侧取引用是同一条内容契约。
 */
import * as v from "valibot";
import { base64UrlEncode } from "./base64url";
import { isUlid } from "./ulid";

/** 访问令牌签名密钥的用途后缀（架构 §十；HKDF info，与备份包裹的 menote-backup-wrap-v1 同一派生手法） */
export const SHARE_TOKEN_CONTEXT = "menote-share-v1";

/** 访问令牌有效期（架构 §十：1 小时；过期后访客重新 unlock 校验） */
export const SHARE_TOKEN_TTL_MS = 60 * 60 * 1000;

/** 分享密码 KDF（与登录同款 PBKDF2-SHA256；600k 次在访客浏览器可接受，爆破被 unlock 限速挡住） */
export const SHARE_KDF_DEFAULT = {
  alg: "PBKDF2-SHA256",
  iterations: 600_000,
  saltBytes: 16,
  dkLen: 32,
} as const;

/** 分享 ID：16 随机字节 → 22 字符 base64url（≥128 位随机，架构定稿；ULID 有时间前缀不用） */
export function newShareId(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
}
export const ShareIdSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{22}$/));

const ShareKdfSchema = v.object({
  alg: v.literal("PBKDF2-SHA256"),
  iterations: v.pipe(v.number(), v.integer(), v.minValue(100_000), v.maxValue(2_000_000)),
});

/** 创建者浏览器派生好的密码材料（明文密码不过网；结构对齐认证的 login_key 思路） */
export const SharePasswordMaterialSchema = v.object({
  kdf: ShareKdfSchema,
  /** base64url */
  salt: v.string(),
  /** base64url；访客用同参数派生出的值与它比对 */
  verifier: v.string(),
});
export type SharePasswordMaterial = v.InferOutput<typeof SharePasswordMaterialSchema>;

/** POST /api/shares：创建（首期只做 kind = item；memo_set 表结构已建、UI 后置） */
export const CreateShareRequestSchema = v.object({
  kind: v.literal("item"),
  item_id: v.pipe(v.string(), v.check(isUlid, "ID 格式不合法")),
  password: v.optional(v.nullable(SharePasswordMaterialSchema)),
  /** 毫秒时间戳；null / 缺省 = 永不过期 */
  expires_at: v.optional(v.nullable(v.number())),
});
export type CreateShareRequest = v.InferOutput<typeof CreateShareRequestSchema>;

/** 分享记录（管理侧；凭据材料一律不出服务端，只回 has_password） */
export const ShareRecordSchema = v.object({
  id: ShareIdSchema,
  kind: v.picklist(["item", "memo_set"]),
  item_id: v.nullable(v.string()),
  item_title: v.nullable(v.string()),
  item_type: v.nullable(v.string()),
  has_password: v.boolean(),
  expires_at: v.nullable(v.number()),
  created_at: v.number(),
  revoked_at: v.nullable(v.number()),
});
export type ShareRecord = v.InferOutput<typeof ShareRecordSchema>;
export const ShareListResponseSchema = v.object({ shares: v.array(ShareRecordSchema) });
export type ShareListResponse = v.InferOutput<typeof ShareListResponseSchema>;

/** PATCH /api/shares/:id：改密码（传新材料）或清除密码（password: null）、改过期时间 */
export const PatchShareRequestSchema = v.object({
  password: v.optional(v.nullable(SharePasswordMaterialSchema)),
  expires_at: v.optional(v.nullable(v.number())),
});
export type PatchShareRequest = v.InferOutput<typeof PatchShareRequestSchema>;

/** GET /api/public/shares/:sid：访客读状态；失效一律 status:"invalid"，不区分原因（防探测） */
export const PublicShareStatusSchema = v.object({
  status: v.picklist(["ok", "invalid"]),
  requires_password: v.boolean(),
  kind: v.optional(v.picklist(["item", "memo_set"])),
  title: v.optional(v.nullable(v.string())),
  /** 设了密码才给：访客按它派生校验值 */
  kdf: v.optional(ShareKdfSchema),
  salt: v.optional(v.string()),
});
export type PublicShareStatus = v.InferOutput<typeof PublicShareStatusSchema>;

/** POST /api/public/shares/:sid/unlock：提交访客派生的校验值（base64url）；无密码分享可空体 */
export const UnlockRequestSchema = v.object({
  verifier: v.optional(v.string()),
});
export const UnlockResponseSchema = v.object({
  status: v.picklist(["ok", "wrong_password", "invalid"]),
  /** status = ok 才有；放请求头 `X-Menote-Share`，不放 URL（避免进日志与历史记录） */
  token: v.optional(v.string()),
});
export type UnlockResponse = v.InferOutput<typeof UnlockResponseSchema>;

/** GET /api/public/shares/:sid/content：单篇原文（front matter 与正文原样，与备份同一哲学） */
export const ShareContentSchema = v.object({
  kind: v.picklist(["item", "memo_set"]),
  item: v.object({
    id: v.string(),
    type: v.string(),
    title: v.nullable(v.string()),
    body: v.string(),
    updated_at: v.number(),
  }),
});
export type ShareContent = v.InferOutput<typeof ShareContentSchema>;

/** 访问令牌的承载请求头（GET content / att 时携带；不放查询串） */
export const SHARE_TOKEN_HEADER = "X-Menote-Share";

/** PUT /api/admin/share-origin：实例的分享子域（用户 2026-10-02 拍板走实例设置）；null = 清除 */
export const ShareOriginUpdateSchema = v.object({
  origin: v.nullable(
    v.pipe(v.string(), v.regex(/^https?:\/\/[^\s/]+(:\d+)?\/?$/i, "须是 http(s):// 主机形式")),
  ),
});
export type ShareOriginUpdate = v.InferOutput<typeof ShareOriginUpdateSchema>;

/** GET /api/admin/share-origin 与 PUT 的响应；origin 为 null 表示未配置（用当前站点 origin） */
export interface ShareOriginState {
  origin: string | null;
}

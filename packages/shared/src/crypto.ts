/**
 * 隐私锁的**门禁材料契约**（M3；《隐私锁设计》§4）。
 *
 * 只定义"材料长什么样"与"BLOB 怎么打包"，**不做任何加密**——
 * 派生（PBKDF2）、校验（verifier）、包裹与解包（AES-GCM）都在各自端点里用 WebCrypto 完成：
 * 前端在 `apps/web` 的 crypto 模块，服务端只在"重置隐私密码"时解一次 `k_wrapped_backup`。
 *
 * 三条口径：
 * 1. 内容是**明文存储**的，K 只服务**备份出站加密**；解锁不需要 K（设计 §1 的 P1/P2）。
 * 2. 每个 BLOB 自带版本号，将来换算法不用改表：`版本(1B) || IV(12B) || 密文 || GCM 标签(16B)`。
 * 3. 线上编码一律 **base64url**（复用 `base64url.ts`，与登录密钥、会话令牌同一套编码）。
 */
import * as v from "valibot";
import { base64UrlDecode, base64UrlEncode } from "./base64url";

/** KDF 算法（v7.5 统一：取消 Argon2id 与 wasm 依赖） */
export const CRYPTO_KDF = "PBKDF2-SHA-256" as const;

/** KDF 迭代数（写死默认值；表里存实际值，便于将来平滑调整） */
export const CRYPTO_KDF_ITERATIONS = 600_000;

/** 盐长度（字节） */
export const CRYPTO_SALT_BYTES = 16;

/** BLOB 格式版本 */
export const CRYPTO_BLOB_VERSION = 1;

/** AES-GCM 的 IV 与认证标签长度（字节） */
export const CRYPTO_IV_BYTES = 12;
export const CRYPTO_TAG_BYTES = 16;

/** 内容密钥 K 的长度（字节） */
export const CRYPTO_KEY_BYTES = 32;

/** verifier 的明文常量（固定值，用 KEK 加密后即为校验块） */
export const CRYPTO_VERIFIER_PLAINTEXT = "menote-verifier-v1";

/** `版本 + IV` 的头部长度 */
export const CRYPTO_BLOB_HEADER_BYTES = 1 + CRYPTO_IV_BYTES;

/** 两份 K 包裹的长度：1 + 12 + 32 + 16 = 61 */
export const CRYPTO_WRAPPED_BYTES =
  CRYPTO_BLOB_HEADER_BYTES + CRYPTO_KEY_BYTES + CRYPTO_TAG_BYTES;

/** verifier 的长度：1 + 12 + len("menote-verifier-v1") + 16 = 47 */
export const CRYPTO_VERIFIER_BYTES =
  CRYPTO_BLOB_HEADER_BYTES +
  new TextEncoder().encode(CRYPTO_VERIFIER_PLAINTEXT).length +
  CRYPTO_TAG_BYTES;

/** Worker 机密名（架构 §7.2 / §12.4）：包裹 K 的备份凭据，自 M3 起需要 */
export const BACKUP_CRED_KEY_SECRET = "BACKUP_CRED_KEY";

/** 拆开的密文块 */
export interface CryptoBlob {
  version: number;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
  tag: Uint8Array<ArrayBuffer>;
}

/** 打包：`版本(1B) || IV(12B) || 密文 || 标签(16B)` */
export function packCryptoBlob(input: {
  iv: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}): Uint8Array<ArrayBuffer> {
  if (input.iv.length !== CRYPTO_IV_BYTES) {
    throw new Error(`IV 必须是 ${CRYPTO_IV_BYTES} 字节`);
  }
  if (input.tag.length !== CRYPTO_TAG_BYTES) {
    throw new Error(`GCM 标签必须是 ${CRYPTO_TAG_BYTES} 字节`);
  }
  const out = new Uint8Array(CRYPTO_BLOB_HEADER_BYTES + input.ciphertext.length + CRYPTO_TAG_BYTES);
  out[0] = CRYPTO_BLOB_VERSION;
  out.set(input.iv, 1);
  out.set(input.ciphertext, CRYPTO_BLOB_HEADER_BYTES);
  out.set(input.tag, CRYPTO_BLOB_HEADER_BYTES + input.ciphertext.length);
  return out;
}

/** 解包：版本不符或长度不足一律抛错（调用方转成 `invalid`） */
export function unpackCryptoBlob(bytes: Uint8Array): CryptoBlob {
  if (bytes.length < CRYPTO_BLOB_HEADER_BYTES + CRYPTO_TAG_BYTES) {
    throw new Error("密文块长度不足");
  }
  const version = bytes[0] ?? 0;
  if (version !== CRYPTO_BLOB_VERSION) {
    throw new Error(`不支持的密文块版本：${version}`);
  }
  return {
    version,
    iv: bytes.slice(1, CRYPTO_BLOB_HEADER_BYTES),
    ciphertext: bytes.slice(CRYPTO_BLOB_HEADER_BYTES, bytes.length - CRYPTO_TAG_BYTES),
    tag: bytes.slice(bytes.length - CRYPTO_TAG_BYTES),
  };
}

/** base64url 编码 BLOB（线上形态） */
export function cryptoBlobToBase64Url(bytes: Uint8Array): string {
  return base64UrlEncode(bytes);
}

/** base64url 解码 BLOB；非法字符会抛错 */
export function cryptoBlobFromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  return base64UrlDecode(text);
}

const Base64UrlSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]+={0,2}$/));
const IntSchema = v.pipe(v.number(), v.integer());

/** 门禁材料（写入与读取共用；长度校验在服务层按字节做，schema 只管形状） */
export const CryptoMaterialsSchema = v.object({
  kdf: v.literal(CRYPTO_KDF),
  kdf_iterations: v.pipe(IntSchema, v.minValue(100_000), v.maxValue(2_000_000)),
  kdf_salt: Base64UrlSchema,
  verifier: Base64UrlSchema,
  k_wrapped_pw: Base64UrlSchema,
  k_wrapped_backup: Base64UrlSchema,
});
export type CryptoMaterials = v.InferOutput<typeof CryptoMaterialsSchema>;

/** `GET/PUT /api/crypto` 的响应：未启用时 `materials` 为 null */
export const CryptoStateSchema = v.object({
  enabled: v.boolean(),
  materials: v.nullable(CryptoMaterialsSchema),
  rev: IntSchema,
  updated_at: IntSchema,
});
export type CryptoState = v.InferOutput<typeof CryptoStateSchema>;

/**
 * `PUT /api/crypto` 的请求体。
 *
 * `k` 只在**首次启用**时提供：浏览器没有（也不该有）`BACKUP_CRED_KEY`，
 * 所以第二份包裹（供 Worker/重置使用的 `k_wrapped_backup`）由**服务端**用它包出来。
 * 改密 / 重置时浏览器手里已有旧的备份包裹，原样带回来即可，不必再传 K。
 */
export const CryptoWriteSchema = v.object({
  materials: CryptoMaterialsSchema,
  k: v.optional(Base64UrlSchema),
});
export type CryptoWrite = v.InferOutput<typeof CryptoWriteSchema>;

/** `POST /api/crypto/reset` 的响应：明文 K（base64url），浏览器用完即弃 */
export const CryptoResetResponseSchema = v.object({ k: Base64UrlSchema });
export type CryptoResetResponse = v.InferOutput<typeof CryptoResetResponseSchema>;

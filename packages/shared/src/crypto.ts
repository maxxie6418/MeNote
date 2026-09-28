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

/**
 * 备份包裹键的**用途后缀**（域分离）。2026-09-28 起实例只配**一个**根机密 `AUTH_PEPPER`，
 * 备份包裹键由它派生：`SHA-256(AUTH_PEPPER 字节 ‖ 本后缀)`。
 *
 * 为什么要后缀：同一把根机密要供**多个用途**（登录校验走 `HMAC(AUTH_PEPPER, …)`、
 * 分享令牌签名将来也由它派生），加用途后缀才能保证**各用途的钥匙互不可推**——
 * 这不是"把同一个字节串当两把钥匙用"，而是从一个根机密做域分离派生。
 * 后缀里带版本号：将来换派生算法就改它（代价是老包裹解不开，属可预期的一次性迁移）。
 */
export const BACKUP_WRAP_CONTEXT = "menote-backup-wrap-v1";

/**
 * 备份包裹键的**派生输入**：`根机密 ＋ 用途后缀`。
 *
 * 只给"输入"、不在这里做 SHA-256：`packages/shared` 的定位是**纯契约**（不做加密与派生，
 * 见文件头），实际的摘要与导入密钥在 worker 的 `services/crypto.ts` 里做一次。
 * 但**用途后缀必须定义在这里**——它是"同一根机密派生出多把钥匙"这件事的唯一定义处，
 * 将来 M5 的备份导出若要复算同一把键，拿到的也是同一份规则。
 */
export function backupWrapKeyInput(pepper: string): Uint8Array {
  return derivedKeyInput(pepper, BACKUP_WRAP_CONTEXT);
}

/**
 * 通用形态：`根机密 ＋ 用途后缀` 的字节串。
 *
 * 暴露出来是为了让"**域分离**"这条性质可被单测直接钉住（同机密 + 不同用途 → 不同输入），
 * 也给将来的第二个用途（如分享令牌签名）一个现成入口——**不要**各自手拼字符串。
 * 返回类型不写成 `Uint8Array<ArrayBuffer>`：`TextEncoder.encode` 给的是 `ArrayBufferLike`
 * 支撑的视图，而下游（`crypto.subtle.digest`）接受它，硬转反而要多一次无谓复制。
 */
export function derivedKeyInput(secret: string, context: string): Uint8Array {
  return new TextEncoder().encode(`${secret}${context}`);
}

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
 * 写入用的材料形状：与读取相比，`k_wrapped_backup` 是**可选**的——
 * 首次启用时浏览器给的是明文 `k`，第二份包裹由服务端包（见 `CryptoWriteSchema`）。
 */
export const CryptoMaterialsInputSchema = v.object({
  kdf: v.literal(CRYPTO_KDF),
  kdf_iterations: v.pipe(IntSchema, v.minValue(100_000), v.maxValue(2_000_000)),
  kdf_salt: Base64UrlSchema,
  verifier: Base64UrlSchema,
  k_wrapped_pw: Base64UrlSchema,
  k_wrapped_backup: v.optional(Base64UrlSchema),
});
export type CryptoMaterialsInput = v.InferOutput<typeof CryptoMaterialsInputSchema>;

/**
 * `PUT /api/crypto` 的请求体。
 *
 * `k` 只在**首次启用**时提供：浏览器没有（也不该有）根机密 `AUTH_PEPPER`，
 * 所以第二份包裹（供 Worker/重置使用的 `k_wrapped_backup`）由**服务端**用它派生出的
 * 备份包裹键包出来。改密 / 重置时浏览器手里已有旧的备份包裹，原样带回来即可，不必再传 K。
 */
export const CryptoWriteSchema = v.object({
  materials: CryptoMaterialsInputSchema,
  k: v.optional(Base64UrlSchema),
});
export type CryptoWrite = v.InferOutput<typeof CryptoWriteSchema>;

/** `POST /api/crypto/reset` 的响应：明文 K（base64url），浏览器用完即弃 */
export const CryptoResetResponseSchema = v.object({ k: Base64UrlSchema });
export type CryptoResetResponse = v.InferOutput<typeof CryptoResetResponseSchema>;

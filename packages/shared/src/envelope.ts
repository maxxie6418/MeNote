/**
 * 备份出站信封的**字节格式**（架构 §7.3，已定稿 2026-09-26）。
 *
 * 隐私条目的文件在离开系统前套这一层；普通内容默认明文出站。
 *
 * ## 为什么格式在共享包里
 *
 * §7.3 明写「格式连同外部解密工具一并公开，**且每份全量备份包内附一份与格式说明**，
 * 保证"应用没了也能解"」。也就是说这个布局是**长期兼容契约**，不是某个端的实现细节：
 * 写入方（Worker 的 Cron 备份）与将来的读取方（外部解密工具、恢复端）必须是同一份定义。
 * 本包不得依赖浏览器或 Worker 专有 API（架构 §2.3），所以这里**只有布局、没有加解密**——
 * 加解密用 WebCrypto 标准件，由 worker 的 `services/backup-envelope.ts` 做。
 *
 * ## 布局（偏移固定，改动等于换格式）
 *
 * | 偏移 | 长度 | 字段 |
 * |---|---|---|
 * | 0 | 8 | 魔数 `MENOTE1\0` |
 * | 8 | 1 | 格式版本（当前 1） |
 * | 9 | 2 | KDF 迭代数，**以千次为单位**（600 = 600,000） |
 * | 11 | 16 | KDF 盐 |
 * | 27 | 12 | K 包裹块 IV |
 * | 39 | 32 | `AES-GCM(KEK, K)` 密文 |
 * | 71 | 16 | 上面那个块的 GCM 标签 |
 * | 87 | 12 | 内容 IV |
 * | 99 | 可变 | `AES-GCM(K, 明文)` 密文 |
 * | 末尾 | 16 | 内容 GCM 标签 |
 *
 * ## 定稿那句「固定开销 103 字节」与它自己的偏移表对不上，本实现按**表**走
 *
 * 上面的偏移表逐行自洽（每行偏移 = 上一行偏移 + 上一行长度，内容密文止于 99），
 * 加上末尾 16 字节标签，固定开销是 **115**。而 §7.3 结尾那句「固定开销 103 字节」
 * 恰好等于 `87 + 16`——**漏算了偏移 87–98 那 12 字节的内容 IV**。
 *
 * **按偏移表实现**（它是规范的部分、且能自洽；那句总结是一个算错的旁注）。
 * 这条已登记在《M7 定时自动备份实施计划》与 CHANGELOG，**回写定稿时应当改正那句数字**。
 */
import { CRYPTO_IV_BYTES, CRYPTO_SALT_BYTES, CRYPTO_TAG_BYTES } from "./crypto";

/** `MENOTE1\0`（8 字节）。写成字节数组而不是字符串：`"\0"` 在传输与比较里容易被吃掉 */
export const ENVELOPE_MAGIC = new Uint8Array([0x4d, 0x45, 0x4e, 0x4f, 0x54, 0x45, 0x31, 0x00]);
export const ENVELOPE_VERSION = 1;

/** 内容密钥 K 是 32 字节（AES-256），所以 K 包裹块的密文恒为 32 字节 */
export const ENVELOPE_KEY_BYTES = 32;

/** 迭代数在信封里占 2 字节且以"千次"为单位 → 可表示 0–65,535,000 次 */
export const ENVELOPE_ITERATION_UNIT = 1000;
export const ENVELOPE_MAX_ITERATIONS = 65_535 * ENVELOPE_ITERATION_UNIT;

const OFFSET_MAGIC = 0;
const OFFSET_VERSION = 8;
const OFFSET_KDF_ITERATIONS = 9;
const OFFSET_KDF_SALT = 11;
const OFFSET_K_WRAP_IV = 27;
const OFFSET_K_WRAP_CIPHERTEXT = 39;
const OFFSET_K_WRAP_TAG = 71;
const OFFSET_CONTENT_IV = 87;
const OFFSET_CONTENT_CIPHERTEXT = 99;

/** 内容密文的起始偏移（= 最后一个定长字段的末端）。见文件头「103 与偏移表对不上」那条 */
export const ENVELOPE_OVERHEAD_BYTES = OFFSET_CONTENT_CIPHERTEXT;

/** 固定开销的真实值 = 内容密文起点 + 末尾标签。见文件头同一条 */
export const ENVELOPE_FIXED_BYTES = ENVELOPE_OVERHEAD_BYTES + CRYPTO_TAG_BYTES;

export interface EnvelopeParts {
  version: number;
  /** **真实的**迭代次数（已乘回 1000），不是信封里那个"千次"的数 */
  kdfIterations: number;
  kdfSalt: Uint8Array<ArrayBuffer>;
  kWrapIv: Uint8Array<ArrayBuffer>;
  kWrapCiphertext: Uint8Array<ArrayBuffer>;
  kWrapTag: Uint8Array<ArrayBuffer>;
  contentIv: Uint8Array<ArrayBuffer>;
  contentCiphertext: Uint8Array<ArrayBuffer>;
  contentTag: Uint8Array<ArrayBuffer>;
}

/** 逐字段按定长校验，**不静默修正**——长度不对就是有东西被改过或拼错了 */
function assertSized(name: string, bytes: Uint8Array, expected: number): void {
  if (bytes.length !== expected) {
    throw new Error(`信封字段 ${name} 长度应为 ${expected}，实际 ${bytes.length}`);
  }
}

function slice(
  bytes: Uint8Array,
  start: number,
  length: number,
): Uint8Array<ArrayBuffer> {
  return bytes.slice(start, start + length) as Uint8Array<ArrayBuffer>;
}

/** 解析信封。魔数 / 版本 / 定长字段任一不过就**抛错**（半截包按完整包处理是最糟的） */
export function parseBackupEnvelope(bytes: Uint8Array): EnvelopeParts {
  if (bytes.length < ENVELOPE_OVERHEAD_BYTES + CRYPTO_TAG_BYTES) {
    throw new Error(`信封长度不足：${bytes.length} 字节`);
  }
  for (let i = 0; i < ENVELOPE_MAGIC.length; i += 1) {
    if (bytes[OFFSET_MAGIC + i] !== ENVELOPE_MAGIC[i]) {
      throw new Error("不是 Menote 备份信封：魔数不匹配");
    }
  }
  const version = bytes[OFFSET_VERSION] ?? 0;
  if (version !== ENVELOPE_VERSION) {
    throw new Error(`不支持的信封版本：${version}（当前 ${ENVELOPE_VERSION}）`);
  }
  const kdfIterations = readUint16(bytes, OFFSET_KDF_ITERATIONS) * ENVELOPE_ITERATION_UNIT;
  if (kdfIterations === 0) throw new Error("信封里的 KDF 迭代数为 0");

  const contentIv = slice(bytes, OFFSET_CONTENT_IV, CRYPTO_IV_BYTES);
  const contentCiphertext = slice(bytes, OFFSET_CONTENT_CIPHERTEXT, bytes.length - OFFSET_CONTENT_CIPHERTEXT - CRYPTO_TAG_BYTES);
  if (contentCiphertext.length === 0) {
    throw new Error("信封里没有内容密文（明文为空）");
  }
  return {
    version,
    kdfIterations,
    kdfSalt: slice(bytes, OFFSET_KDF_SALT, CRYPTO_SALT_BYTES),
    kWrapIv: slice(bytes, OFFSET_K_WRAP_IV, CRYPTO_IV_BYTES),
    kWrapCiphertext: slice(bytes, OFFSET_K_WRAP_CIPHERTEXT, ENVELOPE_KEY_BYTES),
    kWrapTag: slice(bytes, OFFSET_K_WRAP_TAG, CRYPTO_TAG_BYTES),
    contentIv,
    contentCiphertext,
    contentTag: slice(bytes, bytes.length - CRYPTO_TAG_BYTES, CRYPTO_TAG_BYTES),
  };
}

/** 按布局拼出信封。字段长度不对直接抛——写坏的信封比不写信封糟 */
export function packBackupEnvelope(parts: EnvelopeParts): Uint8Array<ArrayBuffer> {
  if (parts.version !== ENVELOPE_VERSION) {
    throw new Error(`不支持的信封版本：${parts.version}`);
  }
  const unit = Math.trunc(parts.kdfIterations / ENVELOPE_ITERATION_UNIT);
  if (unit <= 0 || unit > 0xffff) {
    throw new Error(`KDF 迭代数 ${parts.kdfIterations} 装不进信封的 2 字节字段`);
  }
  if (unit * ENVELOPE_ITERATION_UNIT !== parts.kdfIterations) {
    throw new Error(`KDF 迭代数 ${parts.kdfIterations} 不是 1000 的整数倍，信封存不下`);
  }
  assertSized("KDF 盐", parts.kdfSalt, CRYPTO_SALT_BYTES);
  assertSized("K 包裹块 IV", parts.kWrapIv, CRYPTO_IV_BYTES);
  assertSized("K 包裹块密文", parts.kWrapCiphertext, ENVELOPE_KEY_BYTES);
  assertSized("K 包裹块标签", parts.kWrapTag, CRYPTO_TAG_BYTES);
  assertSized("内容 IV", parts.contentIv, CRYPTO_IV_BYTES);
  assertSized("内容标签", parts.contentTag, CRYPTO_TAG_BYTES);
  if (parts.contentCiphertext.length === 0) {
    throw new Error("内容密文为空：明文不能是空串");
  }

  const total = OFFSET_CONTENT_CIPHERTEXT + parts.contentCiphertext.length + CRYPTO_TAG_BYTES;
  const out = new Uint8Array(total);
  out.set(ENVELOPE_MAGIC, OFFSET_MAGIC);
  out[OFFSET_VERSION] = parts.version;
  writeUint16(out, OFFSET_KDF_ITERATIONS, unit);
  out.set(parts.kdfSalt, OFFSET_KDF_SALT);
  out.set(parts.kWrapIv, OFFSET_K_WRAP_IV);
  out.set(parts.kWrapCiphertext, OFFSET_K_WRAP_CIPHERTEXT);
  out.set(parts.kWrapTag, OFFSET_K_WRAP_TAG);
  out.set(parts.contentIv, OFFSET_CONTENT_IV);
  out.set(parts.contentCiphertext, OFFSET_CONTENT_CIPHERTEXT);
  out.set(parts.contentTag, OFFSET_CONTENT_CIPHERTEXT + parts.contentCiphertext.length);
  return out;
}

/** 大端 16 位无符号（`DataView` 只在这两处用，不值得为它留一个长期依赖） */
function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) * 256 + (bytes[offset + 1] ?? 0);
}

function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = Math.floor(value / 256) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

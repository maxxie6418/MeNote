/**
 * 隐私锁的浏览器端原语（M3；《隐私锁设计》§4/§6.6）。
 *
 * 只做三件事，全部用 WebCrypto 标准件（PBKDF2-SHA-256 + AES-256-GCM），**不引任何三方库**：
 * 1. 从隐私密码派生 KEK（PBKDF2，600k 次，只在解锁那一刻跑一次）；
 * 2. 用 KEK 造 / 校验 `verifier`（对固定常量的 AES-GCM 块）——**校验完全在本地**，服务端不参与；
 * 3. 用 KEK 包裹 / 解包内容密钥 K（K 只服务备份出站加密，解锁不需要它）。
 *
 * 注意本文件**不碰网**、不读 Dexie：它是一组纯函数，调用方（`model.ts` 与设置页）负责取材料、存缓存。
 */
import {
  CRYPTO_IV_BYTES,
  CRYPTO_KEY_BYTES,
  CRYPTO_KDF,
  CRYPTO_KDF_ITERATIONS,
  CRYPTO_SALT_BYTES,
  CRYPTO_TAG_BYTES,
  CRYPTO_VERIFIER_PLAINTEXT,
  cryptoBlobFromBase64Url,
  cryptoBlobToBase64Url,
  packCryptoBlob,
  unpackCryptoBlob,
} from "@menote/shared";

/** 当前实现的 KDF 参数（写材料时用；读取时以材料里的为准） */
export const KDF_DEFAULTS = {
  kdf: CRYPTO_KDF,
  iterations: CRYPTO_KDF_ITERATIONS,
  saltBytes: CRYPTO_SALT_BYTES,
} as const;

const textEncoder = new TextEncoder();

/**
 * UTF-8 → 字节。
 *
 * **不能直接用 `textEncoder.encode(...)` 的返回类型**：它是 `Uint8Array<ArrayBufferLike>`，
 * 而 WebCrypto 的 `BufferSource` 只接受 `ArrayBufferView<ArrayBuffer>`（仓库里 `base64url.ts`
 * 踩过同一个坑）。这里显式拷进一个以 ArrayBuffer 为底的视图。
 */
function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(textEncoder.encode(text));
}

export function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(CRYPTO_SALT_BYTES));
}

/** 内容密钥 K：32 字节随机（普通字节，不是 CryptoKey） */
export function randomContentKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(CRYPTO_KEY_BYTES));
}

/**
 * 隐私密码 → KEK。
 *
 * `iterations` 由材料给出（服务端存的是当时用的值），这样将来调参数也不影响老账号解锁。
 */
export async function deriveKek(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number = KDF_DEFAULTS.iterations,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** 用 KEK 对一段明文做 AES-GCM 并打包成线上形态（base64url） */
async function seal(
  plain: Uint8Array<ArrayBuffer>,
  kek: CryptoKey,
  aad?: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(CRYPTO_IV_BYTES));
  const alg =
    aad === undefined
      ? { name: "AES-GCM", iv, tagLength: 128 }
      : { name: "AES-GCM", iv, tagLength: 128, additionalData: utf8(aad) };
  const sealed = new Uint8Array(await crypto.subtle.encrypt(alg, kek, plain));
  return cryptoBlobToBase64Url(
    packCryptoBlob({
      iv,
      ciphertext: sealed.slice(0, sealed.length - CRYPTO_TAG_BYTES),
      tag: sealed.slice(sealed.length - CRYPTO_TAG_BYTES),
    }),
  );
}

/** 解开线上形态的密文块；AAD 不一致或标签不对会抛错 */
async function open(
  packed: string,
  kek: CryptoKey,
  aad?: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const blob = unpackCryptoBlob(cryptoBlobFromBase64Url(packed));
  const payload = new Uint8Array(blob.ciphertext.length + blob.tag.length);
  payload.set(blob.ciphertext, 0);
  payload.set(blob.tag, blob.ciphertext.length);
  const alg =
    aad === undefined
      ? { name: "AES-GCM", iv: blob.iv, tagLength: 128 }
      : { name: "AES-GCM", iv: blob.iv, tagLength: 128, additionalData: utf8(aad) };
  return new Uint8Array(await crypto.subtle.decrypt(alg, kek, payload));
}

/** 造 verifier：KEK 加密固定常量（服务端只存这块，解不出密码本身） */
export async function makeVerifier(kek: CryptoKey): Promise<string> {
  return seal(utf8(CRYPTO_VERIFIER_PLAINTEXT), kek, CRYPTO_VERIFIER_PLAINTEXT);
}

/** 校验隐私密码：解开 verifier 并逐字节比对常量（失败一律返回 false） */
export async function verifyPassword(kek: CryptoKey, verifier: string): Promise<boolean> {
  try {
    const plain = await open(verifier, kek, CRYPTO_VERIFIER_PLAINTEXT);
    const expected = utf8(CRYPTO_VERIFIER_PLAINTEXT);
    if (plain.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) {
      diff |= (plain[i] ?? 0) ^ (expected[i] ?? 0);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

/** 用 KEK 包裹内容密钥 K（改密时重做这一步，K 本身不变） */
export async function wrapContentKey(
  key: Uint8Array<ArrayBuffer>,
  kek: CryptoKey,
): Promise<string> {
  return seal(key, kek, CRYPTO_VERIFIER_PLAINTEXT);
}

/** 解包内容密钥 K（备份导出时才需要；解锁不需要） */
export async function unwrapContentKey(
  wrapped: string,
  kek: CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await open(wrapped, kek, CRYPTO_VERIFIER_PLAINTEXT);
  if (key.length !== CRYPTO_KEY_BYTES) {
    throw new Error("内容密钥长度不合法");
  }
  return key;
}

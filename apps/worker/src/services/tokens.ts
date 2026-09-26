/**
 * 令牌与哈希原语（口径见 `docs/modules/Menote-认证与会话设计-v1.md` §2、§3.1）。
 *
 * 关键约束：慢哈希（PBKDF2）只在浏览器做；服务端只做**一次 HMAC-SHA-256** 比对。
 * 免费版 Worker 每请求 10 ms CPU，跑不动 PBKDF2 / Argon2（需求 §5.4）。
 */
import { SESSION_TOKEN_BYTES, base64UrlDecode, base64UrlEncode } from "@menote/shared";
import { DomainError } from "../errors";

const textEncoder = new TextEncoder();

/** prelogin 假盐的域分隔前缀：换算法/换语义时改版本号即可 */
const PRELOGIN_SALT_LABEL = "menote-prelogin-v1:";

/** 登录密钥字节数（= KDF 的 dkLen；两端约定 32 字节） */
const LOGIN_KEY_BYTES = 32;

/** 生成会话令牌（32 字节随机，base64url；库里只存它的 SHA-256） */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(SESSION_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** 随机盐（注册与改密用），返回原始字节与 base64url 两种形态 */
export function generateSalt(bytes: number): { raw: ArrayBuffer; base64Url: string } {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return { raw: buffer.buffer as ArrayBuffer, base64Url: base64UrlEncode(buffer) };
}

export async function sha256(data: Uint8Array): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", data);
}

/** 会话令牌 → 库中存的 SHA-256；令牌非法（非 base64url）时返回 null，不抛错 */
export async function hashSessionToken(token: string): Promise<ArrayBuffer | null> {
  try {
    return await sha256(base64UrlDecode(token));
  } catch {
    return null;
  }
}

/** 解码并校验登录密钥（必须是 32 字节的 base64url） */
export function decodeLoginKey(loginKey: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = base64UrlDecode(loginKey);
  } catch {
    throw new DomainError("invalid", "登录密钥格式不合法");
  }
  if (bytes.length !== LOGIN_KEY_BYTES) {
    throw new DomainError("invalid", "登录密钥长度不合法");
  }
  return bytes;
}

/** `HMAC-SHA256(AUTH_PEPPER, data)`：pepper 按其 UTF-8 字节作为密钥 */
export async function hmacSha256(pepper: string, data: Uint8Array): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, data);
}

/** `auth_verifier = HMAC-SHA256(AUTH_PEPPER, 登录密钥字节)`（需求 §5.4 第 3 条） */
export async function deriveAuthVerifier(pepper: string, loginKey: string): Promise<ArrayBuffer> {
  return hmacSha256(pepper, decodeLoginKey(loginKey));
}

/**
 * 不存在的用户名也要给出**确定性假盐**（需求 §5.4 第 1 条），避免借 prelogin 探测用户名是否存在。
 * 与真实盐同长度、同编码，客户端无法区分。
 */
export async function deriveFakeSalt(pepper: string, username: string, saltBytes: number): Promise<ArrayBuffer> {
  const digest = await hmacSha256(pepper, textEncoder.encode(PRELOGIN_SALT_LABEL + username.toLowerCase()));
  return digest.slice(0, saltBytes);
}

/**
 * 常量时间字节比较（WebCrypto 没有 `timingSafeEqual`）。
 * 长度不等直接返回 false；长度相同则逐字节 XOR 累加后判零——**不用 `===` 比 Buffer/字符串**。
 */
export function timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/** ArrayBuffer → base64url（prelogin 返回盐、测试断言用） */
export function toBase64Url(buffer: ArrayBuffer): string {
  return base64UrlEncode(new Uint8Array(buffer));
}

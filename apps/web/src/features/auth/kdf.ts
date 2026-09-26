/**
 * 登录密钥派生（口径见 `docs/modules/Menote-认证与会话设计-v1.md` §2）。
 *
 * **慢哈希只在浏览器做**：免费版 Worker 每请求 10 ms CPU，跑不动 PBKDF2；服务端只做一次 HMAC。
 * 输出为 base64url，直接作为 `login_key` 提交。
 */
import {
  LOGIN_KDF_DEFAULT,
  base64UrlDecode,
  base64UrlEncode,
  type AuthKdfParams,
} from "@menote/shared";

export async function deriveLoginKey(
  password: string,
  saltBase64Url: string,
  kdf: AuthKdfParams = LOGIN_KDF_DEFAULT,
): Promise<string> {
  const salt = base64UrlDecode(saltBase64Url);
  const passwordBytes = new TextEncoder().encode(password);

  const baseKey = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: kdf.iterations, hash: "SHA-256" },
    baseKey,
    kdf.dkLen * 8,
  );

  return base64UrlEncode(new Uint8Array(bits));
}

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
  // 非安全上下文（http 打开的页面）里浏览器不提供 WebCrypto：必须给出人话解释，
  // 而不是让用户看到 "Cannot read properties of undefined (reading 'importKey')"。
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error(
      "当前页面不是安全连接（http），浏览器不提供加密能力，无法登录或注册。请改用 https 打开本应用。",
    );
  }

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

/**
 * 内容哈希：正文的 SHA-256（架构 §6.1：`content_hash` 由客户端计算，服务端不重算）。
 *
 * 十六进制小写。两端可用（WebCrypto 在浏览器与 Worker 都提供）。
 */

const HEX = "0123456789abcdef";

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (const byte of bytes) {
    out += HEX[byte >> 4];
    out += HEX[byte & 0x0f];
  }
  return out;
}

/** `SHA-256(text)` 的十六进制小写形式 */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  // 非安全上下文（用 http 打开的页面）里浏览器**不提供** WebCrypto：给一句能指导行动的错误，
  // 而不是让调用方收到 "Cannot read properties of undefined"（M1 云端实测踩到）
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("当前环境不支持 WebCrypto（需要 https 或 localhost），无法计算内容摘要");
  }
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

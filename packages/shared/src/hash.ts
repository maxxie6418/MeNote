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
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

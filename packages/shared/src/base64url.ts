/**
 * base64url 编解码（无填充）。两端共用：Worker 解析 `X-Menote-Meta` 与登录密钥，
 * 前端生成它们；会话令牌也用它编码。
 *
 * 纯函数，不依赖浏览器或 Worker 专有 API（架构 §2.3：`packages/*` 必须两端可跑、可单测）。
 * 只接受 base64url 字母表（`-` `_`），容忍尾部 `=`。
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const REVERSE: ReadonlyMap<string, number> = new Map(
  [...ALPHABET].map((char, index) => [char, index] as const),
);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** 字节 → base64url（无填充） */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);

    out += ALPHABET[(triple >> 18) & 63];
    out += ALPHABET[(triple >> 12) & 63];
    if (b1 === undefined) break;
    out += ALPHABET[(triple >> 6) & 63];
    if (b2 === undefined) break;
    out += ALPHABET[triple & 63];
  }
  return out;
}

/** base64url → 字节；含非法字符时抛错（不静默丢弃）。
 *  返回类型显式写成 `Uint8Array<ArrayBuffer>`：WebCrypto 的 `BufferSource` 不接受 `ArrayBufferLike` 版本。 */
export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.endsWith("=") ? text.replace(/=+$/, "") : text;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of clean) {
    const value = REVERSE.get(char);
    if (value === undefined) {
      throw new Error(`base64url 含非法字符：${char}`);
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** UTF-8 文本 → base64url */
export function base64UrlEncodeUtf8(text: string): string {
  return base64UrlEncode(textEncoder.encode(text));
}

/** base64url → UTF-8 文本 */
export function base64UrlDecodeUtf8(text: string): string {
  return textDecoder.decode(base64UrlDecode(text));
}

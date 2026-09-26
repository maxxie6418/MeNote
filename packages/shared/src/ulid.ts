/**
 * ULID 生成与解析（需求 §18.1：主键为时间有序的 UUIDv7 / ULID，客户端或服务端生成）。
 *
 * 选 ULID 而不是 UUIDv4：**字典序 = 时间序**，D1 主键与索引局部性好，调试时也能一眼看出先后。
 * 同一毫秒内不保证单调（随机部分独立），本项目不需要该性质——唯一性由 80 位随机保证。
 *
 * 纯函数 + WebCrypto 随机源，两端可用。
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const ULID_LENGTH = TIME_CHARS + RANDOM_CHARS;
/** 时间部分的编码基数：32^10 毫秒 ≈ 公元 10889 年 */
const TIME_MODULO = 32;

/** 生成一个 ULID（26 个 Crockford base32 字符） */
export function newUlid(now: number = Date.now()): string {
  let remaining = Math.floor(now);
  let time = "";
  for (let i = 0; i < TIME_CHARS; i += 1) {
    time = CROCKFORD[remaining % TIME_MODULO] + time;
    remaining = Math.floor(remaining / TIME_MODULO);
  }

  const bytes = new Uint8Array(RANDOM_CHARS);
  crypto.getRandomValues(bytes);
  let random = "";
  for (const byte of bytes) {
    random += CROCKFORD[byte % TIME_MODULO];
  }

  return time + random;
}

/** 是否为本项目生成的 ULID（长度与字母表都校验，排除易混字符 I/L/O/U） */
export function isUlid(value: string): boolean {
  if (value.length !== ULID_LENGTH) return false;
  for (const char of value) {
    if (!CROCKFORD.includes(char)) return false;
  }
  return true;
}

/** 从 ULID 解出毫秒时间戳；非法输入返回 null */
export function ulidTime(value: string): number | null {
  if (!isUlid(value)) return null;
  let time = 0;
  for (let i = 0; i < TIME_CHARS; i += 1) {
    const index = CROCKFORD.indexOf(value[i] ?? "");
    if (index < 0) return null;
    time = time * TIME_MODULO + index;
  }
  return time;
}

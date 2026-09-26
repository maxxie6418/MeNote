/**
 * 文本计量：UTF-8 字节数与码点数。
 *
 * 为什么要"码点"而不是 `String.length`：JS 按 UTF-16 编码单元计数，emoji 等辅助平面字符
 * 占 2 个单元却是 1 个码点；而 SQLite 的 `substr()` / `length()` 按码点计数。两端必须用同一
 * 口径，否则增量补丁的位置会错位（需求 §15.7）。
 */

/** 服务端/客户端一致的"当前正文大小"：UTF-8 字节数（硬上限比的就是它） */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** 码点数（代理对算 1）；不分配中间数组，1.9 MB 正文也只扫一遍 */
export function countCodePoints(text: string): number {
  let count = text.length;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      count -= 1;
      i += 1;
    }
  }
  return count;
}

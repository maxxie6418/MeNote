/** 隐私锁页的私有小工具（拆文件后两边都要用，避免各写一份） */

/** 从错误里取一句"能读懂的话"：服务端给了 message 就用它，否则给兜底文案 */
export function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

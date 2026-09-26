/**
 * 同步主标签页选举（架构 §6.4：`navigator.locks.request('menote-sync')`）。
 *
 * 所有标签页都可以写本地库与 outbox，但只有主标签页上传与拉取——否则两个标签页会互相覆盖。
 * 不支持 Web Locks 的环境（老浏览器、Node 测试）退化为直接执行：单标签页场景下行为一致。
 */
const SYNC_LOCK = "menote-sync";

export function hasWebLocks(): boolean {
  return typeof navigator !== "undefined" && "locks" in navigator;
}

/**
 * 尝试以"同步主标签页"身份执行 `fn`。
 * 拿不到锁（另一个标签页正在同步）时返回 `null`，**不排队等待**——下一次触发会再试。
 */
export async function withSyncLock<T>(fn: () => Promise<T>): Promise<T | null> {
  if (!hasWebLocks()) return fn();

  return navigator.locks.request(SYNC_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) return null;
    return fn();
  });
}

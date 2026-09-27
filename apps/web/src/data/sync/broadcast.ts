/**
 * 跨标签页广播（架构 §6.6；M2-9、需求 §15）。
 *
 * 用途：同一账号开了多个标签页时，A 页写入/同步完要**通知 B 页刷新**，否则 B 页的列表、计数、
 * 草稿状态会一直停在旧值，用户在 B 页继续编辑就容易"以为没冲突"。
 *
 * 两条工程约束：
 * 1. **环境可能没有 BroadcastChannel**（老浏览器、测试用的 jsdom）——此时退化成空实现，
 *    功能降级但不报错；工厂可注入，便于单测。
 * 2. **不带用户内容**：广播里只放"哪条变了""游标推到哪"，不放正文/标题——它是进程间通知，
 *    不是数据通道；数据一律走本地库 + 同步。M3 的隐私事件同样只带**档位 / 到期时刻 / 条目 id**，
 *    绝不放隐私内容。
 */
import type { PrivacyTier } from "../../features/privacy/model";

export type SyncBroadcastEvent =
  /** 某条目在别的标签页被改过（编辑器据此提示，不静默覆盖） */
  | { kind: "item-updated"; itemId: string }
  /** 游标已推进：本地库可能有新数据，值得刷新一次 */
  | { kind: "cursor-advanced"; cursor: number }
  /**
   * 别的标签页打开了范围门禁（M3）：本页要跟着解锁，否则"同一浏览器会话"档位形同虚设。
   * **只带档位与到期时刻，不带任何内容**。
   */
  | { kind: "privacy-unlocked"; tier: PrivacyTier; expiresAt: number | null }
  /** 别的标签页锁上了（手动锁定 / 到期 / 关闭此设备） */
  | { kind: "privacy-locked" }
  /** 别的标签页逐篇解密了某条目 */
  | { kind: "privacy-item-unlocked"; itemId: string }
  /** 别的标签页锁上了某条目 */
  | { kind: "privacy-item-locked"; itemId: string }
  /**
   * 新标签页加入：问一次"现在解锁着吗"（`privacy-state-request`）。
   * 老标签页收到后回一条 `privacy-unlocked`；**没人回就说明本次会话还没解锁**，
   * 与"所有 Menote 标签页关闭即锁"一致（设计 §5.2）。
   */
  | { kind: "privacy-state-request" };

/** 广播通道名：同一浏览器内同源共享，所以带上前缀避免与其它应用撞名 */
export const SYNC_CHANNEL_NAME = "menote-sync-v1";

/** 底层通道的最小接口（导出是为了让测试能注入替身） */
export interface ChannelLike {
  postMessage(data: unknown): void;
  close(): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

export interface SyncChannel {
  post(event: SyncBroadcastEvent): void;
  subscribe(handler: (event: SyncBroadcastEvent) => void): () => void;
  close(): void;
}

export interface SyncChannelOptions {
  /** 便于测试注入替身；返回 null 表示该环境不支持 */
  createChannel?: (name: string) => ChannelLike | null;
}

function defaultFactory(name: string): ChannelLike | null {
  const Ctor = (globalThis as { BroadcastChannel?: new (name: string) => ChannelLike })
    .BroadcastChannel;
  if (typeof Ctor !== "function") return null;
  try {
    return new Ctor(name);
  } catch {
    // 某些环境（隐私模式、跨源隔离）构造会抛：降级为空实现
    return null;
  }
}

/** 只认自己发的那种消息形状（别的脚本也可能往同名通道里发东西） */
function parseEvent(data: unknown): SyncBroadcastEvent | null {
  if (typeof data !== "object" || data === null) return null;
  const event = data as {
    kind?: unknown;
    itemId?: unknown;
    cursor?: unknown;
    tier?: unknown;
    expiresAt?: unknown;
  };
  if (event.kind === "item-updated" && typeof event.itemId === "string") {
    return { kind: "item-updated", itemId: event.itemId };
  }
  if (event.kind === "cursor-advanced" && typeof event.cursor === "number") {
    return { kind: "cursor-advanced", cursor: event.cursor };
  }
  if (
    event.kind === "privacy-unlocked" &&
    (event.tier === "minutes" || event.tier === "session" || event.tier === "device") &&
    (typeof event.expiresAt === "number" || event.expiresAt === null)
  ) {
    return { kind: "privacy-unlocked", tier: event.tier, expiresAt: event.expiresAt };
  }
  if (event.kind === "privacy-locked" || event.kind === "privacy-state-request") {
    return { kind: event.kind };
  }
  if (
    (event.kind === "privacy-item-unlocked" || event.kind === "privacy-item-locked") &&
    typeof event.itemId === "string"
  ) {
    return { kind: event.kind, itemId: event.itemId };
  }
  return null;
}

export function createSyncChannel(options: SyncChannelOptions = {}): SyncChannel {
  const factory = options.createChannel ?? defaultFactory;
  const channel = factory(SYNC_CHANNEL_NAME);

  if (!channel) {
    return {
      post: () => undefined,
      subscribe: () => () => undefined,
      close: () => undefined,
    };
  }

  return {
    post(event) {
      try {
        channel.postMessage(event);
      } catch {
        // 通道可能在关闭后收到消息（页面卸载竞态）：忽略，不该让同步失败
      }
    },
    subscribe(handler) {
      const listener = (message: { data: unknown }): void => {
        const event = parseEvent(message.data);
        if (event) handler(event);
      };
      channel.addEventListener("message", listener);
      return () => channel.removeEventListener("message", listener);
    },
    close() {
      try {
        channel.close();
      } catch {
        // 忽略重复关闭
      }
    },
  };
}

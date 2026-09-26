/**
 * 同步引擎编排（拆解 M13-02/13-03；设计稿《同步引擎设计》§4.2/§4.3/§4.4）。
 *
 * 一次运行 = 抢到同步主标签页锁 → 推送 outbox → 拉取增量。
 * 触发时机：应用打开、写入成功后（`notifyLocalWrite`）、标签页重新可见、网络恢复、前台每 5 分钟。
 * 不做实时推送（需求 §15.2）。
 */
import { SYNC_FOREGROUND_INTERVAL_MS } from "@menote/shared";
import { outboxCount } from "../db";
import { withSyncLock } from "./leader";
import { pullOnce, type PullApi, type PullResult } from "./pull";
import { pushQueue, type PushApi, type PushBatchResult } from "./push";

export type SyncStatus = "idle" | "syncing" | "offline" | "error";

export interface SyncEngineOptions {
  api?: PushApi;
  pullApi?: PullApi;
  now?: () => number;
  random?: () => number;
  deviceLabel?: string | null;
  onStatus?: (status: SyncStatus) => void;
}

export interface SyncRunResult {
  ran: boolean;
  pushed?: PushBatchResult;
  pulled?: PullResult;
  reason?: "busy" | "not-leader" | "offline" | "error";
  error?: string;
}

export interface SyncEngine {
  runOnce(): Promise<SyncRunResult>;
  /** 本地写入成功后调用：短暂防抖后触发一次同步 */
  notifyLocalWrite(): void;
  start(): void;
  stop(): void;
  pendingCount(): Promise<number>;
}

/** 写入成功后的防抖：把连续几次输入合并成一次同步 */
const WRITE_TRIGGER_DELAY_MS = 300;

export function createSyncEngine(options: SyncEngineOptions = {}): SyncEngine {
  const now = options.now ?? Date.now;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let started = false;

  async function runOnce(): Promise<SyncRunResult> {
    if (running) return { ran: false, reason: "busy" };
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      options.onStatus?.("offline");
      return { ran: false, reason: "offline" };
    }

    running = true;
    options.onStatus?.("syncing");
    try {
      const outcome = await withSyncLock(async () => {
        const pushed = await pushQueue({
          api: options.api,
          now,
          random: options.random,
          deviceLabel: options.deviceLabel,
        });
        const pulled = await pullOnce(options.pullApi, now);
        return { pushed, pulled };
      });

      if (!outcome) {
        // 另一个标签页正在同步：不必报错，等下一次触发
        options.onStatus?.("idle");
        return { ran: false, reason: "not-leader" };
      }

      options.onStatus?.("idle");
      return { ran: true, pushed: outcome.pushed, pulled: outcome.pulled };
    } catch (error) {
      options.onStatus?.("error");
      return {
        ran: false,
        reason: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      running = false;
    }
  }

  function schedule(delayMs: number): void {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void runOnce();
    }, delayMs);
  }

  function onOnline(): void {
    schedule(0);
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === "visible") schedule(0);
  }

  return {
    runOnce,

    notifyLocalWrite(): void {
      schedule(WRITE_TRIGGER_DELAY_MS);
    },

    start(): void {
      if (started) return;
      started = true;
      schedule(0); // 应用打开

      if (typeof window === "undefined") return; // 非浏览器环境（测试）不挂监听
      window.addEventListener("online", onOnline);
      document.addEventListener("visibilitychange", onVisibilityChange);
      interval = setInterval(() => schedule(0), SYNC_FOREGROUND_INTERVAL_MS);
    },

    stop(): void {
      started = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    },

    pendingCount: () => outboxCount(),
  };
}

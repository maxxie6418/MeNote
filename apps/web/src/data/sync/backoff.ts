/**
 * 退避计算（需求 §15.3：1/2/4/8… 秒指数退避加抖动，最长 60 秒）。
 *
 * 抽成纯函数是为了可测：抖动来自 `random` 参数，测试里传固定值即可断言确切序列。
 */
import { OUTBOX_MAX_BACKOFF_MS } from "@menote/shared";

/** 指数退避的底数：第 1 次重试等 1 秒，第 2 次 2 秒，以此类推 */
const BASE_BACKOFF_MS = 1_000;

/** 抖动幅度：±20%（避免多设备同时重试撞在一起） */
const JITTER_RATIO = 0.2;

/**
 * 第 `retries` 次失败后的等待时长（`retries` 从 1 开始）。
 * 指数部分先封顶 60 秒，再叠加 ±20% 抖动；最后再兜一次 60 秒上限，保证**永远不超过 60 秒**。
 */
export function backoffDelayMs(retries: number, random: () => number = Math.random): number {
  const attempt = Math.max(1, Math.floor(retries));
  const capped = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), OUTBOX_MAX_BACKOFF_MS);
  const jitter = 1 + (random() * 2 - 1) * JITTER_RATIO;
  return Math.round(Math.min(capped * jitter, OUTBOX_MAX_BACKOFF_MS));
}

/**
 * "上传失败"列表用的哨兵时间：把该行排到队尾且**不再被队首选中**，
 * 于是它不会阻塞队列里的其他项，界面仍能在 `listOutbox()` 里看到它与 `last_error`。
 */
export const FAILED_RETRY_AT = Number.MAX_SAFE_INTEGER;

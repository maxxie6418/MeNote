/**
 * 跨端共享的上限与阈值常量（架构 §2.3：`packages/shared` 放"常量（上限、阈值）"）。
 *
 * 每个常量都注明来源；实现处**不要**再写裸数字。改这里等于改两端行为。
 */

/** 正文硬上限：UTF-8 字节数（需求 §10.10；D1 单行上限 2,000,000 由 DB CHECK 兜底） */
export const BODY_HARD_LIMIT_BYTES = 1_900_000;

/** 正文软上限：超过即变色提示"建议拆分为多篇"，仍可保存（需求 §10.10，显示为 1 MB） */
export const BODY_SOFT_LIMIT_BYTES = 1_048_576;

/** 大文档阈值：超过后自动保存防抖放宽为 5s / 60s（需求 §15.7） */
export const LARGE_DOC_THRESHOLD_BYTES = 262_144;

/** 自动保存：停止输入后的防抖（需求 §12.1） */
export const AUTOSAVE_IDLE_MS = 2_000;
/** 自动保存：持续输入时的最长间隔（需求 §12.1） */
export const AUTOSAVE_MAX_MS = 30_000;
/** 大文档的防抖（需求 §12.1、§15.7） */
export const AUTOSAVE_LARGE_IDLE_MS = 5_000;
/** 大文档的最长间隔（需求 §12.1、§15.7） */
export const AUTOSAVE_LARGE_MAX_MS = 60_000;
/** 本地草稿写入间隔：与上传节奏无关，恒为 2 秒（拆解 M04-04） */
export const DRAFT_WRITE_INTERVAL_MS = 2_000;

/** 增量拉取每类最多返回的行数（架构 §6.1） */
export const SYNC_PAGE_LIMIT = 200;
/** 单次 D1 batch（含 `POST /api/batch`）允许的语句数上限（架构 §5.1/§6.1、§14） */
export const BATCH_STATEMENT_LIMIT = 45;
/** 前台定时同步间隔（设计稿《同步引擎设计》§7 定为 5 分钟） */
export const SYNC_FOREGROUND_INTERVAL_MS = 300_000;

/** 单次 API 请求超时（需求 §15.3：15 秒） */
export const REQUEST_TIMEOUT_MS = 15_000;
/** outbox 指数退避上限（需求 §15.3：最长 60 秒） */
export const OUTBOX_MAX_BACKOFF_MS = 60_000;

/** 会话滑动有效期：30 天（需求 §5.4） */
export const SESSION_TTL_MS = 2_592_000_000;
/** `sessions.last_seen_at` 最长写入间隔：每天最多一次（需求 §5.4，避免每请求写库） */
export const SESSION_TOUCH_INTERVAL_MS = 86_400_000;

/** 迁移锁的过期时间（架构 §15.4；同时充当迁移失败后的重试节流） */
export const MIGRATION_LOCK_TTL_MS = 60_000;

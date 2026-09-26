/**
 * 编辑器的保存策略（纯函数，便于单测；口径见需求 §12.1、§15.7、§10.10）。
 *
 * 三条节奏是分开的：
 * 1. **本地草稿**：恒定每 2 秒写一次（`tickMs`），与上传节奏无关；
 * 2. **上传**：停止输入 2 秒后（>256 KB 时 5 秒），或持续输入时最长每 30 秒（>256 KB 时 60 秒）一次；
 * 3. **硬上限**：达到 1,900,000 字节**阻止上传**，但本地草稿继续保留，直到用户删减到上限内。
 */
import {
  AUTOSAVE_IDLE_MS,
  AUTOSAVE_LARGE_IDLE_MS,
  AUTOSAVE_LARGE_MAX_MS,
  AUTOSAVE_MAX_MS,
  BODY_HARD_LIMIT_BYTES,
  BODY_SOFT_LIMIT_BYTES,
  DRAFT_WRITE_INTERVAL_MS,
  LARGE_DOC_THRESHOLD_BYTES,
} from "@menote/shared";

/** 正文大小档位：ok 正常；soft 超过 1 MB（提示拆分但可保存）；hard 达硬上限（阻止保存） */
export type SizeLevel = "ok" | "soft" | "hard";

export function sizeLevel(bytes: number): SizeLevel {
  if (bytes >= BODY_HARD_LIMIT_BYTES) return "hard";
  if (bytes > BODY_SOFT_LIMIT_BYTES) return "soft";
  return "ok";
}

/** 上传节奏：小文档 2s/30s，大文档 5s/60s */
export function uploadTiming(bytes: number): { idleMs: number; maxMs: number } {
  return bytes > LARGE_DOC_THRESHOLD_BYTES
    ? { idleMs: AUTOSAVE_LARGE_IDLE_MS, maxMs: AUTOSAVE_LARGE_MAX_MS }
    : { idleMs: AUTOSAVE_IDLE_MS, maxMs: AUTOSAVE_MAX_MS };
}

/** 本地草稿的固定节奏（需求：恒定 2 秒） */
export const DRAFT_TICK_MS = DRAFT_WRITE_INTERVAL_MS;

export interface AutosaveInput {
  /** 当前正文 UTF-8 字节数 */
  bytes: number;
  /** 是否有未上传的改动 */
  dirty: boolean;
  /** 距上次输入变化的毫秒数 */
  msSinceChange: number;
  /** 距上次入队上传的毫秒数 */
  msSinceUpload: number;
}

export interface AutosaveDecision {
  /** 是否写本地草稿（tick 到了且有改动） */
  writeDraft: boolean;
  /** 是否入队上传 */
  enqueueUpload: boolean;
  /** 是否因达到硬上限被阻止上传（草稿仍保留） */
  blockedByHardLimit: boolean;
}

export function decideAutosave(input: AutosaveInput): AutosaveDecision {
  const level = sizeLevel(input.bytes);
  const blocked = level === "hard";
  const { idleMs, maxMs } = uploadTiming(input.bytes);
  const idleReached = input.msSinceChange >= idleMs;
  const maxReached = input.msSinceUpload >= maxMs;

  return {
    writeDraft: input.dirty,
    enqueueUpload: input.dirty && !blocked && (idleReached || maxReached),
    blockedByHardLimit: blocked,
  };
}

/** 状态栏常驻的大小文案（需求 §10.10：如 "1.2 MB / 2 MB"） */
export function formatSize(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB / 2 MB`;
}

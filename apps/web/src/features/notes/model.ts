/**
 * 笔记编辑器的自动保存控制器（拆解 M04-04、M04-05；架构 §3.3）。
 *
 * 它把三件事串起来：本地草稿（恒 2 秒）→ 入队上传（按 `save-policy` 的节奏）→ 通知同步引擎。
 * **不含界面、不直接发网络请求**：上传由 outbox + 同步引擎负责（`data/sync/`）。
 *
 * 时间通过 `now()` 注入，测试里可以直接推进时钟，不依赖真实等待。
 */
import { utf8ByteLength } from "@menote/shared";
import {
  DRAFT_TICK_MS,
  decideAutosave,
  formatSize,
  sizeLevel,
  type SizeLevel,
} from "../../app/editor/save-policy";
import {
  enqueueBodySave,
  getEditableBody,
  getLocalItem,
  saveDraft,
} from "../../data/db";

export type SaveState = "synced" | "pending" | "failed" | "conflict" | "blocked";

export interface NoteEditorSnapshot {
  bytes: number;
  sizeLabel: string;
  sizeLevel: SizeLevel;
  saveState: SaveState;
}

export interface NoteEditorOptions {
  itemId: string;
  onSnapshot?: (snapshot: NoteEditorSnapshot) => void;
  /** 上传入队后通知同步引擎（"写入成功后"这一触发时机） */
  notifySync?: () => void;
  now?: () => number;
  /** tick 间隔，默认 2 秒（本地草稿节奏） */
  tickMs?: number;
}

export interface NoteEditorController {
  /** 读初始内容：优先未上传草稿，其次正文缓存 */
  load(): Promise<string>;
  /** 编辑器内容变化 */
  onInput(text: string): void;
  /** 定时推进：写草稿 + 判断是否该入队上传 */
  tick(atMs?: number): Promise<void>;
  /** 立即落盘并入队（失焦、关闭页面前调用） */
  flush(atMs?: number): Promise<void>;
  start(): void;
  stop(): void;
  /** 同步引擎推送成功后回调：状态回到"已同步" */
  notifyUploaded(): void;
  notifyFailed(): void;
  notifyConflict(): void;
  getSnapshot(): NoteEditorSnapshot;
}

export function createNoteEditor(options: NoteEditorOptions): NoteEditorController {
  const now = options.now ?? Date.now;
  const tickMs = options.tickMs ?? DRAFT_TICK_MS;

  let text = "";
  let bytes = 0;
  let dirty = false;
  let lastChangeAt = 0;
  let lastUploadAt = 0;
  let saveState: SaveState = "synced";
  let timer: ReturnType<typeof setInterval> | null = null;

  function snapshot(): NoteEditorSnapshot {
    return {
      bytes,
      sizeLabel: formatSize(bytes),
      sizeLevel: sizeLevel(bytes),
      saveState,
    };
  }

  function emit(): void {
    options.onSnapshot?.(snapshot());
  }

  function setState(next: SaveState): void {
    saveState = next;
    emit();
  }

  async function enqueueUpload(at: number): Promise<void> {
    const item = await getLocalItem(options.itemId);
    // 新建条目还没上传过时 rev 为 0，入队会被合并进那条 create（正文取自 drafts）
    await enqueueBodySave(options.itemId, item?.rev ?? 0, at);
    lastUploadAt = at;
    options.notifySync?.();
  }

  async function load(): Promise<string> {
    const loaded = await getEditableBody(options.itemId);
    const item = await getLocalItem(options.itemId);
    text = loaded.body;
    bytes = utf8ByteLength(text);
    dirty = item?.pending != null;
    lastChangeAt = now();
    lastUploadAt = lastChangeAt;
    saveState = dirty ? "pending" : "synced";
    emit();
    return text;
  }

  function onInput(value: string): void {
    text = value;
    bytes = utf8ByteLength(value);
    dirty = true;
    lastChangeAt = now();
    // 达到硬上限：状态明确为"被阻止"，但本地草稿仍会继续写（拆解 M04-05）
    saveState = sizeLevel(bytes) === "hard" ? "blocked" : "pending";
    emit();
  }

  async function tick(atMs?: number): Promise<void> {
    const at = atMs ?? now();
    const decision = decideAutosave({
      bytes,
      dirty,
      msSinceChange: at - lastChangeAt,
      msSinceUpload: at - lastUploadAt,
    });

    if (decision.writeDraft) {
      await saveDraft(options.itemId, text, at);
    }
    if (decision.enqueueUpload) {
      await enqueueUpload(at);
    }
    if (decision.blockedByHardLimit && saveState !== "blocked") {
      setState("blocked");
    }
  }

  async function flush(atMs?: number): Promise<void> {
    const at = atMs ?? now();
    if (!dirty) return;

    await saveDraft(options.itemId, text, at);
    if (sizeLevel(bytes) === "hard") {
      setState("blocked");
      return;
    }
    await enqueueUpload(at);
  }

  function start(): void {
    if (timer !== null) return;
    timer = setInterval(() => {
      void tick();
    }, tickMs);
  }

  function stop(): void {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  return {
    load,
    onInput,
    tick,
    flush,
    start,
    stop,
    notifyUploaded(): void {
      dirty = false;
      setState("synced");
    },
    notifyFailed(): void {
      setState("failed");
    },
    notifyConflict(): void {
      setState("conflict");
    },
    getSnapshot: snapshot,
  };
}

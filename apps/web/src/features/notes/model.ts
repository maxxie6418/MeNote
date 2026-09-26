/**
 * 笔记编辑器的自动保存控制器（拆解 M04-04、M04-05；架构 §3.3）。
 *
 * 它把三件事串起来：本地草稿（恒 2 秒）→ 入队上传（按 `save-policy` 的节奏）→ 通知同步引擎。
 * **不含界面、不直接发网络请求**：上传由 outbox + 同步引擎负责（`data/sync/`）。
 *
 * 时间通过 `now()` 注入，测试里可以直接推进时钟，不依赖真实等待。
 */
import { sha256Hex, utf8ByteLength } from "@menote/shared";
import {
  DRAFT_TICK_MS,
  decideAutosave,
  formatSize,
  sizeLevel,
  type SizeLevel,
} from "../../app/editor/save-policy";
import {
  enqueueBodySave,
  getDraft,
  getEditableBody,
  getLocalItem,
  listItemOutbox,
  saveDraft,
} from "../../data/db";
import { isParkedOutboxRow } from "../../data/sync/backoff";

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
  /**
   * 从本地库的真实状态重算保存态。
   *
   * 为什么必须这样：编辑器内部的 dirty 标记不知道"同步引擎已经把这条推上去了"，
   * 只靠 `notifyUploaded()` 又要求调用方精确知道推的是哪一条。以本地库为准（`pending` 与 `drafts`）
   * 才不会出现"顶栏说已同步、状态栏说待上传"这种自相矛盾。
   */
  refreshState(): Promise<void>;
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

    /**
     * **先对齐状态，再决定要不要写草稿/入队。**
     *
     * 顺序很关键（M1-11 实测：顺序反了会每 2 秒重传同一份内容，rev 从 405 涨到 483）：
     * 若先写草稿再对齐，草稿是刚写下去的，对齐永远看到"本地有未上传痕迹" → 状态停在待上传 →
     * 下一轮 tick 又入队一次。先对齐时，如果当前内容和已上传的一致，`dirty` 会被清掉，
     * 后面的决策自然什么都不做。
     */
    await reconcileState();

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

  /**
   * 从本地库的真实状态对齐保存态（tick 每轮都调，引擎跑完也会调一次）。
   *
   * 规则与理由：
   * - 本地还有未上传痕迹（`items.pending` 或草稿）→ 待上传 / 已达硬上限；
   * - 本地干净但内存里还有改动 → 看这份改动是否已经上传过：
   *   - 与服务端记录的 `content_hash` 一致 → 已同步（否则会永远停在"待上传"并反复重传同一份内容）；
   *   - 不一致 → 内容还没上去，先落草稿，**绝不能丢**（否则打字内容永远不会被上传）。
   */
  async function reconcileState(): Promise<void> {
    const item = await getLocalItem(options.itemId);
    const draft = await getDraft(options.itemId);

    // 已被移入"失败列表"（不可重试错误）的队列项：状态必须是"上传失败"，不能再显示"待上传"。
    // 否则用户看到的是"还在传"，实际上它永远不会自己再传了（M1 只提示；重试界面属 M2）。
    const rows = await listItemOutbox(options.itemId);
    if (rows.some(isParkedOutboxRow)) {
      setState("failed");
      return;
    }

    const unsynced = item?.pending != null || draft != null;

    if (unsynced) {
      const next: SaveState = sizeLevel(bytes) === "hard" ? "blocked" : "pending";
      if (saveState !== next) setState(next);
      else emit();
      return;
    }

    if (dirty) {
      const currentHash = await sha256Hex(text);
      if (item?.content_hash === currentHash) {
        dirty = false;
        setState("synced");
        return;
      }
      await saveDraft(options.itemId, text, now());
      const next: SaveState = sizeLevel(bytes) === "hard" ? "blocked" : "pending";
      if (saveState !== next) setState(next);
      else emit();
      return;
    }

    setState("synced");
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
    async refreshState(): Promise<void> {
      await reconcileState();
    },
    getSnapshot: snapshot,
  };
}

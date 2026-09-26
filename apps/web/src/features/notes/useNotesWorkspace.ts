/**
 * 笔记工作区的状态编排（列表 + 当前条目 + 自动保存控制器）。
 *
 * 界面上只是"列表 + 正文"，数据流向全部经过本地库（架构 §3.1：界面层不直接访问网络）：
 * 新建 → 写本地 + 入队；编辑 → 草稿 + 入队；标题 → 元数据补丁入队；同步由引擎负责。
 */
import { newUlid } from "@menote/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildDocument, deriveTags, deriveTaskFields } from "@menote/mdcore";
import {
  countItemsByFolder,
  createLocalFolder,
  createLocalItem,
  createLocalNote,
  db,
  enqueueBodySave,
  enqueueMetaPatch,
  getCachedBody,
  getDraft,
  getLocalItem,
  listItemSummaries,
  listLocalFolders,
  listLocalItems,
  listLocalMemos,
  listMemoContents,
  moveLocalFolder,
  refreshSearchIndex,
  renameLocalFolder,
  saveDraft,
  type LocalFolder,
  type LocalItem,
  type MemoContent,
} from "../../data/db";
import { createNoteEditor, type NoteEditorController, type NoteEditorSnapshot } from "./model";
import {
  collectTags,
  DEFAULT_VIEW,
  filterByView,
  viewTitle,
  type NotesView,
} from "./views";
import { folderDepthFor, MAX_FOLDER_DEPTH } from "./folders";

const DEFAULT_TITLE = "未命名笔记";

/** 列表是否等价：只比对界面真正用到的字段 */
function sameItems(left: LocalItem[], right: LocalItem[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b) return false;
    if (
      a.id !== b.id ||
      a.title !== b.title ||
      a.rev !== b.rev ||
      a.meta_rev !== b.meta_rev ||
      a.updated_at !== b.updated_at ||
      a.sync_seq !== b.sync_seq ||
      a.pending !== b.pending ||
      a.content_hash !== b.content_hash
    ) {
      return false;
    }
  }
  return true;
}

export interface NotesWorkspace {
  /** 当前视图下的条目（已过滤、已排序） */
  items: LocalItem[];
  /** 全部未删除条目（计数与标签云用，不受视图过滤影响） */
  allItems: LocalItem[];
  loading: boolean;
  view: NotesView;
  viewTitle: string;
  setView: (view: NotesView) => void;
  tags: Array<{ tag: string; count: number }>;
  selectedId: string | null;
  selected: LocalItem | null;
  /** 本地文件夹（两层树）与其条目计数 */
  folders: LocalFolder[];
  folderCounts: Record<string, number>;
  /** 列表行的摘要（取自已缓存正文的第一行） */
  summaries: Record<string, string>;
  initialBody: string;
  snapshot: NoteEditorSnapshot | null;
  refresh: () => Promise<void>;
  open: (id: string) => Promise<void>;
  createNote: (options?: { title?: string; body?: string }) => Promise<void>;
  changeTitle: (title: string) => Promise<void>;
  /** 时间轴上的 Memo（不含已删除的；按 memo_at 倒序，置顶由界面层再排） */
  memos: LocalItem[];
  /** Memo 的正文（已剥 front matter）与已转笔记关联，供时间轴渲染 */
  memoContents: Record<string, MemoContent>;
  /**
   * 发布 Memo（乐观：先落本地并标"待上传"，出队由 outbox 后台上传；写入**永远免密**）。
   * `asTask` = 用户在录入框确认了"设为清单？"或走的是待办档；正文会带上 `menote.task` 标记，
   * 新建清单**默认状态"待办"**（M2-5）。
   */
  publishMemo: (
    text: string,
    options?: { asTask?: boolean; due?: string | null; priority?: string | null },
  ) => Promise<void>;
  /** 编辑 Memo 正文（Q19：`memo_at` 不变，只改正文与派生标签） */
  updateMemo: (itemId: string, text: string) => Promise<void>;
  /** 新建文件夹（深度超限时抛错，界面本该不给出入口） */
  createFolder: (name: string, parentId: string | null) => Promise<void>;
  /** 重命名文件夹（走 meta_rev，不生成冲突副本） */
  renameFolder: (folderId: string, name: string) => Promise<void>;
  /** 移动文件夹到某个父级（`null` = 根目录） */
  moveFolder: (folderId: string, parentId: string | null) => Promise<void>;
  /** 把条目移入文件夹（`null` = 根目录） */
  moveItemToFolder: (itemId: string, folderId: string | null) => Promise<void>;
  /** 置顶 / 收藏：都走元数据补丁（服务端白名单已含这两列） */
  togglePinned: (itemId: string) => Promise<void>;
  toggleStarred: (itemId: string) => Promise<void>;
  input: (text: string) => void;
  notifyUploaded: () => void;
  notifyFailed: () => void;
  notifyConflict: () => void;
  /** 打开着的这条被别的标签页改过（M2-9 的事前提示；保存仍会走冲突副本路径） */
  remoteChanged: boolean;
  /** 放弃本地改动、按服务端最新内容重新打开 */
  reloadSelected: () => Promise<void>;
  /** 同步跑完后按本地库的真实状态重算编辑器的保存态 */
  refreshEditorState: () => Promise<void>;
}

export function useNotesWorkspace(options: { onLocalWrite?: () => void } = {}): NotesWorkspace {
  const [allItems, setAllItems] = useState<LocalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [initialBody, setInitialBody] = useState("");
  const [snapshot, setSnapshot] = useState<NoteEditorSnapshot | null>(null);
  const [view, setView] = useState<NotesView>(DEFAULT_VIEW);
  const [folders, setFolders] = useState<LocalFolder[]>([]);
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [memos, setMemos] = useState<LocalItem[]>([]);
  const [memoContents, setMemoContents] = useState<Record<string, MemoContent>>({});
  /** 打开着的这条是否被别的标签页改过（事前提示；M2-9） */
  const [remoteChanged, setRemoteChanged] = useState(false);

  const editorRef = useRef<NoteEditorController | null>(null);
  const onLocalWrite = options.onLocalWrite;

  /** 内容没变就不要替换数组：每次同步都塞新数组会让下游依赖无谓地变身份 */
  const refresh = useCallback(async () => {
    const [rows, folderRows, counts, bodySummaries, memoRows, memoBodies] = await Promise.all([
      listLocalItems(),
      listLocalFolders(),
      countItemsByFolder(),
      listItemSummaries(),
      listLocalMemos(),
      listMemoContents(),
    ]);
    // 搜索索引按 sync_seq 增量重建（同步后 / 本地写入后各跑一次，代价只落在变了的条目上）
    await refreshSearchIndex();
    setAllItems((previous) => (sameItems(previous, rows) ? previous : rows));
    setFolders(folderRows);
    setFolderCounts(counts);
    setSummaries(bodySummaries);
    setMemos((previous) => (sameItems(previous, memoRows) ? previous : memoRows));
    setMemoContents(memoBodies);

    /**
     * 跨标签页改动的事前提示（M2-9）：基准是**打开这条时的正文** `initialBody`。
     * 两个标签页共用同一个 IndexedDB，所以别处保存后本地缓存正文就变了——一比就知道。
     * 自己保存成功后会把基准跟着更新（见 `notifyUploaded`），因此不会误报成"别处改的"。
     */
    if (selectedId !== null) {
      const cached = await getCachedBody(selectedId);
      if (cached && cached.body !== initialBody) setRemoteChanged(true);
    }
  }, [initialBody, selectedId]);

  // 首次加载：setState 放在 then 回调里，不在 effect 体内同步触发（react-hooks/set-state-in-effect）
  useEffect(() => {
    let alive = true;
    void listLocalItems().then((rows) => {
      if (!alive) return;
      setAllItems(rows);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const open = useCallback(
    async (id: string) => {
      editorRef.current?.stop();
      const editor = createNoteEditor({
        itemId: id,
        notifySync: onLocalWrite,
        onSnapshot: setSnapshot,
      });
      editorRef.current = editor;
      const body = await editor.load();
      // initialBody 就是"打开时的基准"（跨标签页提示用它比对），所以这里必须先设
      setInitialBody(body);
      setSelectedId(id);
      setRemoteChanged(false);
      editor.start();
    },
    [onLocalWrite],
  );

  const createNote = useCallback(
    async (options?: { title?: string; body?: string }) => {
      const id = newUlid();
      await createLocalNote(id, options?.title ?? DEFAULT_TITLE, options?.body ?? "", Date.now());
      await refresh();
      await open(id);
      onLocalWrite?.();
    },
    [onLocalWrite, open, refresh],
  );

  /** 放弃本地改动、按最新内容重新打开（跨标签页提示里的"重新载入"） */
  const reloadSelected = useCallback(async () => {
    if (!selectedId) return;
    await refresh();
    await open(selectedId);
  }, [open, refresh, selectedId]);

  const changeTitle = useCallback(async (title: string) => {
      if (!selectedId) return;
      const item = await getLocalItem(selectedId);
      if (!item) return;

      await db.items.update(selectedId, { title });
      await enqueueMetaPatch(selectedId, item.meta_rev, Date.now());
      await refresh();
      onLocalWrite?.();
    },
    [onLocalWrite, refresh, selectedId],
  );

  const items = useMemo(() => filterByView(allItems, view), [allItems, view]);
  const tags = useMemo(() => collectTags(allItems), [allItems]);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  /** 选中文件夹时用文件夹名当列表标题（`viewTitle` 是纯函数，不认识文件夹数据） */
  const title = useMemo(() => {
    if (view.kind === "notebook" && view.folderId) {
      const folder = folders.find((row) => row.id === view.folderId);
      if (folder) return folder.name;
    }
    return viewTitle(view);
  }, [folders, view]);

  const createFolder = useCallback(
    async (name: string, parentId: string | null) => {
      const parent = parentId === null ? null : (folders.find((row) => row.id === parentId) ?? null);
      const depth = folderDepthFor(parent);
      // 客户端先挡一层：界面本该不给出非法入口，真出现了也不该把脏数据写进本地库
      if (depth > MAX_FOLDER_DEPTH) {
        throw new Error(`最多支持 ${MAX_FOLDER_DEPTH} 层文件夹`);
      }
      const id = newUlid();
      await createLocalFolder(id, name, parentId, depth, Date.now());
      await refresh();
      setView({ kind: "notebook", folderId: id });
      onLocalWrite?.();
    },
    [folders, onLocalWrite, refresh],
  );

  /**
   * 发布 Memo。
   *
   * `type: memo` **不写进正文**（type 是条目的元数据列，md 只承载内容与结构化字段），
   * 只有存在标签或清单标记时才写 front matter——这样纯文本 Memo 的正文就是用户写的那几行，
   * 原位编辑时不会看到 YAML。
   */
  const publishMemo = useCallback(
    async (
      text: string,
      options?: { asTask?: boolean; due?: string | null; priority?: string | null },
    ) => {
      const tags = deriveTags(text);
      const asTask = options?.asTask ?? false;
      const task = asTask
        ? {
            // M2-5：新建清单默认"待办"；优先级默认"中"，截止可空（M07-03）
            status: "todo",
            due: options?.due ?? null,
            priority: options?.priority ?? "medium",
          }
        : null;
      const body =
        tags.length > 0 || asTask
          ? buildDocument({ type: "memo", tags, task, preservedLines: [] }, text)
          : text;

      const id = newUlid();
      const now = Date.now();
      await createLocalItem(
        {
          id,
          type: "memo",
          title: null,
          folder_id: null,
          tags,
          memo_at: now,
          body,
          task: deriveTaskFields(body),
        },
        now,
      );
      await refresh();
      onLocalWrite?.();
    },
    [onLocalWrite, refresh],
  );

  /**
   * 原位编辑 Memo 正文（Q19）。
   *
   * 用户编辑的是**内容**：front matter 由这里按"是否清单 + 新标签"重新生成，
   * 因此正文里的 YAML 永远不会被用户改坏；`memo_at` 不动（编辑不改变时间轴位置）。
   */
  const updateMemo = useCallback(
    async (itemId: string, text: string) => {
      const item = await getLocalItem(itemId);
      if (!item) return;

      const tags = deriveTags(text);
      // 清单标记与三个字段由条目元数据承载：编辑正文不改它们（Q19 只改内容）
      const taskFields =
        item.is_task === 1
          ? { status: item.task_status, due: item.task_due, priority: item.task_priority }
          : null;
      const body =
        tags.length > 0 || taskFields !== null
          ? buildDocument({ type: "memo", tags, task: taskFields, preservedLines: [] }, text)
          : text;

      const now = Date.now();
      await saveDraft(itemId, body, now);
      await enqueueBodySave(itemId, item.rev, now);
      await db.items.update(itemId, { tags, updated_at: now });
      if (item.tags.join("\u0000") !== tags.join("\u0000")) {
        await enqueueMetaPatch(itemId, item.meta_rev, now);
      }
      await refresh();
      onLocalWrite?.();
    },
    [onLocalWrite, refresh],
  );

  const renameFolder = useCallback(    async (folderId: string, name: string) => {
      await renameLocalFolder(folderId, name, Date.now());
      await refresh();
      onLocalWrite?.();
    },
    [onLocalWrite, refresh],
  );

  const moveFolder = useCallback(
    async (folderId: string, parentId: string | null) => {
      const parent = parentId === null ? null : (folders.find((row) => row.id === parentId) ?? null);
      const depth = folderDepthFor(parent);
      if (depth > MAX_FOLDER_DEPTH) {
        throw new Error(`最多支持 ${MAX_FOLDER_DEPTH} 层文件夹`);
      }
      await moveLocalFolder(folderId, parentId, depth, Date.now());
      await refresh();
      onLocalWrite?.();
    },
    [folders, onLocalWrite, refresh],
  );

  const patchItem = useCallback(    async (itemId: string, patch: Partial<Pick<LocalItem, "folder_id" | "pinned" | "starred">>) => {
      const item = await getLocalItem(itemId);
      if (!item) return;
      await db.items.update(itemId, { ...patch, updated_at: Date.now() });
      await enqueueMetaPatch(itemId, item.meta_rev, Date.now());
      await refresh();
      onLocalWrite?.();
    },
    [onLocalWrite, refresh],
  );

  const moveItemToFolder = useCallback(
    (itemId: string, folderId: string | null) => patchItem(itemId, { folder_id: folderId }),
    [patchItem],
  );

  const togglePinned = useCallback(
    async (itemId: string) => {
      const item = await getLocalItem(itemId);
      if (!item) return;
      await patchItem(itemId, { pinned: item.pinned === 1 ? 0 : 1 });
    },
    [patchItem],
  );

  const toggleStarred = useCallback(
    async (itemId: string) => {
      const item = await getLocalItem(itemId);
      if (!item) return;
      await patchItem(itemId, { starred: item.starred === 1 ? 0 : 1 });
    },
    [patchItem],
  );

  /**
   * **必须 memo**：返回值身份不稳定会让调用方的 effect 依赖（如 App 里启动同步引擎的 effect）
   * 每次渲染都变化 → 引擎被反复 stop/create/start → 请求风暴（M1-11 实测：10 秒 35 次 sync）。
   */
  return useMemo<NotesWorkspace>(
    () => ({
      items,
      allItems,
      loading,
      view,
      viewTitle: title,
      setView,
      tags,
      selectedId,
      selected,
      folders,
      folderCounts,
      summaries,
      initialBody,
      snapshot,
      refresh,
      open,
      createNote,
      changeTitle,
      createFolder,
      memos,
      memoContents,
      publishMemo,
      updateMemo,
      renameFolder,
      moveFolder,
      moveItemToFolder,
      togglePinned,
      toggleStarred,
      remoteChanged,
      reloadSelected,
      input: (text: string) => editorRef.current?.onInput(text),
      notifyUploaded: () => {
        editorRef.current?.notifyUploaded();
        // 自己保存成功不是"别处改的"：把基准（initialBody）跟到自己刚写下的内容，并清掉提示
        if (selectedId !== null) {
          void getDraft(selectedId).then((draft) => {
            if (draft) setInitialBody(draft.body);
          });
        }
        setRemoteChanged(false);
      },
      notifyFailed: () => editorRef.current?.notifyFailed(),
      notifyConflict: () => editorRef.current?.notifyConflict(),
      refreshEditorState: () => editorRef.current?.refreshState() ?? Promise.resolve(),
    }),
    [
      allItems,
      changeTitle,
      createFolder,
      createNote,
      folderCounts,
      folders,
      initialBody,
      items,
      loading,
      memos,
      memoContents,
      moveItemToFolder,
      open,
      publishMemo,
      refresh,
      reloadSelected,
      remoteChanged,
      renameFolder,
      moveFolder,
      selected,
      selectedId,
      snapshot,
      summaries,
      tags,
      title,
      togglePinned,
      toggleStarred,
      updateMemo,
      view,
    ],
  );
}

/**
 * 笔记工作区的状态编排（列表 + 当前条目 + 自动保存控制器）。
 *
 * 界面上只是"列表 + 正文"，数据流向全部经过本地库（架构 §3.1：界面层不直接访问网络）：
 * 新建 → 写本地 + 入队；编辑 → 草稿 + 入队；标题 → 元数据补丁入队；同步由引擎负责。
 */
import { newUlid } from "@menote/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  countItemsByFolder,
  createLocalFolder,
  createLocalNote,
  db,
  enqueueMetaPatch,
  getLocalItem,
  listItemSummaries,
  listLocalFolders,
  listLocalItems,
  moveLocalFolder,
  renameLocalFolder,
  type LocalFolder,
  type LocalItem,
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

  const editorRef = useRef<NoteEditorController | null>(null);
  const onLocalWrite = options.onLocalWrite;

  /** 内容没变就不要替换数组：每次同步都塞新数组会让下游依赖无谓地变身份 */
  const refresh = useCallback(async () => {
    const [rows, folderRows, counts, bodySummaries] = await Promise.all([
      listLocalItems(),
      listLocalFolders(),
      countItemsByFolder(),
      listItemSummaries(),
    ]);
    setAllItems((previous) => (sameItems(previous, rows) ? previous : rows));
    setFolders(folderRows);
    setFolderCounts(counts);
    setSummaries(bodySummaries);
  }, []);

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
      setInitialBody(body);
      setSelectedId(id);
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

  const changeTitle = useCallback(
    async (title: string) => {
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

  const renameFolder = useCallback(
    async (folderId: string, name: string) => {
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
      renameFolder,
      moveFolder,
      moveItemToFolder,
      togglePinned,
      toggleStarred,
      input: (text: string) => editorRef.current?.onInput(text),
      notifyUploaded: () => editorRef.current?.notifyUploaded(),
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
      moveItemToFolder,
      open,
      refresh,
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
      view,
    ],
  );
}

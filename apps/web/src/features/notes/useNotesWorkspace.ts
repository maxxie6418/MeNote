/**
 * 笔记工作区的状态编排（列表 + 当前条目 + 自动保存控制器）。
 *
 * 界面上只是"列表 + 正文"，数据流向全部经过本地库（架构 §3.1：界面层不直接访问网络）：
 * 新建 → 写本地 + 入队；编辑 → 草稿 + 入队；标题 → 元数据补丁入队；同步由引擎负责。
 */
import { newUlid } from "@menote/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createLocalNote,
  db,
  enqueueMetaPatch,
  getLocalItem,
  listLocalItems,
  type LocalItem,
} from "../../data/db";
import { createNoteEditor, type NoteEditorController, type NoteEditorSnapshot } from "./model";

const DEFAULT_TITLE = "未命名笔记";

export interface NotesWorkspace {
  items: LocalItem[];
  loading: boolean;
  selectedId: string | null;
  selected: LocalItem | null;
  initialBody: string;
  snapshot: NoteEditorSnapshot | null;
  refresh: () => Promise<void>;
  open: (id: string) => Promise<void>;
  createNote: () => Promise<void>;
  changeTitle: (title: string) => Promise<void>;
  input: (text: string) => void;
  notifyUploaded: () => void;
  notifyFailed: () => void;
  notifyConflict: () => void;
}

export function useNotesWorkspace(options: { onLocalWrite?: () => void } = {}): NotesWorkspace {
  const [items, setItems] = useState<LocalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [initialBody, setInitialBody] = useState("");
  const [snapshot, setSnapshot] = useState<NoteEditorSnapshot | null>(null);

  const editorRef = useRef<NoteEditorController | null>(null);
  const onLocalWrite = options.onLocalWrite;

  const refresh = useCallback(async () => {
    setItems(await listLocalItems());
  }, []);

  // 首次加载：setState 放在 then 回调里，不在 effect 体内同步触发（react-hooks/set-state-in-effect）
  useEffect(() => {
    let alive = true;
    void listLocalItems().then((rows) => {
      if (!alive) return;
      setItems(rows);
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

  const createNote = useCallback(async () => {
    const id = newUlid();
    await createLocalNote(id, DEFAULT_TITLE, "", Date.now());
    await refresh();
    await open(id);
    onLocalWrite?.();
  }, [onLocalWrite, open, refresh]);

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

  return {
    items,
    loading,
    selectedId,
    selected: items.find((item) => item.id === selectedId) ?? null,
    initialBody,
    snapshot,
    refresh,
    open,
    createNote,
    changeTitle,
    input: (text: string) => editorRef.current?.onInput(text),
    notifyUploaded: () => editorRef.current?.notifyUploaded(),
    notifyFailed: () => editorRef.current?.notifyFailed(),
    notifyConflict: () => editorRef.current?.notifyConflict(),
  };
}

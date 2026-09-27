/**
 * 新建动作（M3-6 从 `useNotesWorkspace` 抽出，为那个 hook 的 500 行预算让位）。
 *
 * 两件事：新建笔记、新建笔记本文件夹。两条口径：
 * - **当前视图停在加密空间里的文件夹**时，新建笔记**直接带空间标记**（`in_enc_space`）建在那里，
 *   不走"先建在根目录再移进去"；
 * - 文件夹深度超限时**客户端先抛错**（界面本该不给出入口，真出现了也不该把脏数据写进本地库）。
 */
import { useCallback } from "react";
import { newUlid } from "@menote/shared";
import { createLocalFolder, createLocalItem, createLocalNote } from "../../data/db";
import type { LocalFolder } from "../../data/db";
import { folderDepthFor, MAX_FOLDER_DEPTH } from "./folders";
import { isInVault } from "../privacy/vault";
import type { NotesView } from "./views";

const DEFAULT_TITLE = "未命名笔记";

export interface UseNoteCreationInput {
  folders: readonly LocalFolder[];
  view: NotesView;
  refresh: () => Promise<void>;
  open: (id: string) => Promise<void>;
  setView: (view: NotesView) => void;
  onLocalWrite?: () => void;
}

export function useNoteCreation(input: UseNoteCreationInput) {
  const { folders, view, refresh, open, setView, onLocalWrite } = input;

  const createNote = useCallback(
    async (options?: { title?: string; body?: string }) => {
      const id = newUlid();
      const inVault =
        view.kind === "notebook" && view.folderId != null && isInVault(folders, view.folderId);

      if (inVault && view.kind === "notebook") {
        await createLocalItem(
          {
            id,
            type: "note",
            title: options?.title ?? DEFAULT_TITLE,
            folder_id: view.folderId ?? null,
            body: options?.body ?? "",
            inEncSpace: true,
          },
          Date.now(),
        );
      } else {
        await createLocalNote(id, options?.title ?? DEFAULT_TITLE, options?.body ?? "", Date.now());
      }

      await refresh();
      await open(id);
      onLocalWrite?.();
    },
    [folders, onLocalWrite, open, refresh, view],
  );

  const createFolder = useCallback(
    async (name: string, parentId: string | null) => {
      const parent =
        parentId === null ? null : (folders.find((row) => row.id === parentId) ?? null);
      const depth = folderDepthFor(parent);
      if (depth > MAX_FOLDER_DEPTH) {
        throw new Error(`最多支持 ${MAX_FOLDER_DEPTH} 层文件夹`);
      }
      const id = newUlid();
      await createLocalFolder(id, name, parentId, depth, Date.now());
      await refresh();
      setView({ kind: "notebook", folderId: id });
      onLocalWrite?.();
    },
    [folders, onLocalWrite, refresh, setView],
  );

  return { createNote, createFolder };
}

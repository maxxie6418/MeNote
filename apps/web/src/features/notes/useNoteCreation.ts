/**
 * 新建动作（M3-6 从 `useNotesWorkspace` 抽出，为那个 hook 的 500 行预算让位）。
 *
 * 三件事：新建笔记、新建笔记本文件夹。三条口径：
 * - **新建笔记落在"当前选中的笔记本"**（2026-09-28 修复，用户反馈的问题 1）：`view.kind === "notebook"`
 *   时取 `view.folderId`；最近编辑 / 收藏 / 标签这些视图**没有笔记本上下文**，落根目录；
 * - **加密空间里的文件夹**新建时**直接带空间标记**（`in_enc_space`）建在那里，
 *   不走"先建在根目录再移进去"（与普通笔记本现在是**同一条路径**，只是多一个标记）；
 * - 文件夹深度超限时**客户端先抛错**（界面本该不给出入口，真出现了也不该把脏数据写进本地库）。
 */
import { useCallback } from "react";
import { newUlid } from "@menote/shared";
import { createLocalFolder, createLocalItem } from "../../data/db";
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
    async (options?: { title?: string; body?: string }): Promise<string> => {
      const id = newUlid();
      /*
        **落点 = 当前选中的笔记本**。此前只有加密空间那条分支带 `folder_id`，
        普通笔记本一律走 `createLocalNote`（= 根目录）：选中「工作」新建时会落进「全部笔记」，
        用户反馈的"其他新建要附属于笔记本"就是这一条。
      */
      const folderId = view.kind === "notebook" ? (view.folderId ?? null) : null;
      const inVault = folderId !== null && isInVault(folders, folderId);

      await createLocalItem(
        {
          id,
          type: "note",
          title: options?.title ?? DEFAULT_TITLE,
          folder_id: folderId,
          body: options?.body ?? "",
          inEncSpace: inVault,
        },
        Date.now(),
      );

      await refresh();
      await open(id);
      onLocalWrite?.();
      // 返回新 id：调用方要用它给"打开这一篇"的轻提示动作（2026-09-28）
      return id;
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

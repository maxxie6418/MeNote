/**
 * 加密空间的**作用域**（M3-6）：把"空间在哪、空间里有什么、怎么在空间里新建"这几件事
 * 从 `useNotesWorkspace` 里分出来（那个 hook 有 500 行预算）。
 *
 * 依赖方向：只往下依赖数据层与纯函数（`data/db`、`privacy/vault`），
 * **不依赖 `features/privacy` 的任何 hook/组件**——门禁判定是纯函数，界面由 `app/` 组装。
 *
 * 三条口径：
 * 1. **笔记本树与空间互不混入**：`notebookFolders` / `notebookCounts` 摘掉整个空间子树；
 * 2. 空间内新建**天然带标记**（`in_enc_space`），不走"先建后移"；
 * 3. 空间根还没同步下来时（`vault.id === null`）不给新建入口——报错也要说清原因。
 */
import { useCallback, useMemo } from "react";
import type { LocalFolder, LocalItem } from "../../data/db";
import {
  createLocalFolder,
  createLocalItem,
  db,
  enqueueMetaPatch,
  moveLocalFolderToVault,
} from "../../data/db";
import { newUlid, ENC_SPACE_DEFAULT_NAME } from "@menote/shared";
import { folderDepthFor, MAX_FOLDER_DEPTH } from "./folders";
import { runBatch, type BatchProgress, type BatchResult } from "./batch";
import {
  findVaultRoot,
  notebookFolders,
  vaultChildFolders,
  vaultSubtree,
} from "../privacy/vault";
import type { NotesView } from "./views";

/**
 * 这个文件夹**及其直接子夹**里的条目（整夹标记的对象）。
 *
 * 两层限制让这件事很简单：深度 2 的文件夹不可能有子文件夹，所以最多展开一层。
 */
function innerItemsOf(
  folderId: string,
  folders: readonly LocalFolder[],
  items: readonly LocalItem[],
): LocalItem[] {
  const ids = new Set<string>([folderId]);
  for (const folder of folders) {
    if (folder.parent_id === folderId && folder.deleted_at === null) ids.add(folder.id);
  }
  return items.filter((item) => item.deleted_at === null && ids.has(item.folder_id ?? ""));
}

export interface VaultDescriptor {
  /** 空间根文件夹 id；服务端补建完成前可能为 null */
  id: string | null;
  name: string;
  /** 空间内的子夹（不含根自己） */
  folders: LocalFolder[];
  /** 空间内条目总数（含子夹里的） */
  count: number;
}

export interface VaultScopeInput {
  folders: readonly LocalFolder[];
  folderCounts: Readonly<Record<string, number>>;
  allItems: readonly LocalItem[];
  refresh: () => Promise<void>;
  open: (id: string) => Promise<void>;
  setView: (view: NotesView) => void;
  /**
   * 元数据补丁（由 `useNotesWorkspace` 传入）。
   * 移入 / 移出必须**一条补丁同时写 `folder_id` 与 `in_enc_space`**，
   * 所以这两个动作放在这里、用调用方给的补丁函数落地。
   */
  patchItem: (
    itemId: string,
    patch: Partial<Pick<LocalItem, "folder_id" | "in_enc_space">>,
  ) => Promise<void>;
  onLocalWrite?: () => void;
}

export interface VaultScope {
  notebookFolders: LocalFolder[];
  notebookCounts: Record<string, number>;
  vault: VaultDescriptor;
  createVaultFolder: (name: string, parentId: string | null) => Promise<void>;
  createNoteInVault: (options?: { folderId?: string | null }) => Promise<void>;
  /** 移入加密空间（`folderId = null` = 空间根） */
  moveItemToVault: (itemId: string, folderId: string | null) => Promise<void>;
  /** 移出加密空间（`folderId = null` = 根目录） */
  moveItemOutOfVault: (itemId: string, folderId: string | null) => Promise<void>;
  /** 整夹移入加密空间（含内部条目批量打标）；返回失败清单供「重试」 */
  moveFolderToVault: (
    folderId: string,
    options?: { onProgress?: (progress: BatchProgress) => void },
  ) => Promise<BatchResult<LocalItem>>;
  /** 整夹移出加密空间 */
  moveFolderOutOfVault: (
    folderId: string,
    options?: { onProgress?: (progress: BatchProgress) => void },
  ) => Promise<BatchResult<LocalItem>>;
}

export function useVaultScope(input: VaultScopeInput): VaultScope {
  const { folders, folderCounts, allItems, refresh, open, setView, patchItem, onLocalWrite } = input;

  const vaultRoot = useMemo(() => findVaultRoot(folders), [folders]);
  const notebookFolderRows = useMemo(() => notebookFolders(folders), [folders]);
  const notebookCounts = useMemo(() => {
    const excluded = new Set(vaultSubtree(folders).map((folder) => folder.id));
    return Object.fromEntries(
      Object.entries(folderCounts).filter(([folderId]) => !excluded.has(folderId)),
    );
  }, [folderCounts, folders]);
  const vault = useMemo<VaultDescriptor>(
    () => ({
      id: vaultRoot?.id ?? null,
      name: vaultRoot?.name ?? ENC_SPACE_DEFAULT_NAME,
      folders: vaultChildFolders(folders),
      count: allItems.filter((item) => item.in_enc_space === 1).length,
    }),
    [allItems, folders, vaultRoot],
  );

  const createVaultFolder = useCallback(
    async (name: string, parentId: string | null) => {
      const parent =
        parentId === null
          ? (vaultRoot ?? null)
          : (folders.find((row) => row.id === parentId) ?? null);
      const depth = folderDepthFor(parent);
      if (depth > MAX_FOLDER_DEPTH) {
        throw new Error(`最多支持 ${MAX_FOLDER_DEPTH} 层文件夹`);
      }
      const id = newUlid();
      await createLocalFolder(id, name, parentId, depth, Date.now(), { inEncSpace: true });
      await refresh();
      setView({ kind: "notebook", folderId: id });
      onLocalWrite?.();
    },
    [folders, onLocalWrite, refresh, setView, vaultRoot],
  );

  const createNoteInVault = useCallback(
    async (options: { folderId?: string | null } = {}) => {
      if (!vaultRoot) {
        throw new Error("加密空间还没同步下来，请稍后重试");
      }
      const id = newUlid();
      await createLocalItem(
        {
          id,
          type: "note",
          title: null,
          folder_id: options.folderId ?? vaultRoot.id,
          body: "",
          inEncSpace: true,
        },
        Date.now(),
      );
      await refresh();
      await open(id);
      onLocalWrite?.();
    },
    [onLocalWrite, open, refresh, vaultRoot],
  );

  /**
   * 移入加密空间（M3-8）：**一条 `patch_meta` 同时写 `folder_id` 与 `in_enc_space`**——
   * 分两次写会出现"标记已经在空间里、却还挂在普通文件夹下"的中间态（服务端也会拒绝）。
   * `folderId = null` 表示移入空间根（**锁定态唯一可用的目标**）。
   */
  const moveItemToVault = useCallback(
    async (itemId: string, folderId: string | null) => {
      const target = folderId ?? vaultRoot?.id ?? null;
      if (!target) throw new Error("加密空间还没同步下来，请稍后重试");
      await patchItem(itemId, { folder_id: target, in_enc_space: 1 });
    },
    [patchItem, vaultRoot],
  );

  /** 移出加密空间（M3-8）：移到某个普通文件夹（`null` = 根目录），并摘掉空间标记 */
  const moveItemOutOfVault = useCallback(
    async (itemId: string, folderId: string | null) => {
      await patchItem(itemId, { folder_id: folderId, in_enc_space: 0 });
    },
    [patchItem],
  );

  /**
   * 整夹移入加密空间（M3-8；设计 §8）：**先标文件夹行，再批量标内部条目**。
   *
   * 三个要点：
   * 1. 文件夹这一行必须"父级 + 空间标记"一条补丁写完（`moveLocalFolderToVault`）；
   * 2. 内部条目**逐条**打标（`runBatch`）：单条失败跳过并记进失败清单，不做全成功或全失败；
   * 3. 进度逐条回报（界面显示"处理中 12 / 40"），**中断不影响**——每条 patch 各自入队 outbox。
   *
   * 返回失败清单供界面「重试」（重试 = 再跑一遍同样的批量）。
   */
  const moveFolderToVault = useCallback(
    async (
      folderId: string,
      options: { onProgress?: (progress: BatchProgress) => void } = {},
    ): Promise<BatchResult<LocalItem>> => {
      const folder = folders.find((row) => row.id === folderId);
      if (!folder) throw new Error("文件夹不存在");
      if (folder.is_enc_space === 1) throw new Error("加密空间本身不能移动");
      if (!vaultRoot) throw new Error("加密空间还没同步下来，请稍后重试");

      const now = Date.now();
      // 空间根 depth 0 → 这个文件夹成为空间内第 1 层；它原有的子夹仍是第 2 层（两层上限不变）
      await moveLocalFolderToVault(folderId, vaultRoot.id, 1, 1, now);

      const inner = innerItemsOf(folderId, folders, allItems);
      const result = await runBatch({
        items: inner,
        run: async (item) => {
          await db.items.update(item.id, { in_enc_space: 1, updated_at: Date.now() });
          await enqueueMetaPatch(item.id, item.meta_rev, Date.now());
        },
        onProgress: options.onProgress,
      });

      await refresh();
      onLocalWrite?.();
      return result;
    },
    [allItems, folders, onLocalWrite, refresh, vaultRoot],
  );

  /** 整夹移出加密空间：父级回到根目录、摘掉空间标记，内部条目同样批量摘标记 */
  const moveFolderOutOfVault = useCallback(
    async (
      folderId: string,
      options: { onProgress?: (progress: BatchProgress) => void } = {},
    ): Promise<BatchResult<LocalItem>> => {
      const folder = folders.find((row) => row.id === folderId);
      if (!folder) throw new Error("文件夹不存在");
      if (folder.is_enc_space === 1) throw new Error("加密空间本身不能移动");

      await moveLocalFolderToVault(folderId, null, 1, 0, Date.now());

      const inner = innerItemsOf(folderId, folders, allItems);
      const result = await runBatch({
        items: inner,
        run: async (item) => {
          await db.items.update(item.id, { in_enc_space: 0, updated_at: Date.now() });
          await enqueueMetaPatch(item.id, item.meta_rev, Date.now());
        },
        onProgress: options.onProgress,
      });

      await refresh();
      onLocalWrite?.();
      return result;
    },
    [allItems, folders, onLocalWrite, refresh],
  );

  /**
   * **必须 memo**：`useNotesWorkspace` 会把这个对象放进它自己的 memo 依赖，
   * 每次新建对象会让 workspace 的返回值身份每次都变 → 调用方 effect（同步引擎）反复重建
   * → 请求风暴（M1-11 实测过；`notes-hook` 的引用稳定性用例专门盯这一点）。
   */
  return useMemo(
    () => ({
      notebookFolders: notebookFolderRows,
      notebookCounts,
      vault,
      createVaultFolder,
      createNoteInVault,
      moveItemToVault,
      moveItemOutOfVault,
      moveFolderToVault,
      moveFolderOutOfVault,
    }),
    [
      createNoteInVault,
      createVaultFolder,
      moveFolderOutOfVault,
      moveFolderToVault,
      moveItemOutOfVault,
      moveItemToVault,
      notebookCounts,
      notebookFolderRows,
      vault,
    ],
  );
}

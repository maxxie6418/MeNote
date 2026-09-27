/**
 * 加密空间在**本地文件夹树**里的位置（M3-6；《隐私锁设计》§6.2）。
 *
 * 为什么需要这一层：空间根行是 `folders` 表里的**普通一行**（`is_enc_space = 1`），
 * 服务端补建之后它天然会出现在"根目录文件夹"里——那是不对的：
 * **空间不在笔记本树里**，它是导航底部那个贴底节点。所以各处取文件夹时必须把空间子树摘出去，
 * 只在空间视图里显示。
 *
 * 四条判定都放在这里（纯函数、可单测），不要在组件里各写一遍 `is_enc_space === 1`。
 */
import type { LocalFolder } from "../../data/db";

/** 空间根行 */
export function isVaultRoot(folder: Pick<LocalFolder, "is_enc_space">): boolean {
  return folder.is_enc_space === 1;
}

/** 空间子树（根 + 空间内的子夹） */
export function vaultSubtree(folders: readonly LocalFolder[]): LocalFolder[] {
  return folders.filter((folder) => isVaultRoot(folder) || folder.in_enc_space === 1);
}

/** 空间根（正常只有一个；没同步下来之前可能没有） */
export function findVaultRoot(folders: readonly LocalFolder[]): LocalFolder | null {
  return folders.find(isVaultRoot) ?? null;
}

/** 笔记本树用的文件夹：**排除整个空间子树** */
export function notebookFolders(folders: readonly LocalFolder[]): LocalFolder[] {
  return folders.filter((folder) => !isVaultRoot(folder) && folder.in_enc_space === 0);
}

/** 空间视图用的文件夹：空间内的子夹（不含根自己——根是列表的"根目录"） */
export function vaultChildFolders(folders: readonly LocalFolder[]): LocalFolder[] {
  const root = findVaultRoot(folders);
  if (!root) return [];
  return folders.filter((folder) => folder.parent_id === root.id && folder.deleted_at === null);
}

/** 某个文件夹是否属于空间子树（用于"能不能移进去 / 移出来"的判断） */
export function isInVault(
  folders: readonly LocalFolder[],
  folderId: string | null | undefined,
): boolean {
  if (!folderId) return false;
  const folder = folders.find((row) => row.id === folderId);
  if (!folder) return false;
  return isVaultRoot(folder) || folder.in_enc_space === 1;
}

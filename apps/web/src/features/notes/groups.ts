/**
 * 中间列表列的**按文件夹分组**（B2 批；方案 B，用户 2026-09-28 拍板）。
 *
 * 只在「笔记本」视图用，两种入口两种口径：
 * - **全部笔记**（`rootFolderId` 不传）：先「未分类」（`folder_id === null`），再每个第 1 层文件夹一组，
 *   组内是它自己的条目，`children` 是各子夹（第 2 层）；
 * - **选中某个笔记本**（传 `rootFolderId`）：返回**一组**——它自己的条目 + `children` 各子夹
 *   （不递归到子夹内部，子夹只作为可点的分组头出现）。
 *
 * 最近编辑 / 收藏 / 标签 / 搜索结果**不分组**：那几个视图没有"笔记本"上下文，
 * 切碎反而反直觉（调用方不调本函数即可）。
 *
 * 三条与既有约束的接缝：
 * - **两层限制**：只到第 2 层（`MAX_FOLDER_DEPTH`），子夹不再有 `children`；
 * - **隐私门禁**：`items` 必须是**已过 `filterByView` 门禁**的那份（锁定时空间内条目已不在里面，
 *   分组自然为空）——本函数不做任何隐私判断；
 * - **空分组不渲染**；组内保持**传入顺序**（`listLocalItems` 已是"最近编辑倒序"，不在这里重排）。
 */
import type { LocalFolder } from "../../data/db";

/** 分组只关心"属于哪个文件夹"，其余字段原样带过 */
export interface GroupableItem {
  id: string;
  folder_id?: string | null;
}

export interface NoteGroup<T> {  /** `null` = 「未分类」（只有"全部笔记"视图有这一组） */
  folderId: string | null;
  name: string;
  /** 1 = 第 1 层（或「未分类」）；2 = 子文件夹 */
  depth: 1 | 2;
  items: T[];
  children: Array<NoteGroup<T>>;
}

function byName(a: LocalFolder, b: LocalFolder): number {
  return a.name.localeCompare(b.name, "zh-Hans-CN");
}

/**
 * 按文件夹把条目分好组（左侧树"显示条目"用）。
 *
 * **根目录的条目不进这张表**：树里没有"根"这一行可挂（那些条目走中间列的「未分类」分组看）。
 * 组内保持传入顺序（`listLocalItems` 已是"最近编辑倒序"）；一次 O(n)，调用方负责 `useMemo`
 * ——它会进 `FolderTree` 的 props，每次渲染新建对象就会让整棵树重渲染。
 */
export function indexItemsByFolder<T extends GroupableItem>(
  items: readonly T[],
): Record<string, T[]> {
  const grouped: Record<string, T[]> = {};
  for (const item of items) {
    const folderId = item.folder_id ?? null;
    if (folderId === null) continue;
    (grouped[folderId] ??= []).push(item);
  }
  return grouped;
}

export function groupNotesByFolder<T extends GroupableItem>(
  items: readonly T[],
  folders: readonly LocalFolder[],
  options: { rootFolderId?: string | null } = {},
): Array<NoteGroup<T>> {
  /** 一次 O(n) 建索引，后面全是查表 */
  const byFolder = new Map<string | null, T[]>();
  for (const item of items) {
    const key = item.folder_id ?? null;
    const list = byFolder.get(key);
    if (list) list.push(item);
    else byFolder.set(key, [item]);
  }

  /** 某个文件夹的子夹分组（第 2 层，不再有 children） */
  const childGroups = (parentId: string): Array<NoteGroup<T>> =>
    folders
      .filter((folder) => folder.parent_id === parentId)
      .sort(byName)
      .map((folder) => ({
        folderId: folder.id,
        name: folder.name,
        depth: 2 as const,
        items: byFolder.get(folder.id) ?? [],
        children: [],
      }))
      .filter((group) => group.items.length > 0);

  if (options.rootFolderId !== undefined && options.rootFolderId !== null) {
    const folder = folders.find((row) => row.id === options.rootFolderId);
    if (!folder) return [];
    const children = childGroups(folder.id);
    const own = byFolder.get(folder.id) ?? [];
    // 自己没条目、子夹也空 → 整屏走空状态
    if (own.length === 0 && children.length === 0) return [];
    return [{ folderId: folder.id, name: folder.name, depth: 1, items: own, children }];
  }

  const groups: Array<NoteGroup<T>> = [];
  const uncategorized = byFolder.get(null) ?? [];
  if (uncategorized.length > 0) {
    groups.push({
      folderId: null,
      name: "未分类",
      depth: 1,
      items: uncategorized,
      children: [],
    });
  }

  for (const folder of folders.filter((row) => row.parent_id === null).sort(byName)) {
    const own = byFolder.get(folder.id) ?? [];
    const children = childGroups(folder.id);
    if (own.length === 0 && children.length === 0) continue;
    groups.push({ folderId: folder.id, name: folder.name, depth: 1, items: own, children });
  }

  return groups;
}

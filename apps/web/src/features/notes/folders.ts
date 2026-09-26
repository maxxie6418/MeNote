/**
 * 文件夹规则（需求 §4.5 两层限制；功能拆解 M2-3）。
 *
 * 单独一个文件：这些是**领域规则**（谁能放在谁下面、能不能再建子夹、哪些移动目标非法），
 * 与"视图筛选"是两件事，混在 `views.ts` 里会让两边都难读。
 * 服务端有对应实现（`services/folders.ts` 的 `depthUnder`）——**服务端才是权威**，
 * 这里的判断只用于"提前给用户反馈"与"不给非法入口"。
 */
import type { LocalFolder } from "../../data/db";

/** 需求 §4.5：最多两层嵌套（加密空间的 depth 0 属 M3） */
export const MAX_FOLDER_DEPTH = 2;

/** 在某个父文件夹下新建时的深度；父不存在则为第 1 层 */
export function folderDepthFor(parent: { depth: number } | null | undefined): number {
  return parent ? parent.depth + 1 : 1;
}

/**
 * 能否在某个文件夹下继续新建子文件夹。
 *
 * 第 2 层返回 false —— 界面上**不渲染**"新建子文件夹"入口（不是禁用：那个位置永远没有合法动作）。
 */
export function canCreateChildFolder(parent: { depth: number } | null | undefined): boolean {
  return folderDepthFor(parent) <= MAX_FOLDER_DEPTH;
}

export interface MoveTarget {
  /** `null` = 根目录 */
  parentId: string | null;
  name: string;
  allowed: boolean;
  /** 不允许时必须说明原因（DESIGN.md §6.1） */
  reason?: string;
}

/**
 * 列出某个文件夹可以移动到的目标，并标出非法目标的原因。
 *
 * 四类非法情形（验收点要求"超过三层的目标置灰并说明原因"）：
 * 1. 移到自己身上；
 * 2. 移到自己的子孙下面（会成环）——两层结构里就是"移到自己的子文件夹"；
 * 3. 移动后自己会超过第 2 层；
 * 4. 自己有子文件夹、移动后会把子文件夹顶到第 3 层。
 */
export function folderMoveTargets(
  folders: readonly LocalFolder[],
  folderId: string,
): MoveTarget[] {
  const moving = folders.find((folder) => folder.id === folderId);
  if (!moving) return [];

  const hasChildren = folders.some((folder) => folder.parent_id === folderId);
  const targets: MoveTarget[] = [
    moving.parent_id === null
      ? { parentId: null, name: "根目录", allowed: false, reason: "已经在根目录" }
      : { parentId: null, name: "根目录", allowed: true },
  ];

  for (const candidate of folders) {
    if (candidate.id === folderId) continue; // 自己不出现在目标里
    if (candidate.depth > 1) continue; // 第 2 层不能当父：移进去就是第 3 层

    if (candidate.id === moving.parent_id) {
      targets.push({
        parentId: candidate.id,
        name: candidate.name,
        allowed: false,
        reason: "已经在这个文件夹里",
      });
      continue;
    }

    const isDescendant = moving.parent_id === null && candidate.parent_id === moving.id;
    const newDepth = candidate.depth + 1;
    const childWouldExceed = hasChildren && newDepth + 1 > MAX_FOLDER_DEPTH;

    if (isDescendant) {
      targets.push({
        parentId: candidate.id,
        name: candidate.name,
        allowed: false,
        reason: "不能移到自己的子文件夹里",
      });
    } else if (newDepth > MAX_FOLDER_DEPTH) {
      targets.push({
        parentId: candidate.id,
        name: candidate.name,
        allowed: false,
        reason: `移进去会超过 ${MAX_FOLDER_DEPTH} 层`,
      });
    } else if (childWouldExceed) {
      targets.push({
        parentId: candidate.id,
        name: candidate.name,
        allowed: false,
        reason: "它下面还有文件夹，移进去会超过两层",
      });
    } else {
      targets.push({ parentId: candidate.id, name: candidate.name, allowed: true });
    }
  }

  return targets;
}

/**
 * 首页的本地计算（功能拆解 M05；需求 §7.4）。
 *
 * 两条硬口径：
 * 1. **不发额外请求**：全部由本地元数据（IndexedDB 里的条目行）算出来；
 * 2. **统计始终按全量口径**：计入加密空间内条目与单篇加密条目，**不因锁定/解锁改变**——
 *    它是"我总共有多少东西"，不是"我现在能看多少"。受门禁影响的只有**来自 Memo 的内容预览**
 *    （今日待办、最近动态里的 Memo 部分），那些在锁定时以"已锁定"占位（Q7）。
 */
import type { LocalItem } from "../../data/db";

export interface HomeStats {
  notes: number;
  tables: number;
  memos: number;
  total: number;
}

/** 条目统计：按类型计数（含加密条目，含 Memo） */
export function homeStats(items: readonly Pick<LocalItem, "type">[]): HomeStats {
  let notes = 0;
  let tables = 0;
  let memos = 0;
  for (const item of items) {
    if (item.type === "table") tables += 1;
    else if (item.type === "memo") memos += 1;
    else notes += 1;
  }
  return { notes, tables, memos, total: notes + tables + memos };
}

export interface TaskPreview {
  id: string;
  title: string;
  due: string | null;
  priority: string | null;
}

/**
 * 今日待办预览：未完成的清单 Memo，最多 `limit` 条。
 *
 * 排序复用待办视图的规则（有截止在前 → 优先级 → 最近更新），避免首页与待办页给出不同顺序。
 */
export function openTaskPreview(
  items: readonly Pick<LocalItem, "id" | "is_task" | "task_status" | "task_due" | "task_priority" | "updated_at">[],
  titles: Readonly<Record<string, string>>,
  limit = 4,
): TaskPreview[] {
  return items
    .filter((item) => item.is_task === 1 && item.task_status !== "done")
    .sort(compareByDueThenPriority)
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      title: titles[item.id] ?? "未命名",
      due: item.task_due,
      priority: item.task_priority,
    }));
}

function compareByDueThenPriority(
  a: Pick<LocalItem, "task_due" | "task_priority" | "updated_at">,
  b: Pick<LocalItem, "task_due" | "task_priority" | "updated_at">,
): number {
  const aDue = a.task_due;
  const bDue = b.task_due;
  if (aDue !== bDue) {
    if (aDue === null) return 1;
    if (bDue === null) return -1;
    return aDue < bDue ? -1 : 1;
  }
  const weight = (priority: string | null): number =>
    priority === "high" ? 0 : priority === "medium" ? 1 : priority === "low" ? 2 : 3;
  const byPriority = weight(a.task_priority) - weight(b.task_priority);
  if (byPriority !== 0) return byPriority;
  return b.updated_at - a.updated_at;
}

export interface RecentEntry {
  id: string;
  title: string;
  type: LocalItem["type"];
  updated_at: number;
}

/** 最近动态：按最近更新倒序的前若干条（笔记 + 表格；Memo 由调用方单独拼接） */
export function recentPreview(
  items: readonly Pick<LocalItem, "id" | "title" | "type" | "updated_at">[],
  limit = 4,
): RecentEntry[] {
  return [...items]
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      title: item.title ?? "未命名笔记",
      type: item.type,
      updated_at: item.updated_at,
    }));
}

/** 快速导航用的标签清单：按出现次数倒序，取前若干个 */
export function topTags(
  items: readonly Pick<LocalItem, "tags">[],
  limit = 6,
): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-Hans-CN"))
    .slice(0, limit);
}

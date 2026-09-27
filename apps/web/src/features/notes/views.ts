/**
 * 笔记区视图（功能拆解 M02-02/M02-03；Q1 已确认的导航顺序）。
 *
 * 视图只决定"列表里显示哪些条目"，不改变数据模型——四个视图（笔记本 / 最近编辑 / 收藏 / 标签）
 * 共用同一套列表 + 正文双栏（M2-3 的验收点）。这里保持纯函数，便于单测与前端本地计算。
 *
 * 文件夹的领域规则（两层限制、可移动目标）在 `folders.ts`。
 * M2 的边界：`首页` / `Memo` / `待办` 三个视图分别在 M2-8 / M2-4 / M2-5 落地，
 * 在那之前导航项按"禁用并说明原因"呈现，不做空入口。
 *
 * M3-5：列表过滤接上**隐私门禁**（`filterByView` 的第三个参数）——判定本身在
 * `@menote/shared` 的 `privacy.ts`，这里只调用。
 */
import { canShowInList, type PrivacyGate } from "@menote/shared";
export interface ViewableItem {
  id: string;
  type: "note" | "table" | "memo";
  /** 隐私标记：列表过滤要用（M3 起由 `canShowInList` 统一判定） */
  enc_self: 0 | 1;
  in_enc_space: 0 | 1;
  deleted_at: number | null;
  starred: number;
  tags: string[];
  updated_at: number;
  /** 所属文件夹（`null`/缺省 = 根目录） */
  folder_id?: string | null;
}

export type NotesView =
  | { kind: "notebook"; folderId?: string | null }
  | { kind: "recent" }
  | { kind: "starred" }
  | { kind: "tag"; tag: string };

export const DEFAULT_VIEW: NotesView = { kind: "notebook" };

export function viewKey(view: NotesView): string {
  if (view.kind === "tag") return `tag:${view.tag}`;
  if (view.kind === "notebook" && view.folderId) return `folder:${view.folderId}`;
  return view.kind;
}

export function viewTitle(view: NotesView): string {
  switch (view.kind) {
    case "recent":
      return "最近编辑";
    case "starred":
      return "收藏";
    case "tag":
      return `# ${view.tag}`;
    default:
      return "全部笔记";
  }
}

/**
 * 按视图过滤（输入已按最近编辑倒序，见 `listLocalItems`）。
 *
 * **先过隐私门禁**（M3）：`canShowInList` 决定这一条此刻能不能出现在列表里——
 * 锁定时空间内条目直接不出现；单篇加密条目留在原位（标题明文）。
 * 标签云与文件夹计数**不经过这里**（统计一律计入全部内容，见《隐私锁设计》§4.7）。
 */
export function filterByView<T extends ViewableItem>(
  items: readonly T[],
  view: NotesView,
  gate: PrivacyGate,
): T[] {
  const visible = items.filter((item) => canShowInList(item, gate));
  switch (view.kind) {
    case "starred":
      return visible.filter((item) => item.starred === 1);
    case "tag":
      return visible.filter((item) => item.tags.includes(view.tag));
    case "notebook":
      // 选中某个文件夹时只显示它直接包含的条目；未选中（根目录/全部）显示全部
      return view.folderId
        ? visible.filter((item) => (item.folder_id ?? null) === view.folderId)
        : visible;
    case "recent":
    default:
      return visible;
  }
}

/** 标签云：统计每个标签的条目数，按条目数倒序、同数按名称升序 */
export function collectTags(
  items: readonly ViewableItem[],
): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag, "zh-Hans-CN"));
}

// ——————————————————————————— 文件夹相关的视图筛选 ———————————————————————————


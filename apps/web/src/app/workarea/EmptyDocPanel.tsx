/**
 * 正文空状态（components.md §三 `EmptyDocPanel`）。
 *
 * DESIGN.md §5.4-3：空状态必须给出口（为什么空 + 下一步做什么）。这里的出口是"用功能栏顶部
 * 的「新建笔记」"，所以文案写清位置，不放按钮（避免与功能栏的主操作重复成一个屏两个主操作）。
 */
import { EmptyState } from "../ui/Controls";

export function EmptyDocPanel() {
  return (
    <div className="docpane__center">
      <EmptyState
        title="还没有打开任何笔记"
        hint="从左侧选一篇，或者用功能栏顶部的「新建笔记」开始写。"
      />
    </div>
  );
}

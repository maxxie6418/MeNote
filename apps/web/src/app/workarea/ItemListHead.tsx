/**
 * 列表头（components.md §三 `ItemListHead`）：标题 + 条目数。
 * 标题随视图变化（全部笔记 / 最近编辑 / 收藏 / #标签），因此由调用方传入。
 */
export interface ItemListHeadProps {
  title: string;
  count: number;
}

export function ItemListHead({ title, count }: ItemListHeadProps) {
  return (
    <div className="listpane__head">
      <h2 className="listpane__title">{title}</h2>
      <span className="listpane__count">{count} 条</span>
    </div>
  );
}

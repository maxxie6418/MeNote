/**
 * 列表头（components.md §三 `ItemListHead`）：标题 + 条目数。
 * 标题随视图变化（全部笔记 / 最近编辑 / 收藏 / #标签），因此由调用方传入。
 *
 * 2026-09-28：加了**父级面包屑**（`工作 › 本周`）——用户在笔记本里要求"能看出层级结构"，
 * 列表头是最省的一处：不动列表行结构，就把"现在在哪个笔记本的哪一层"说清楚。
 * 面包屑只在**有父级**时出现（第 1 层笔记本的标题本身就是名字，不必重复）。
 */
export interface ItemListHeadProps {
  title: string;
  count: number;
  /** 当前视图的层级路径（`["工作", "本周"]`）；根视图传空数组或不传 */
  path?: readonly string[];
}

export function ItemListHead({ title, count, path = [] }: ItemListHeadProps) {
  const parents = path.length > 1 ? path.slice(0, -1) : [];
  return (
    <div className="listpane__head">
      <h2 className="listpane__title">
        {parents.length > 0 ? (
          <span className="listpane__path">{parents.join(" › ")} › </span>
        ) : null}
        {title}
      </h2>
      <span className="listpane__count">{count} 条</span>
    </div>
  );
}

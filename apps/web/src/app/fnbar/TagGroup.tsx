/**
 * 标签分组（components.md §六 `TagGroup` / `TagChip`；原型 `.group > .tags > .chip.tag`）。
 *
 * 标签来源是条目自身（`items.tags`，由 `@menote/mdcore` 从 YAML `tags` 与正文 `#标签` 派生）。
 * 点标签即切到该标签的筛选视图；再次点击同标签**不清空**（清空走「笔记本」）。
 * 标签的重命名 / 合并 / 删除第一版不做（Q17）。
 */
import { Chip } from "../ui/Chip";
import type { NotesView } from "../../features/notes/views";

export interface TagGroupProps {
  view: NotesView;
  onViewChange: (view: NotesView) => void;
  tags: ReadonlyArray<{ tag: string; count: number }>;
}

export function TagGroup({ view, onViewChange, tags }: TagGroupProps) {
  return (
    <div className="fnbar__group">
      <div className="group-title">标签</div>
      {tags.length === 0 ? (
        <div className="tags">
          <Chip variant="tag" disabled title="给笔记写上 #标签 或 YAML tags 后会出现">
            暂无标签
          </Chip>
        </div>
      ) : (
        <div className="tags">
          {tags.map((entry) => (
            <Chip
              key={entry.tag}
              variant="tag"
              active={view.kind === "tag" && view.tag === entry.tag}
              title={`${entry.count} 条`}
              onClick={() => onViewChange({ kind: "tag", tag: entry.tag })}
            >
              # {entry.tag}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

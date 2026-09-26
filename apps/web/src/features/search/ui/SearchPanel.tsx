/**
 * 搜索结果面板（components.md §七 `SearchPanel`；M2-6）。
 *
 * 三条行为：
 * - 结果在主操作区**单栏占满**（列表列 `wide`，正文列让位）；
 * - 结果带**高亮片段**：片段由 `search/model.ts` 以 `{before, match, after}` 返回，这里用 `<mark>`
 *   拼出来——不生成 HTML 字符串，也就不需要 `dangerouslySetInnerHTML`；
 * - **清空查询即回到进入前的视图**：这一点由 `App` 的渲染条件保证（搜索时不改浏览视图状态），
 *   面板本身不保存也不恢复视图。
 *
 * 筛选（类型 / 文件夹 / 标签 / 时间）都是**纯本地**的；「索引未建完」的兜底提示由调用方通过
 * `staleNotice` 传入。
 */
import { useState, type ReactNode } from "react";
import { Chip } from "../../../app/ui/Chip";
import { Icon } from "../../../app/ui/Icon";
import { SegmentedControl } from "../../../app/ui/SegmentedControl";
import type { LocalItem } from "../../../data/db";
import type { SnippetParts } from "../model";

export interface SearchResult {
  item: LocalItem;
  snippet: SnippetParts;
  score: number;
}

export interface SearchPanelProps {
  query: string;
  results: readonly SearchResult[];
  /** 文件夹名（按 id 查名字用于结果行的路径提示） */
  folderNames: Readonly<Record<string, string>>;
  filters: SearchFiltersState;
  onFiltersChange: (filters: SearchFiltersState) => void;
  /** 标签候选（来自现有条目） */
  tags: ReadonlyArray<string>;
  /** 索引未建完时的说明（例如"正在建立本地索引，当前结果可能不完整"） */
  staleNotice?: ReactNode;
  onOpen: (itemId: string) => void;
  onClose: () => void;
}

/** 界面层的筛选状态（`all` = 不限；时间用预设档，避免一个日历控件挡着一屏） */
export interface SearchFiltersState {
  type: "all" | "note" | "table" | "memo";
  folderId: "all" | string | null;
  tag: string | null;
  range: "all" | "week" | "month" | "year";
}

export const EMPTY_SEARCH_STATE: SearchFiltersState = {
  type: "all",
  folderId: "all",
  tag: null,
  range: "all",
};

const TYPE_OPTIONS = [
  { value: "all" as const, label: "全部类型" },
  { value: "note" as const, label: "笔记" },
  { value: "table" as const, label: "表格" },
  { value: "memo" as const, label: "Memo" },
];

const RANGE_OPTIONS = [
  { value: "all" as const, label: "不限时间" },
  { value: "week" as const, label: "近 7 天" },
  { value: "month" as const, label: "近 30 天" },
  { value: "year" as const, label: "近一年" },
];

export function SearchPanel({
  query,
  results,
  folderNames,
  filters,
  onFiltersChange,
  tags,
  staleNotice,
  onOpen,
  onClose,
}: SearchPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="searchpanel" aria-label="搜索结果">
      <header className="memopanel__head">
        <h2 className="memopanel__title">搜索</h2>
        <span className="listpane__count">
          「{query}」命中 {results.length} 条
        </span>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => setExpanded((previous) => !previous)}
          aria-expanded={expanded}
        >
          {expanded ? "收起筛选" : "筛选"}
        </button>
        <button type="button" className="btn btn--sm" onClick={onClose}>
          关闭
        </button>
      </header>

      {staleNotice ? (
        <div className="searchpanel__notice" role="status">
          {staleNotice}
        </div>
      ) : null}

      {expanded ? (
        <div className="searchpanel__filters">
          <SegmentedControl
            ariaLabel="按类型筛选"
            size="compact"
            value={filters.type}
            onChange={(type) => onFiltersChange({ ...filters, type })}
            options={TYPE_OPTIONS}
          />
          <SegmentedControl
            ariaLabel="按时间筛选"
            size="compact"
            value={filters.range}
            onChange={(range) => onFiltersChange({ ...filters, range })}
            options={RANGE_OPTIONS}
          />
          <div className="memopanel__tags">
            <Chip
              variant="tag"
              active={filters.folderId === "all"}
              onClick={() => onFiltersChange({ ...filters, folderId: "all" })}
            >
              全部位置
            </Chip>
            <Chip
              variant="tag"
              active={filters.folderId === null}
              onClick={() => onFiltersChange({ ...filters, folderId: null })}
            >
              根目录
            </Chip>
            {Object.entries(folderNames).map(([id, name]) => (
              <Chip
                key={id}
                variant="tag"
                active={filters.folderId === id}
                onClick={() => onFiltersChange({ ...filters, folderId: id })}
              >
                {name}
              </Chip>
            ))}
          </div>
          {tags.length > 0 ? (
            <div className="memopanel__tags">
              <Chip
                variant="tag"
                active={filters.tag === null}
                onClick={() => onFiltersChange({ ...filters, tag: null })}
              >
                全部标签
              </Chip>
              {tags.map((tag) => (
                <Chip
                  key={tag}
                  variant="tag"
                  active={filters.tag === tag}
                  onClick={() => onFiltersChange({ ...filters, tag: filters.tag === tag ? null : tag })}
                >
                  # {tag}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="searchpanel__body">
        {results.length === 0 ? (
          <div className="memo-empty">
            <p className="memo-empty__title">没有找到匹配的内容</p>
            <p className="memo-empty__hint">
              换个说法试试；也可以用「筛选」按类型、位置、标签或时间缩小范围。清空搜索框即可回到刚才的视图。
            </p>
          </div>
        ) : (
          <ul className="searchlist">
            {results.map((result) => (
              <li key={result.item.id}>
                <button
                  type="button"
                  className="searchrow"
                  onClick={() => onOpen(result.item.id)}
                >
                  <span className="searchrow__title">
                    {result.item.title ??
                      (result.item.type === "memo" ? "Memo" : (folderNames[result.item.id] ?? "未命名"))}
                  </span>
                  <span className="searchrow__snippet">
                    {result.snippet.before}
                    {result.snippet.match ? <mark>{result.snippet.match}</mark> : null}
                    {result.snippet.after}
                  </span>
                  <span className="itemrow__meta">
                    <span>{result.item.type === "memo" ? "Memo" : "笔记"}</span>
                    {result.item.folder_id !== null ? (
                      <span>{folderNames[result.item.folder_id] ?? "已归档"}</span>
                    ) : (
                      <span>根目录</span>
                    )}
                    {result.item.tags.length > 0 ? <span>#{result.item.tags.join(" #")}</span> : null}
                    <Icon name="chevron-right" size={13} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

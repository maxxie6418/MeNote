/**
 * 搜索的接线（M2-6）：查询状态、本地索引检索、索引未建完时的服务端回退与合并。
 *
 * 从 `App` 里抽出来有两个原因：一是 `App.tsx` 有 500 行预算（架构 §2.3.1），二是这段逻辑
 * 只依赖"条目列表"与"Memo 列表"，本来就属于搜索这个 feature。
 *
 * 三条口径：
 * - **不改浏览视图状态**：清空查询即回到进入搜索前的视图（由调用方的渲染条件保证）；
 * - **本地优先**：索引命中为主；索引没建完才回退服务端补齐，并按 id 合并（本地在前）；
 * - 回退失败（离线 / 服务端出错）时只用本地结果，不弹错。
 */
import { useCallback, useEffect, useState } from "react";
import { isSearchIndexComplete, searchLocal, type LocalItem } from "../../data/db";
import { searchApi } from "../../data/api/endpoints";
import { makeSnippet, mergeBy } from "./model";
import {
  EMPTY_SEARCH_STATE,
  type SearchFiltersState,
  type SearchResult,
} from "./ui/SearchPanel";

export interface UseSearchOptions {
  /** 未删除的笔记与表格 */
  items: readonly LocalItem[];
  /** 未删除的 Memo（搜索也覆盖它们） */
  memos: readonly LocalItem[];
}

export interface SearchState {
  query: string;
  setQuery: (value: string) => void;
  filters: SearchFiltersState;
  setFilters: (filters: SearchFiltersState) => void;
  results: SearchResult[];
  /** 索引还没建完（界面据此提示"结果可能不完整"） */
  stale: boolean;
  /** 筛选用的标签候选：笔记与 Memo 的并集，按出现次数倒序 */
  tags: string[];
  /** 进入某条结果后清空查询（回到原视图） */
  clear: () => void;
}

const RANGE_DAYS: Record<Exclude<SearchFiltersState["range"], "all">, number> = {
  week: 7,
  month: 30,
  year: 365,
};

export function useSearch({ items, memos }: UseSearchOptions): SearchState {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFiltersState>(EMPTY_SEARCH_STATE);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const text = query.trim();
    let alive = true;

    // setState 一律放在异步回调里（effect 体内同步 setState 会引发级联渲染）
    void (async () => {
      if (text === "") {
        if (!alive) return;
        setResults([]);
        setStale(false);
        return;
      }

      const from =
        filters.range === "all"
          ? null
          : Date.now() - RANGE_DAYS[filters.range] * 24 * 60 * 60 * 1000;

      const complete = await isSearchIndexComplete();
      const localResults: SearchResult[] = await searchLocal(text, {
        type: filters.type,
        folderId: filters.folderId,
        tag: filters.tag,
        from,
      });

      // 索引还没建完 → 回退服务端补齐（离线或失败就只用本地结果）
      let remoteResults: SearchResult[] = [];
      if (!complete) {
        try {
          const remote = await searchApi.query({
            q: text,
            type: filters.type,
            folder:
              filters.folderId === "all"
                ? undefined
                : filters.folderId === null
                  ? "root"
                  : filters.folderId,
            tag: filters.tag ?? undefined,
            from: from ?? undefined,
          });
          remoteResults = remote.results.map((row) => ({
            item: {
              id: row.id,
              type: row.type,
              folder_id: row.folder_id,
              title: row.title,
              tags: row.tags,
              updated_at: row.updated_at,
            },
            snippet: makeSnippet(row.snippet, text),
            score: 0,
          }));
        } catch {
          remoteResults = [];
        }
      }

      if (!alive) return;
      setResults(mergeBy((row) => row.item.id, localResults, remoteResults));
      setStale(!complete);
    })();

    return () => {
      alive = false;
    };
  }, [filters, query]);

  const tags = (() => {
    const counts = new Map<string, number>();
    for (const item of [...items, ...memos]) {
      for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
      .map(([tag]) => tag);
  })();

  const clear = useCallback(() => setQuery(""), []);

  return { query, setQuery, filters, setFilters, results, stale, tags, clear };
}

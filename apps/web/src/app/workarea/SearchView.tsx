/**
 * 搜索结果视图的组装（M2-6）：把结果面板放进主操作区（单栏占满）。
 *
 * 单独一个文件是为了给 `App.tsx` 留出 500 行预算（架构 §2.3.1）。
 */
import { TwoPane } from "./TwoPane";
import {
  SearchPanel,
  type SearchFiltersState,
  type SearchResult,
} from "../../features/search/ui/SearchPanel";

export interface SearchViewProps {
  query: string;
  results: readonly SearchResult[];
  folderNames: Readonly<Record<string, string>>;
  filters: SearchFiltersState;
  onFiltersChange: (filters: SearchFiltersState) => void;
  tags: ReadonlyArray<string>;
  staleNotice?: React.ReactNode;
  onOpen: (itemId: string) => void;
  onClose: () => void;
}

export function SearchView(props: SearchViewProps) {
  return (
    <TwoPane
      listHidden={true}
      list={null}
      doc={
        <SearchPanel
          query={props.query}
          results={props.results}
          folderNames={props.folderNames}
          filters={props.filters}
          onFiltersChange={props.onFiltersChange}
          tags={props.tags}
          staleNotice={props.staleNotice}
          onOpen={props.onOpen}
          onClose={props.onClose}
        />
      }
    />
  );
}

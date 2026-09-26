/**
 * 首页视图的组装（M2-8）：把首页面板放进主操作区（单栏占满）。
 *
 * 单独一个文件是为了给 `App.tsx` 留出 500 行预算（架构 §2.3.1）——`App` 只负责把数据与回调
 * 递进来，视图怎么摆在这里说。
 */
import { TwoPane } from "./TwoPane";
import { HomePanel } from "../../features/home/ui/HomePanel";
import type { LocalItem } from "../../data/db";

export interface HomeViewProps {
  items: readonly LocalItem[];
  memos: readonly LocalItem[];
  folders: ReadonlyArray<{ id: string; name: string }>;
  titles: Readonly<Record<string, string>>;
  memoLocked?: boolean;
  onNewNote: () => void;
  onFocusComposer: (mode: "memo" | "task") => void;
  onFocusSearch: () => void;
  onOpenItem: (itemId: string) => void;
  onOpenView: (view: "recent" | "starred" | "memo" | "task" | "notebook") => void;
  onOpenFolder: (folderId: string) => void;
  onOpenTag: (tag: string) => void;
}

export function HomeView(props: HomeViewProps) {
  return (
    <TwoPane
      listHidden={true}
      list={null}
      doc={
        <HomePanel
          items={props.items}
          memos={props.memos}
          folders={props.folders}
          titles={props.titles}
          memoLocked={props.memoLocked}
          onNewNote={props.onNewNote}
          onFocusComposer={props.onFocusComposer}
          onFocusSearch={props.onFocusSearch}
          onOpenItem={props.onOpenItem}
          onOpenView={props.onOpenView}
          onOpenFolder={props.onOpenFolder}
          onOpenTag={props.onOpenTag}
        />
      }
    />
  );
}

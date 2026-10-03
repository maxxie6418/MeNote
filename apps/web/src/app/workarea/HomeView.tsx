/**
 * 首页视图的组装（M2-8）：把首页面板放进主操作区（单栏占满）。
 *
 * 单独一个文件是为了给 `App.tsx` 留出 500 行预算（架构 §2.3.1）——`App` 只负责把数据与回调
 * 递进来，视图怎么摆在这里说。
 */
import { useMemo } from "react";
import { TwoPane } from "./TwoPane";
import { HomePanel } from "../../features/home/ui/HomePanel";
import { taskTitle } from "../../features/tasks/model";
import type { LocalItem } from "../../data/db";
import type { PrivacyGate } from "@menote/shared";

export interface HomeViewProps {
  items: readonly LocalItem[];
  memos: readonly LocalItem[];
  folders: ReadonlyArray<{ id: string; name: string }>;
  /**
   * Memo 正文缓存（首页「今日待办」的标题来源）。
   *
   * 传**原始内容**而不是派生的 `titles` 字典：派生就在这里做——`App.tsx` 有 500 行硬上限，
   * 而这个字典只有本页一个消费者，放在这儿离使用点更近。
   */
  memoContents: Readonly<Record<string, { content: string }>>;
  /** 隐私门禁（M3-5）：首页据此决定 Memo 派生预览是否占位、最近动态是否列出空间内条目 */
  gate: PrivacyGate;
  onNewNote: () => void;
  onFocusComposer: (mode: "memo" | "task") => void;
  onFocusSearch: () => void;
  onOpenItem: (itemId: string) => void;
  onOpenView: (view: "recent" | "starred" | "memo" | "task" | "notebook") => void;
  onOpenFolder: (folderId: string) => void;
  onOpenTag: (tag: string) => void;
  /** 「打开加密空间」（M7）：三态由 `App` 分发，这里只透传 */
  onOpenVault: () => void;
  /** 隐私锁三态与"没启用时的可见说明"（M7：置灰必须说明原因） */
  vaultEntry: { enabled: boolean; locked: boolean; reason: string | null };
}

export function HomeView(props: HomeViewProps) {
  /** 待办预览的标题：Memo 正文首行（`taskTitle` 与待办视图同一份口径） */
  const titles = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(props.memoContents).map(([id, entry]) => [id, taskTitle(entry.content)]),
      ),
    [props.memoContents],
  );

  return (
    <TwoPane
      listHidden={true}
      list={null}
      doc={
        <HomePanel
          items={props.items}
          memos={props.memos}
          folders={props.folders}
          titles={titles}
          gate={props.gate}
          onNewNote={props.onNewNote}
          onFocusComposer={props.onFocusComposer}
          onFocusSearch={props.onFocusSearch}
          onOpenItem={props.onOpenItem}
          onOpenView={props.onOpenView}
          onOpenFolder={props.onOpenFolder}
          onOpenTag={props.onOpenTag}
          onOpenVault={props.onOpenVault}
          vaultEntry={props.vaultEntry}
        />
      }
    />
  );
}

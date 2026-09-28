/**
 * Memo 视图在组合根里的接线（M2-4 建；M3-9 从 `App.tsx` 抽出，为入口文件的行数预算让位）。
 *
 * 只负责"把数据与回调递给 `MemoPanel`"，含两条跳转：转成笔记后**直接打开新笔记**（Q10）、
 * 打开已转出的笔记。视图怎么摆是 `MemoPanel` 的事。
 */
import type { LocalItem, MemoContent } from "../../data/db";
import type { MemoSidebarSettings, PrivacyGate } from "@menote/shared";
import { MemoPanel } from "../../features/memos/ui/MemoPanel";
import { useMemoImages } from "../../features/memos/useMemoImages";
import { TwoPane } from "./TwoPane";

export interface MemoViewProps {
  memos: readonly LocalItem[];
  contents: Readonly<Record<string, MemoContent>>;
  timeZone: string;
  gate: PrivacyGate;
  onUnlock: () => void;
  onSave: (itemId: string, text: string) => void;
  onTogglePinned: (itemId: string) => void;
  /** 转成笔记：调用方负责"回到笔记视图并打开它" */
  onConvert: (itemId: string) => void;
  onOpenConverted: (noteId: string) => void;
  onAdd: () => void;
  /** 删除 Memo（M4-12）：移入回收站 */
  onDelete: (itemId: string) => void;
  /** 侧栏模块的顺序与隐藏（用户设置 `memo_view.sidebar`） */
  sidebar?: MemoSidebarSettings;
}

export function MemoView(props: MemoViewProps) {
  /*
    图册要用的图片索引在**组合根**读（面板与模块不碰数据访问）：本地附件元数据是纯读，
    不该让展示组件去 import 数据层。依赖是条目 id 集合，同步刷新不会重复查表。
  */
  const images = useMemoImages(props.memos);

  return (
    <TwoPane
      listHidden={true}
      list={null}
      doc={
        <MemoPanel
          memos={props.memos}
          contents={props.contents}
          timeZone={props.timeZone}
          gate={props.gate}
          onUnlock={props.onUnlock}
          onSave={props.onSave}
          onTogglePinned={props.onTogglePinned}
          onConvert={props.onConvert}
          onOpenConverted={props.onOpenConverted}
          onAdd={props.onAdd}
          onDelete={props.onDelete}
          sidebar={props.sidebar}
          images={images}
        />
      }
    />
  );
}

/**
 * Memo 视图在组合根里的接线（M2-4 建；M3-9 从 `App.tsx` 抽出，为入口文件的行数预算让位）。
 *
 * 只负责"把数据与回调递给 `MemoPanel`"，含两条跳转：转成笔记后**直接打开新笔记**（Q10）、
 * 打开已转出的笔记。视图怎么摆是 `MemoPanel` 的事。
 */
import type { LocalItem, MemoContent } from "../../data/db";
import type { PrivacyGate } from "@menote/shared";
import { MemoPanel } from "../../features/memos/ui/MemoPanel";
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
}

export function MemoView(props: MemoViewProps) {
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
        />
      }
    />
  );
}

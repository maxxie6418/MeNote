/**
 * 主操作区（components.md §三 WorkArea；M2-2）。
 *
 * `TwoPane`：左列条目列表 + 右侧正文的双栏容器。四个视图共用它（M2-3 验收点）；
 * 首页/Memo/待办这些"单栏占满"的视图走 `listHidden` / `docCentered` 两个开关，
 * 从而不需要第二套骨架（DESIGN.md 禁止项 #17）。
 */
import type { ReactNode } from "react";

export interface TwoPaneProps {
  list: ReactNode;
  doc: ReactNode;
  /** 首页等单栏视图：整列列表让位给正文 */
  listHidden?: boolean;
  /** 正文居中（空状态、首页面板） */
  docCentered?: boolean;
}

export function TwoPane({ list, doc, listHidden = false, docCentered = false }: TwoPaneProps) {
  return (
    <div className="two-pane">
      {listHidden ? null : list}
      <div className={docCentered ? "two-pane__doc two-pane__doc--center" : "two-pane__doc"}>
        {doc}
      </div>
    </div>
  );
}

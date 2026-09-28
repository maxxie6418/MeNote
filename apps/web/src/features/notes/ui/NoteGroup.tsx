/**
 * 列表里的一个**文件夹分组**（B2 批；设计稿 §二）。
 *
 * 只负责"组头 + 折叠 + 子分组"，**行的渲染由列表通过 `renderRows` 传进来**——
 * 行的 props 在 `NoteList` 里只保留一份，两处各写一份迟早漂移；而且在这里新造回调
 * 会让 `NoteRow` 的 `memo` 失效（那是 2026-09-27 性能修复专门盯住的东西）。
 *
 * 折叠状态留在本组件内（与 `FolderTree` 同一套做法）：纯展示，不进设置也不进本地库。
 */
import { useState, type ReactNode } from "react";
import type { LocalItem } from "../../../data/db";
import { Icon } from "../../../app/ui/Icon";
import type { NoteGroup } from "../groups";

export interface NoteGroupViewProps {
  group: NoteGroup<LocalItem>;
  renderRows: (items: LocalItem[]) => ReactNode;
  /**
   * 不渲染组头（选中某个笔记本时给顶层那一组用）：列表头已经写着文件夹名与路径，
   * 再来一行同名组头只是噪音。子分组不受影响。
   */
  hideHeader?: boolean;
}

export function NoteGroupView({ group, renderRows, hideHeader = false }: NoteGroupViewProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isSub = group.depth === 2;

  return (
    <section
      className={isSub ? "notelist__group is-sub" : "notelist__group"}
      aria-label={group.name}
    >
      {hideHeader ? null : (
        <div className="notelist__head">
          <button
            type="button"
            className="notelist__collapse"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "展开" : "收起"}「${group.name}」`}
            title={collapsed ? "展开" : "收起"}
            onClick={() => setCollapsed((value) => !value)}
          >
            <Icon name="chevron-down" size={13} />
          </button>
          <span className="notelist__folder">
            <Icon name="folder" size={13} />
          </span>
          <span className="notelist__name">{group.name}</span>
          {/* 实时计数必须可见（DESIGN.md 禁止项 #8）；带「条」与待办分组头同一口径 */}
          <span className="notelist__n">{group.items.length} 条</span>
        </div>
      )}

      {collapsed ? null : (
        <>
          {group.items.length > 0 ? (
            <ul className="notelist__rows">{renderRows(group.items)}</ul>
          ) : null}
          {group.children.map((child) => (
            <NoteGroupView
              key={child.folderId ?? child.name}
              group={child}
              renderRows={renderRows}
            />
          ))}
        </>
      )}
    </section>
  );
}

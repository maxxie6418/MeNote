/**
 * 功能栏（DESIGN.md §2.2：宽 294px；§2.7：**只有导航区滚动**）。
 *
 * 结构与间距照抄原型，以保住「新建按钮 38px + 录入框 136px → 导航区顶部 y = 252」的
 * 结构不变量（DESIGN.md §2.5-2）：
 *   54(顶栏) + 12(padding) + 38(按钮) + 12(录入框上边距) + 136(录入框) = 252
 *
 * 组成：新建按钮 + 快速录入框（`.fnbar__top`，固定不滚）/ 浏览三段 + 导航 + 笔记本分组 +
 * 标签分组（`.fnbar__scroll`，唯一滚动区）/ 加密空间（`.fnbar__vault`，**贴底固定**）。
 * **功能栏内不出现账户区**——账户入口只在顶栏（DESIGN.md §2.5-1）。
 */
import { Icon } from "../ui/Icon";
import { Composer } from "./Composer";
import { NavList } from "./NavList";
import { NavSegmented, type BrowsableView } from "./NavSegmented";
import { TagGroup } from "./TagGroup";
import { VaultNode } from "./VaultNode";
import type { NotesView } from "../../features/notes/views";

export interface FnBarProps {
  onNewNote: () => void;
  /** 笔记模式发布：首行作标题 */
  onPublishNote: (title: string, body: string) => void;
  view: NotesView;
  onViewChange: (view: NotesView) => void;
  tags: ReadonlyArray<{ tag: string; count: number }>;
  /**
   * 笔记本分组（树 + `+` 菜单）由 `App` 作为插槽传入：功能栏是通用容器，
   * 不该反向依赖 notes 这个 feature（架构 §2.3.3 的依赖方向）。
   */
  notebookPanel: React.ReactNode;
  /** 浏览三段的当前项（M2-4/M2-5/M2-8 接入前恒为空） */
  browseView?: BrowsableView;
  onBrowseChange?: (view: BrowsableView) => void;
}

export function FnBar({
  onNewNote,
  onPublishNote,
  view,
  onViewChange,
  tags,
  notebookPanel,
  browseView,
  onBrowseChange,
}: FnBarProps) {
  return (
    <aside className="fnbar">
      <div className="fnbar__top">
        <button type="button" className="btn-new" onClick={onNewNote}>
          <Icon name="plus" size={16} />
          新建笔记
        </button>
        <Composer onPublishNote={onPublishNote} />
      </div>

      <div className="fnbar__scroll">
        <NavSegmented active={browseView} onSelect={onBrowseChange} />
        <NavList view={view} onViewChange={onViewChange} />
        {notebookPanel}
        <TagGroup view={view} onViewChange={onViewChange} tags={tags} />
      </div>

      <VaultNode />
    </aside>
  );
}

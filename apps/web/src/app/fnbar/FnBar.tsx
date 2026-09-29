/**
 * 功能栏（DESIGN.md §2.2：宽 294px；§2.7 的滚动归属见下）。
 *
 * 结构与间距照抄原型，以保住「新建按钮 38px + 录入框 136px → 导航区顶部 y = 252」的
 * 结构不变量（DESIGN.md §2.5-2）：
 *   54(顶栏) + 12(padding) + 38(按钮) + 12(录入框上边距) + 136(录入框) = 252
 *
 * 组成（自上而下）：
 * 1. `.fnbar__top`——新建按钮 + 快速录入框（固定，不滚）；
 * 2. `.fnbar__scroll`——浏览三段 + 导航 + 笔记本分组（**唯一跟着内容滚的区域**）；
 * 3. `.fnbar__tags`——**标签区（贴底固定）**【2026-09-29 用户要求：不再排在笔记本树之后、
 *    不被树的内容推挤，也不随导航区滚动；高度按"功能栏底部约 1/3～1/4"预留，标签用按钮铺开】；
 * 4. `.fnbar__vault`——加密空间节点（**贴底固定**）。
 *
 * **功能栏内不出现账户区**——账户入口只在顶栏（DESIGN.md §2.5-1）。
 */
import { Icon } from "../ui/Icon";
import type { TaskPriority } from "@menote/mdcore";
import { Composer, type ComposerMode } from "./Composer";import { NavList } from "./NavList";
import { NavSegmented, type BrowsableView } from "./NavSegmented";
import { TagGroup } from "./TagGroup";
import { VaultNode, type VaultNodeProps } from "./VaultNode";
import type { NotesView } from "../../features/notes/views";

export interface FnBarProps {
  onNewNote: () => void;
  /** 笔记模式发布：首行作标题 */
  onPublishNote: (title: string, body: string) => void;
  /** Memo 模式发布：`asTask` = 用户确认了"设为清单？" */
  onPublishMemo: (text: string, options: { asTask: boolean }) => void;
  /** 待办模式发布（M2-5） */
  onPublishTask: (text: string, options: { due: string | null; priority: TaskPriority }) => void;
  view: NotesView;
  onViewChange: (view: NotesView) => void;
  tags: ReadonlyArray<{ tag: string; count: number }>;
  /**
   * 笔记本分组（树 + `+` 菜单）由 `App` 作为插槽传入：功能栏是通用容器，
   * 不该反向依赖 notes 这个 feature（架构 §2.3.3 的依赖方向）。
   */
  notebookPanel: React.ReactNode;
  /**
   * 加密空间节点（M3-6）：三态与计数由 `App` 组装后传入——
   * 功能栏不认识隐私锁状态机（架构 §2.3.3 的依赖方向）。
   */
  vault: VaultNodeProps;
  /** 浏览三段的当前项（M2-4/M2-5/M2-8 接入前恒为空） */
  browseView?: BrowsableView;
  onBrowseChange?: (view: BrowsableView) => void;
  /** 未选首页作为启动视图时不显示首页项（需求 §7.4） */
  showHome?: boolean;
  /** 录入框模式受控（M2-8 首页的「记录 Memo / 新建待办」要切档） */
  composerMode?: ComposerMode;
  onComposerModeChange?: (mode: ComposerMode) => void;
  /** 「笔记」档的落点提示（当前笔记本名；缺省「根目录」）——见 `Composer.noteTargetLabel` */
  noteTargetLabel?: string;
}

export function FnBar({
  onNewNote,
  onPublishNote,
  onPublishMemo,
  onPublishTask,
  view,
  onViewChange,
  tags,
  notebookPanel,
  vault,
  browseView,
  onBrowseChange,
  showHome = true,
  composerMode,
  onComposerModeChange,
  noteTargetLabel,
}: FnBarProps) {
  return (
    <aside className="fnbar">
      <div className="fnbar__top">
        <button type="button" className="btn-new" onClick={onNewNote}>
          <Icon name="plus" size={16} />
          新建笔记
        </button>
        <Composer
          onPublishNote={onPublishNote}
          onPublishMemo={onPublishMemo}
          onPublishTask={onPublishTask}
          mode={composerMode}
          onModeChange={onComposerModeChange}
          noteTargetLabel={noteTargetLabel}
        />
      </div>

      <div className="fnbar__scroll">
        <NavSegmented active={browseView} onSelect={onBrowseChange} showHome={showHome} />
        <NavList view={view} onViewChange={onViewChange} />
        {notebookPanel}
      </div>

      {/*
        标签区：**贴底固定**（2026-09-29 用户要求）。
        以前它排在笔记本树之后、在同一个滚动区里，树一长就被推到看不见的地方；
        现在与加密空间节点一样是固定段，导航区怎么滚都动不了它。
      */}
      <TagGroup view={view} onViewChange={onViewChange} tags={tags} />

      <VaultNode {...vault} />
    </aside>
  );
}

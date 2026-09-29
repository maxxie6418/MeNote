/**
 * 条目列表（左列 330px；结构见 `docs/modules/Menote-M1-界面稿-v1.md` §四）。
 *
 * 规则：点条目**在右列直接打开**（不许走侧滑详情，DESIGN.md 禁止项 #15）；
 * 空列表必须给出口（DESIGN.md §5.4-3）；键盘可选中并用 `Enter` 打开。
 *
 * 这个文件只管**列表外壳**（提示条 / 表头 / 骨架 / 空状态 / 行循环）；
 * 单行的结构与它的渲染成本守卫在 `NoteRow.tsx`（那一层必须 `memo`，否则整表重渲染）。
 */
import { memo } from "react";
import type { ReactNode } from "react";
import type { LocalItem } from "../../../data/db";
import { Button, EmptyState } from "../../../app/ui/Controls";
import { Icon } from "../../../app/ui/Icon";
import { ItemListHead } from "../../../app/workarea/ItemListHead";
import type { NoteGroup } from "../groups";
import { NoteGroupView } from "./NoteGroup";
import { NoteRow } from "./NoteRow";

export interface NoteListProps {
  items: LocalItem[];
  /** 列表头标题（随视图变化：全部笔记 / 最近编辑 / 收藏 / #标签） */
  title: string;
  /**
   * 滚动区顶部的附加块（加密空间用它挂**空间内的文件夹树**；2026-09-29 从功能栏搬来）。
   *
   * 放在**同一个滚动容器**里（不新增第二层滚动，`DESIGN.md` §2.7），所以它会随列表一起滚。
   */
  top?: ReactNode;
  /** 当前视图的层级路径（笔记本视图才有；见 `ItemListHead`） */
  path?: readonly string[];
  /**
   * **按文件夹分组**（B2 批）：只有「笔记本」视图才传（由 `NotesPane` 用 `groupNotesByFolder` 算好）。
   * 不传或空数组 = 现有扁平列表（最近编辑 / 收藏 / 标签 / 搜索都走这条）。
   */
  groups?: ReadonlyArray<NoteGroup<LocalItem>>;
  /** 分组时是否隐藏**顶层**那一组的组头（选中某个笔记本时用：列表头已经写着名字与路径） */
  hideGroupRootHeader?: boolean;
  selectedId: string | null;
  loading: boolean;
  /** 行内摘要（已缓存正文的第一行，可缺省） */
  summaries?: Record<string, string>;
  /** 文件夹列表：给"移动到…"用（两层，扁平列出即可） */
  folders?: ReadonlyArray<{ id: string; name: string }>;
  onSelect: (id: string) => void;
  onNewNote: () => void;
  onMove?: (id: string, folderId: string | null) => void;
  onTogglePinned?: (id: string) => void;
  onToggleStarred?: (id: string) => void;
  /**
   * 删除（M4-12）：**只报事件**，二次确认与"移入回收站"由上层做——
   * 列表行不该自己弹确认框（同一个确认逻辑还要给编辑器「更多」菜单用）。
   */
  onDelete?: (id: string) => void;
  /**
   * 加密空间的移入/移出（M3-8；《隐私锁设计》§6.3、§8）。
   *
   * 三条口径直接体现在菜单里：
   * - **未启用隐私锁**：不提供移入入口，菜单项置灰并说明去哪里启用；
   * - **锁定态**：只能移入**空间根**（`folders` 传空即可，内部层级此时不可见）；**移出**不可用（要先解锁）；
   * - 已在空间里的条目才显示「移出加密空间」。
   *
   * **必须是稳定引用**（`NotesPane` 用 `useMemo` 保证）：它进 `NoteRow` 的 props 浅比较。
   */
  vault?: {
    enabled: boolean;
    locked: boolean;
    /** 空间根 id；还没同步下来时给 `null`（此时不给移入入口） */
    id: string | null;
    /** 空间内文件夹（锁定时应为空数组） */
    folders: ReadonlyArray<{ id: string; name: string }>;
    onMoveIn: (itemId: string, folderId: string | null) => void;
    onMoveOut: (itemId: string) => void;
  };
  /**
   * 本次浏览器会话里**已逐篇解密**的条目 id（M3-10）。
   *
   * 它决定列表行显示"已加密"还是"已解密"——两套标识里的**单篇态**：
   * 单篇门禁与隐私锁态互不影响，所以这里单独传，不从 gate 里猜。
   */
  unlockedItemIds?: ReadonlySet<string>;
  /**
   * 可承载动作的面板提示（M4-12 的「撤销」）。
   *
   * 为什么不是轻提示：`DESIGN.md` §6.6 明确"轻提示**不承载需要用户行动的信息**（会被错过）"，
   * 而界面稿 §6.6 要求删除后"提供撤销"。两个都满足的做法就是把它放进**面板提示**——
   * 区块内信息条，本来就是这个用途（需要持续可见的说明与后果）。
   */
  notice?: {
    message: string;
    actionLabel: string;
    onAction: () => void;
  } | null;
}

/** 空状态的文案随视图不同——收藏空与笔记空的原因不一样，出口也不一样 */
function emptyCopy(title: string): { title: string; hint: string } {
  if (title === "收藏") {
    return {
      title: "还没有收藏的笔记",
      hint: "在条目的更多菜单里点「收藏」，它就会出现在这里。",
    };
  }
  if (title.startsWith("# ")) {
    return { title: "这个标签下还没有笔记", hint: "换一个标签，或给笔记写上前缀 # 的标签。" };
  }
  return {
    title: "还没有笔记",
    hint: "点左上角的「新建笔记」开始写第一篇；写下的内容会先存在本机，联网后自动上传。",
  };
}

export function NoteListView({
  items,
  title,
  top,
  path = [],
  groups,
  hideGroupRootHeader = false,
  selectedId,
  loading,
  summaries = {},
  folders = [],
  onSelect,
  onNewNote,
  onMove,
  onTogglePinned,
  onToggleStarred,
  vault,
  unlockedItemIds,
  onDelete,
  notice,
}: NoteListProps) {
  const empty = emptyCopy(title);
  /** 这一篇在本次浏览器会话里是否已解密（单篇门禁与隐私锁态无关，故单独问） */
  const isUnlocked = (itemId: string): boolean => unlockedItemIds?.has(itemId) ?? false;

  /**
   * 行的渲染**只有这一份**：分组视图与扁平视图共用（`NoteGroupView` 拿到的是这个函数）。
   * 每次渲染新建这个函数是安全的——`NoteRow` 的 `memo` 比的是**行自己的 props**
   * （item / selected / summary / 回调），不含这个函数。
   */
  const renderRows = (rows: LocalItem[]) =>
    rows.map((item) => (
      <NoteRow
        key={item.id}
        item={item}
        selected={item.id === selectedId}
        summary={summaries[item.id]}
        unlocked={isUnlocked(item.id)}
        folders={folders}
        vault={vault}
        onSelect={onSelect}
        onMove={onMove}
        onTogglePinned={onTogglePinned}
        onToggleStarred={onToggleStarred}
        onDelete={onDelete}
      />
    ));

  return (
    <section className="listpane" aria-label="笔记列表">
      {notice ? (
        <div className="panel-hint" role="status">
          <span>{notice.message}</span>
          <button type="button" className="link" onClick={notice.onAction}>
            {notice.actionLabel}
          </button>
        </div>
      ) : null}
      <ItemListHead title={title} count={items.length} path={path} />

      <div className="listpane__scroll">
        {top}
        {loading ? (
          <div style={{ display: "grid", gap: 10, padding: 8 }}>
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: "var(--sp-6) var(--sp-4)" }}>
            <EmptyState
              title={empty.title}
              hint={empty.hint}
              action={
                <Button variant="secondary" size="sm" onClick={onNewNote}>
                  <Icon name="plus" size={13} />
                  新建笔记
                </Button>
              }
            />
          </div>
        ) : groups && groups.length > 0 ? (
          /* 分组视图（笔记本视图）：组头 + 组内行 + 子夹二级组 */
          <div className="notelist">
            {groups.map((group, index) => (
              <NoteGroupView
                key={group.folderId ?? `group-${index}`}
                group={group}
                renderRows={renderRows}
                hideHeader={hideGroupRootHeader && index === 0}
              />
            ))}
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{renderRows(items)}</ul>
        )}
      </div>
    </section>
  );
}

/**
 * 列表外壳（`memo`）。
 *
 * 为什么还要在**外壳**上 memo（行已经有 `NoteRow.memo` 了）：外壳每次渲染都要
 * `items.map()` 铺一遍 N 个元素、React 也要走一遍这 N 个 children——
 * 2000 篇时这一趟就是几十毫秒。它的 props 在"只是换了别的状态"时全都不变
 * （`items` / `summaries` / `folders` / 回调都由 `useNotesWorkspace` 与 `NotesPane` 保证身份稳定），
 * 于是这类提交可以整块跳过。
 *
 * 谁依赖这一点：正文区"正在打开…"占位的那次提交（B 步）——它**故意不动 `selectedId`**，
 * 就为了让列表这次完全不重渲染（见 `useNotesWorkspace.open` 与 `openingId` 的注释）。
 */
export const NoteList = memo(NoteListView);

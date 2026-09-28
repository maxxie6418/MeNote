/**
 * 笔记本树（components.md §六 `FolderTree` / `FolderNode`；需求 §4.5 两层限制）。
 *
 * 两条硬约束：
 * 1. **最多两层**——第 2 层文件夹**不提供"新建子文件夹"入口**（不是禁用，而是该位置永远没有
 *    合法动作，所以根本不出现）；
 * 2. 节点上带条目计数，一眼看出每个文件夹里有多少条。
 *
 * 2026-09-28（用户要求"界面上要能看出层级结构"）：父节点加**折叠三角**、子层加**引导线**——
 * 层级不再只靠 16px 缩进表达。折叠状态只在本组件内（纯展示状态，不进数据）。
 *
 * 每个节点带"更多"菜单：重命名 / 移动到… / 新建子文件夹（仅第 1 层）。菜单项禁用时都带原因。
 * 放在 `features/notes/`（不是 `app/fnbar/`）：功能栏只是容器，由 `App` 把本组件作为插槽传进去，
 * 这样 `app/` 不反向依赖具体 feature（架构 §2.3.3 的依赖方向）。
 */
import { useState } from "react";
import type { LocalFolder, LocalItem } from "../../../data/db";
import { Icon } from "../../../app/ui/Icon";
import { DropdownMenu, type MenuItemSpec } from "../../../app/ui/Menu";
import { canCreateChildFolder } from "../folders";

export interface FolderTreeProps {
  folders: readonly LocalFolder[];
  /** 当前选中的文件夹（null = 根目录） */
  selectedId: string | null;
  onSelect: (folderId: string) => void;
  /** 每个文件夹直接包含的条目数 */
  counts: Readonly<Record<string, number>>;
  onRename: (folder: LocalFolder) => void;
  onMove: (folder: LocalFolder) => void;
  onCreateChild: (folder: LocalFolder) => void;
  /**
   * 整夹移入 / 移出加密空间（M3-8）。`canMoveIn` / `canMoveOut` 由调用方按两层限制与
   * 隐私锁状态算好——树本身不做业务判断，只负责把原因显示在禁用项上。
   */
  vault?: {
    enabled: boolean;
    locked: boolean;
    isInVault: (folder: LocalFolder) => boolean;
    canMoveIn: (folder: LocalFolder) => boolean;
    /** 移入被拒的原因（用于禁用项的 `title`） */
    moveInReason?: string;
    onMoveIn: (folder: LocalFolder) => void;
    onMoveOut: (folder: LocalFolder) => void;
  };
  /**
   * 删除文件夹（M4-12）：**只报事件**，二次确认（含实时计数）由调用方做。
   * 不给这个回调时菜单里不出现「删除」——未接线的视图不显示假按钮。
   */
  onDelete?: (folder: LocalFolder) => void;
  /**
   * **树里列出条目**（B2 批；用户 2026-09-28 拍板做成设置项、默认关）。
   *
   * 三个 props 必须**一起给**才会列条目：开关、按文件夹分好组的条目、点开条目的动作。
   * **加密空间那棵树永远不给**——锁定时列标题就等于泄露内容，而且那是"空间内有什么"的信息，
   * 只在空间视图里看（隐私锁设计 §6.2）。
   */
  showItems?: boolean;
  itemsByFolder?: Readonly<Record<string, LocalItem[]>>;
  onOpenItem?: (itemId: string) => void;
}

/** 每个文件夹下最多列这么多条，超出给「还有 N 条…」（避免 2000 篇把树撑爆） */
export const TREE_ITEMS_LIMIT = 50;

export function FolderTree({
  folders,
  selectedId,
  onSelect,
  counts,
  onRename,
  onMove,
  onCreateChild,
  vault,
  onDelete,
  showItems = false,
  itemsByFolder,
  onOpenItem,
}: FolderTreeProps) {
  /**
   * 折叠起来的文件夹 id（2026-09-28 加入：用户要求"界面上要能看出层级结构"）。
   *
   * 默认**全展开**（不改变既有观感，只是多了一个可收起的入口）；状态留在本组件内——
   * 它纯粹是"这一屏怎么摆"，不属于数据，也不该进本地库或设置。
   */
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const toggle = (folderId: string): void => {
    setCollapsed((current) =>
      current.includes(folderId)
        ? current.filter((id) => id !== folderId)
        : [...current, folderId],
    );
  };

  const roots = folders.filter((folder) => folder.parent_id === null);
  const childrenOf = (parentId: string): LocalFolder[] =>
    folders
      .filter((folder) => folder.parent_id === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

  const nodeProps = (folder: LocalFolder) => ({
    folder,
    active: selectedId === folder.id,
    count: counts[folder.id] ?? 0,
    onSelect,
    onRename,
    onMove,
    onCreateChild,
    vault,
    onDelete,
    showItems,
    items: itemsByFolder?.[folder.id] ?? [],
    onOpenItem,
  });

  return (
    <ul className="tree">
      {roots.map((folder) => {
        const children = childrenOf(folder.id);
        const isCollapsed = collapsed.includes(folder.id);
        return (
          <li key={folder.id}>
            {/* 有子夹的父节点才出现折叠三角（没子夹就不给一个点了没反应的入口） */}
            <FolderNode
              {...nodeProps(folder)}
              collapsible={children.length > 0}
              collapsed={isCollapsed}
              onToggleCollapse={() => toggle(folder.id)}
            />
            {children.length > 0 && !isCollapsed ? (
              <div className="tree__children">
                {children.map((child) => (
                  <FolderNode key={child.id} {...nodeProps(child)} />
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

interface FolderNodeProps {
  folder: LocalFolder;
  active: boolean;
  count: number;
  onSelect: (folderId: string) => void;
  onRename: (folder: LocalFolder) => void;
  onMove: (folder: LocalFolder) => void;
  onCreateChild: (folder: LocalFolder) => void;
  vault?: FolderTreeProps["vault"];
  onDelete?: (folder: LocalFolder) => void;
  /** 有子文件夹时才给：折叠 / 展开这一支 */
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** 树里列条目（B2 批）：开关 + 这一夹直接包含的条目 + 点开动作 */
  showItems?: boolean;
  items?: LocalItem[];
  onOpenItem?: (itemId: string) => void;
}

function FolderNode({
  folder,
  active,
  count,
  onSelect,
  onRename,
  onMove,
  onCreateChild,
  vault,
  onDelete,
  collapsible = false,
  collapsed = false,
  onToggleCollapse,
  showItems = false,
  items = [],
  onOpenItem,
}: FolderNodeProps) {
  // 第 2 层不出现"新建子文件夹"入口（那个位置永远没有合法动作）
  const canCreateChild = canCreateChildFolder(folder);
  const inVault = vault?.isInVault(folder) ?? false;

  return (
    <div className="tree-row__wrap" data-has-children={collapsible ? "true" : undefined}>
      {/*
        折叠按钮是**行按钮的兄弟**（不是嵌套在里面——嵌套 button 是非法结构）。
        它靠 `.tree-row` 左侧留出的内边距取得位置，点它不会选中这一支。
      */}
      {collapsible ? (
        <button
          type="button"
          className="tree-row__toggle"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "展开" : "收起"}「${folder.name}」里的子文件夹`}
          title={collapsed ? "展开" : "收起"}
          onClick={onToggleCollapse}
        >
          <Icon name="chevron-down" size={13} />
        </button>
      ) : null}
      <button
        type="button"
        className="tree-row"
        aria-current={active}
        onClick={() => onSelect(folder.id)}
      >
        <span className="tree-row__folder">
          <Icon name="folder" size={13} />
        </span>
        <span className="nav-item__label">{folder.name}</span>        {/* 空间内的文件夹带小锁角标（设计 §9.2-②：解锁后空间内文件夹仍然一眼可辨） */}
        {inVault ? (
          <span className="itemrow__mark" title="这个文件夹在加密空间里">
            <Icon name="lock" size={13} />
          </span>
        ) : null}
        {folder.pending ? <span className="nav-item__count">待上传</span> : null}
        <span className="nav-item__count">{count}</span>
      </button>

      {/*
        树里列条目（B2 批；默认关，由设置 › 通用 打开）。
        每夹最多 `TREE_ITEMS_LIMIT` 条，超出给一行「还有 N 条…」→ **切到那个文件夹**
        （把中间列当全量视图看，树只做"认路"）。
      */}
      {showItems && onOpenItem && items.length > 0 ? (
        <ul className="tree-items">
          {items.slice(0, TREE_ITEMS_LIMIT).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="tree-item"
                onClick={() => onOpenItem(item.id)}
                title={item.title ?? "未命名"}
              >
                <Icon name={item.type === "table" ? "table" : "note"} size={13} />
                <span className="nav-item__label">{item.title ?? "未命名"}</span>
              </button>
            </li>
          ))}
          {items.length > TREE_ITEMS_LIMIT ? (
            <li>
              <button type="button" className="tree-item tree-item--more" onClick={() => onSelect(folder.id)}>
                还有 {items.length - TREE_ITEMS_LIMIT} 条…
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}

      <div className="tree-row__menu">
        <DropdownMenu
          label={`${folder.name} 的更多操作`}
          showChevron={false}
          trigger={<Icon name="chevron-down" size={13} />}
          items={[
            { id: "rename", label: "重命名", icon: "note", onSelect: () => onRename(folder) },
            { id: "move", label: "移动到…", icon: "folder", onSelect: () => onMove(folder) },
            ...(canCreateChild
              ? [
                  {
                    id: "child",
                    label: "新建子文件夹",
                    icon: "plus" as const,
                    onSelect: () => onCreateChild(folder),
                  },
                ]
              : []),
            ...(vault && folder.is_enc_space === 0
              ? inVault
                ? ([
                    {
                      id: "vault-out",
                      label: "移出加密空间",
                      icon: "lock" as const,
                      // 移出意味着内容面要变得可见：必须先解锁（走查表第 16 行）
                      disabled: vault.locked,
                      title: vault.locked ? "先解锁隐私锁，才能把文件夹移出加密空间" : "移到根目录",
                      onSelect: () => vault.onMoveOut(folder),
                    },
                  ] satisfies MenuItemSpec[])
                : ([
                    {
                      id: "vault-in",
                      label: "移入加密空间",
                      icon: "lock" as const,
                      disabled: !vault.enabled || !vault.canMoveIn(folder),
                      title: !vault.enabled
                        ? "先在「设置 › 隐私锁」启用隐私锁"
                        : vault.canMoveIn(folder)
                          ? "把这个文件夹与里面的条目一起移入加密空间"
                          : vault.moveInReason,
                      onSelect: () => vault.onMoveIn(folder),
                    },
                  ] satisfies MenuItemSpec[])
              : []),
            // 删除（M4-12）：空间行不可删（服务端也会拒绝，这里不给出入口）
            ...(onDelete && folder.is_enc_space === 0
              ? ([
                  {
                    id: "delete",
                    label: "删除",
                    icon: "logout" as const,
                    danger: true,
                    onSelect: () => onDelete(folder),
                  },
                ] satisfies MenuItemSpec[])
              : []),
          ]}
        />
      </div>
    </div>
  );
}

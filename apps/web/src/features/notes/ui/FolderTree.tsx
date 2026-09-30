/**
 * 笔记本树（components.md §六 `FolderTree` / `FolderNode`；需求 §4.5 两层限制）。
 *
 * 两条硬约束：
 * 1. **最多两层**——第 2 层文件夹**不提供"新建子文件夹"入口**（不是禁用，而是该位置永远没有
 *    合法动作，所以根本不出现）；
 * 2. 节点上带条目计数，一眼看出每个文件夹里有多少条。
 *
 * 2026-09-28（用户要求"界面上要能看出层级结构"）：父节点加**折叠三角**、子层加**引导线**。
 * 折叠状态只在本组件内（纯展示状态，不进数据）。
 *
 * 2026-10-01（用户反馈问题 5："文件夹和文档看起来不够区分明显，结构也不明显"）三处结构性修正
 * （设计稿 `docs/modules/Menote-笔记本树两档模式与层级-设计-v1.md` §三）：
 * 1. **文档行搬进 `.tree__children` 那一块**——与子文件夹**共用同一条引导线**、缩进也与文件夹名对齐。
 *    此前文档挂在 `.tree-items` 自己的缩进里、没有引导线，看着像另一套层级（"谁属于谁读不出来"）；
 *    顺带定下**顺序：先子文件夹、后文档**（结构在前、内容在后）。
 * 2. **折叠 = 收起该夹的全部内容（子夹 + 文档）**。此前三角只控制子文件夹，一个夹里 50 条文档
 *    照样铺在树上；现在**有文档也算"可折叠"**（否则没有子夹、只有文档的夹根本收不起来）。
 * 3. **当前打开的文档给选中反馈**（`selectedItemId` → `aria-current`）：此前树里只有"选中的文件夹"
 *    有底色，点开的文档在树上毫无痕迹。
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
  /**
   * 这棵树的"根"是谁的 `parent_id`：默认 `null`（普通笔记本树——第 1 层的父就是根目录）。
   *
   * **加密空间树要传空间根 id**（2026-09-29 修）：空间内第 1 层文件夹的父是**空间根那一行**，
   * 不是 `null`；此前这里只认 `null`，于是空间树一个文件夹行都渲染不出来（只剩"新建"链接）。
   */
  rootId?: string | null;
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
  /** 正文区当前打开的那一篇（树里给这一行选中底色；不传就没有选中反馈） */
  selectedItemId?: string | null;
}

/** 每个文件夹下最多列这么多条，超出给「还有 N 条…」（避免 2000 篇把树撑爆） */
export const TREE_ITEMS_LIMIT = 50;

export function FolderTree({
  folders,
  rootId = null,
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
  selectedItemId = null,
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

  const roots = folders.filter((folder) => (folder.parent_id ?? null) === rootId);
  const childrenOf = (parentId: string): LocalFolder[] =>
    folders
      .filter((folder) => folder.parent_id === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  /** 这一夹要列的条目：开关与打开动作都给齐了才算（加密空间那棵树两个都不给） */
  const itemsOf = (folderId: string): LocalItem[] =>
    showItems && onOpenItem ? (itemsByFolder?.[folderId] ?? []) : [];

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
  });

  /**
   * 渲染一个文件夹行 + 它的内容块。两层限制：第 2 层没有子夹，但**两层都可以有文档**。
   *
   * 内容块的顺序是**先子文件夹、后文档**（结构在前、内容在后），两者共用同一个 `.tree__children`
   * （同一条引导线）；收起时两块一起收（2026-10-01）。
   */
  const renderFolder = (folder: LocalFolder, level: 1 | 2): React.ReactElement => {
    const children = level === 1 ? childrenOf(folder.id) : [];
    const items = itemsOf(folder.id);
    const isCollapsed = collapsed.includes(folder.id);
    const hasContent = children.length > 0 || items.length > 0;
    return (
      <li key={folder.id}>
        <FolderNode
          {...nodeProps(folder)}
          collapsible={hasContent}
          collapsed={isCollapsed}
          onToggleCollapse={() => toggle(folder.id)}
        />
        {hasContent && !isCollapsed ? (
          <div className="tree__children">
            {children.length > 0 ? (
              <ul className="tree">{children.map((child) => renderFolder(child, 2))}</ul>
            ) : null}
            {items.length > 0 && onOpenItem ? (
              <TreeItemList
                folderId={folder.id}
                items={items}
                selectedItemId={selectedItemId}
                onOpenItem={onOpenItem}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        ) : null}
      </li>
    );
  };

  return <ul className="tree">{roots.map((folder) => renderFolder(folder, 1))}</ul>;
}

/**
 * 一个文件夹下的文档行（每夹上限 `TREE_ITEMS_LIMIT` 条，超出给一行「还有 N 条…」→
 * **切到那个文件夹**，把中间列当全量视图看，树只做"认路"）。
 *
 * 不再套自己的缩进容器：它挂在 `.tree__children` 里，与子文件夹共用同一条引导线（2026-10-01）。
 */
function TreeItemList({
  folderId,
  items,
  selectedItemId,
  onOpenItem,
  onSelect,
}: {
  folderId: string;
  items: readonly LocalItem[];
  selectedItemId: string | null;
  onOpenItem: (itemId: string) => void;
  onSelect: (folderId: string) => void;
}) {
  const rest = items.length - TREE_ITEMS_LIMIT;
  return (
    <ul className="tree-items">
      {items.slice(0, TREE_ITEMS_LIMIT).map((item) => {
        const title = item.title ?? "未命名";
        return (
          <li key={item.id}>
            <button
              type="button"
              className="tree-item"
              // 正文区正打开的哪一篇：给这一行选中底色（`aria-current` 也把状态告诉了读屏）
              aria-current={selectedItemId === item.id}
              aria-label={title}
              onClick={() => onOpenItem(item.id)}
              title={title}
            >
              <Icon name={item.type === "table" ? "table" : "note"} size={13} />
              <span className="nav-item__label">{title}</span>
            </button>
          </li>
        );
      })}
      {rest > 0 ? (
        <li>
          <button
            type="button"
            className="tree-item tree-item--more"
            aria-label={`还有 ${rest} 条，切到这个文件夹`}
            onClick={() => onSelect(folderId)}
          >
            还有 {rest} 条…
          </button>
        </li>
      ) : null}
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
  /** 有子夹或（树里列条目时）有文档才给：折叠 / 展开这一支的全部内容 */
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
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
          aria-label={`${collapsed ? "展开" : "收起"}「${folder.name}」里的内容`}
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

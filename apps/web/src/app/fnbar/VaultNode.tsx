/**
 * 加密空间节点（components.md §六 `VaultNode`；《隐私锁设计》§9.1、界面稿 §一）。
 *
 * 两条硬约束（DESIGN.md §2.2 结构不变量）：
 * 1. **贴底固定**——它在 `.fnbar__scroll` **之外**，不随导航滚动；
 * 2. **没有分组小标题**（不像笔记本/标签那样有 `.group-title`）。
 *
 * 三态（设计 §9.1）：
 * - **未启用**：置灰不可点，`title` 说明去哪里启用（不做"点了没反应"）；
 * - **已锁定**：显示「已锁定」，点击**开解锁框**（不展开内容，设计 §9.2）；
 * - **已解锁**：显示空间内条目数，点击把笔记区切到空间；节点下方展开**空间内文件夹树**。
 */
import { Icon } from "../ui/Icon";
import { VaultTree, type VaultTreeProps } from "./VaultTree";

export interface VaultNodeProps {
  /** 隐私锁是否已启用 */
  enabled: boolean;
  /** 当前是否锁定（未启用时忽略） */
  locked: boolean;
  /** 空间内条目数（仅在已解锁时显示） */
  count: number;
  /** 已解锁：把笔记区切到加密空间 */
  onOpen: () => void;
  /** 已锁定：打开解锁框 */
  onUnlock: () => void;
  /** 解锁后节点下方展开的空间内文件夹树 */
  tree: VaultTreeProps;
}

export function VaultNode({ enabled, locked, count, onOpen, onUnlock, tree }: VaultNodeProps) {
  return (
    <div className="fnbar__vault">
      {!enabled ? (
        <button
          type="button"
          className="nav-item vault-node"
          data-locked="true"
          disabled
          title="还没有启用隐私锁：到「设置 › 隐私锁」启用后即可使用加密空间"
        >
          <Icon name="lock" size={16} />
          <span className="nav-item__label">加密空间</span>
          <span className="vault-node__tagline">未启用</span>
        </button>
      ) : locked ? (
        <button
          type="button"
          className="nav-item vault-node"
          data-locked="true"
          title="加密空间已锁定；点这里输入隐私密码解锁"
          onClick={onUnlock}
        >
          <Icon name="lock" size={16} />
          <span className="nav-item__label">加密空间</span>
          <span className="vault-node__tagline">已锁定</span>
        </button>
      ) : (
        <>
          <button type="button" className="nav-item vault-node" title="打开加密空间" onClick={onOpen}>
            <Icon name="lock" size={16} />
            <span className="nav-item__label">加密空间</span>
            <span className="nav-item__count">{count}</span>
          </button>
          <VaultTree {...tree} />
        </>
      )}
    </div>
  );
}

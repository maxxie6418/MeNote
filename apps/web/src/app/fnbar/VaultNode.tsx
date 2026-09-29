/**
 * 加密空间节点（components.md §六 `VaultNode`；《隐私锁设计》§9.1、§9.2-②）。
 *
 * 两条硬约束（DESIGN.md §2.2 结构不变量）：
 * 1. **贴底固定**——它在 `.fnbar__scroll` **之外**，不随导航滚动；
 * 2. **没有分组小标题**（不像笔记本/标签那样有 `.group-title`）。
 *
 * 三态（设计 §9.2-② 的表格逐条落在这里）：
 * - **未启用**：锁图标 + "未启用 · 去启用"，**可点并引导启用**（不是 disabled 占位）；
 * - **已锁定**：实心灰锁 + "已锁定" + **条目数照常显示**（计数属统计口径），点击开解锁框；
 * - **已解锁**：显示条目数，点击把笔记区切到空间。
 *
 * 【2026-09-29 变更·用户要求】解锁后**不再在功能栏展开空间内文件夹树**——那个位置只作入口；
 * 树搬进了加密空间视图的列表列（见 `features/privacy/ui/VaultTree.tsx`）。
 */
import { Icon } from "../ui/Icon";

export interface VaultNodeProps {
  /** 隐私锁是否已启用 */
  enabled: boolean;
  /** 当前是否锁定（未启用时忽略） */
  locked: boolean;
  /** 空间内条目数（**未启用时不显示；锁定时照常显示**） */
  count: number;
  /** 已解锁：把笔记区切到加密空间 */
  onOpen: () => void;
  /** 已锁定：打开解锁框 */
  onUnlock: () => void;
  /** 未启用：引导启用（去设置 › 隐私锁） */
  onEnable: () => void;
}

export function VaultNode({ enabled, locked, count, onOpen, onUnlock, onEnable }: VaultNodeProps) {
  return (
    <div className="fnbar__vault">
      {!enabled ? (
        <button
          type="button"
          className="nav-item vault-node"
          title="还没有启用隐私锁：点这里去「设置 › 隐私锁」启用"
          onClick={onEnable}
        >
          <Icon name="lock" size={16} />
          <span className="nav-item__label">加密空间</span>
          <span className="vault-node__tagline">未启用 · 去启用</span>
        </button>
      ) : locked ? (
        <button
          type="button"
          className="nav-item vault-node"
          data-locked="true"
          title="加密空间已锁定；点这里输入隐私密码解锁（条目数照常显示）"
          onClick={onUnlock}
        >
          <Icon name="lock" size={16} />
          <span className="nav-item__label">加密空间</span>
          <span className="vault-node__tagline">已锁定</span>
          {/* 锁定时**照常显示条目数**：算的是"我总共有多少"，不是"我现在能看多少" */}
          <span className="nav-item__count">{count}</span>
        </button>
      ) : (
        <button
          type="button"
          className="nav-item vault-node"
          title="打开加密空间"
          onClick={onOpen}
        >
          <Icon name="lock" size={16} />
          <span className="nav-item__label">加密空间</span>
          <span className="nav-item__count">{count}</span>
        </button>
      )}
    </div>
  );
}

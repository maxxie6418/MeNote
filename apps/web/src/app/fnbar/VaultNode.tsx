/**
 * 加密空间节点（components.md §六 `VaultNode`；原型 `.fn-vault > .vault-node`）。
 *
 * 两条硬约束（DESIGN.md §2.2 结构不变量）：
 * 1. **贴底固定**——它在 `.fnbar__scroll` **之外**，不随导航滚动；
 * 2. **没有分组小标题**（不像笔记本/标签那样有 `.group-title`）。
 *
 * M2 的边界（用户 2026-09-26 确认）：隐私锁**只做外观与占位**，锁的实际行为（解锁、门禁、
 * 计时）"先实现基本功能、后续再拓展"，基本行为落 M3。因此这里渲染为**已锁定且不可点**，
 * 并用 `title` 说明原因——不做"点了没反应"的假入口。
 */
export function VaultNode() {
  return (
    <div className="fnbar__vault">
      <button
        type="button"
        className="nav-item vault-node"
        data-locked="true"
        disabled
        title="加密空间将在 M3 启用（M2 只做外观与占位）"
      >
        <svg className="ic" width={16} height={16} aria-hidden="true" focusable="false">
          <use href="#i-lock" />
        </svg>
        <span className="nav-item__label">加密空间</span>
        <span className="vault-node__tagline">未启用</span>
      </button>
    </div>
  );
}

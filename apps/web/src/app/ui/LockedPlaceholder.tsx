/**
 * 锁定占位（components.md 第十四章的收敛项；《隐私锁设计》§9.2）。
 *
 * Memo 与待办在**锁定时整体占位**——不显示内容、标签与图片。原型里这两处占位形态完全相同，
 * M3 收敛成一个组件（落点 `app/ui/`，与 `EmptyState` 同处，供各 feature 复用）。
 *
 * 两条设计约束：
 * 1. 占位**必须给出「解锁」出口**（DESIGN.md §5.4-3：为什么空 + 下一步做什么），
 *    否则就是"点了没反应"的假入口；
 * 2. 锁定态说明属于**必须可见**的文案（DESIGN.md §5.4-2），不收进 `InfoHint`。
 */
import { Button, EmptyState } from "./Controls";
import { Icon } from "./Icon";

export interface LockedPlaceholderProps {
  /** 主文案（如「Memo 已锁定」/「待办已锁定」） */
  title: string;
  /** 一句说明（锁定态说明必须可见） */
  hint?: string;
  onUnlock: () => void;
}

export function LockedPlaceholder({ title, hint, onUnlock }: LockedPlaceholderProps) {
  return (
    <EmptyState
      title={title}
      hint={hint}
      action={
        <Button variant="primary" size="sm" onClick={onUnlock} title="输入隐私密码解锁">
          <Icon name="lock" size={13} />
          解锁
        </Button>
      }
    />
  );
}

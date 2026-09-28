/**
 * 破坏性操作的二次确认（`DESIGN.md` §6.3/§6.5：登出、关闭隐私锁、重置隐私密码、删除类操作
 * **必须二次确认**，且确认框要写明**影响范围与数量**、以及**能不能恢复**）。
 *
 * 为什么抽这一层：三处用法的形状完全一样（危险标题 + 后果说明 + 取消 / 危险确认），
 * 抽出来是为了让"必须写清后果"这件事**只有一个地方会写漏**（`Modal` 自己不知道什么是破坏性操作）。
 * 它只是薄封装，不引入新的视觉语言：内部仍是 `Modal` + `Button variant="danger"`。
 */
import type { ReactNode } from "react";
import { Button } from "./Controls";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** 影响范围与后果：做什么、影响哪些对象与数量、能否恢复 */
  desc: string;
  /** 确认按钮文字：用**动词**（如「退出登录」「关闭隐私锁」），不用"确定" */
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  /** 需要补充的可见后果（可选），例如"旧备份将解不开" */
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  desc,
  confirmLabel,
  onConfirm,
  onClose,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      desc={desc}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children ?? <p>这一步不可撤销。</p>}
    </Modal>
  );
}

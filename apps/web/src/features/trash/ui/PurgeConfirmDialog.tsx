/**
 * 永久删除 / 清空的确认框（M4-12；《M4 界面稿》§6.3）。
 *
 * 文案全部来自 `trash/model.ts`：**范围要写全**（条目 + 全部版本 + 不再被引用的附件）、
 * **不承诺快照文件**、**写明不可撤销**。破坏性按钮用危险态，且必须**二次确认**。
 */
import { Button } from "../../../app/ui/Controls";
import { Modal } from "../../../app/ui/Modal";
import { emptyConfirmText, purgeConfirmText } from "../model";

export interface PurgeConfirmDialogProps {
  open: boolean;
  /** 待永久删除的条数（清空时是回收站总数） */
  count: number;
  /** `empty` = 清空回收站；`purge` = 删除选中的这些 */
  kind: "purge" | "empty";
  onCancel: () => void;
  onConfirm: () => void;
}

export function PurgeConfirmDialog({ open, count, kind, onCancel, onConfirm }: PurgeConfirmDialogProps) {
  const text = kind === "empty" ? emptyConfirmText(count) : purgeConfirmText(count);

  return (
    <Modal
      open={open}
      title={text.title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            {kind === "empty" ? "清空回收站" : "永久删除"}
          </Button>
        </>
      }
    >
      <p>{text.body}</p>
    </Modal>
  );
}

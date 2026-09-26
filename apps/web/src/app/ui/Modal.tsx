/**
 * 模态与遮罩（components.md §八 `Modal` / `Overlay`）。
 *
 * 行为（DESIGN.md §6.4 浮层：锚定/居中、点击外部关闭、`Esc` 关闭）：
 * - 点遮罩关闭、`Esc` 关闭；
 * - 打开时把焦点移入对话框，关闭后由调用方决定焦点去向（不抢焦点，避免与触发元素打架）；
 * - `role="dialog"` + `aria-modal`，标题作为无障碍名。
 *
 * 尺寸取自原型并按 DESIGN.md §4.3 的刻度收敛（原型 16px 圆角 → 令牌 `--radius-lg`）。
 */
import { useEffect, useRef, type ReactNode } from "react";

export interface ModalProps {
  open: boolean;
  title: string;
  desc?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

export function Modal({ open, title, desc, onClose, footer, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    // 焦点移入对话框，键盘用户不会"停在遮罩外面"
    panelRef.current?.querySelector<HTMLElement>("input, button, [tabindex]")?.focus();

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <div className="modal__head">
          <h2 className="modal__title">{title}</h2>
        </div>
        {desc ? <p className="modal__desc">{desc}</p> : null}
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </div>
  );
}

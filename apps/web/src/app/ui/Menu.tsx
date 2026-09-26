/**
 * 锚定菜单（DESIGN.md §6.4：锚定触发元素、点击外部关闭、`Esc` 关闭、同一时刻只允许一个菜单）。
 *
 * 键盘：`Enter` / `Space` / `↓` 打开并把焦点移入首项，`↑` `↓` 移动，`Esc` 关闭并**把焦点还给触发器**。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export interface MenuItemSpec {
  id: string;
  label: string;
  icon?: IconName;
  onSelect: () => void;
}

export interface DropdownMenuProps {
  /** 触发按钮的无障碍名称 */
  label: string;
  trigger: ReactNode;
  header?: ReactNode;
  items: MenuItemSpec[];
  align?: "left" | "right";
}

export function DropdownMenu({ label, trigger, header, items, align = "right" }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    itemRefs.current[0]?.focus();

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function moveFocus(delta: number): void {
    const focusable = itemRefs.current.filter((node): node is HTMLButtonElement => node !== null);
    if (focusable.length === 0) return;
    const current = focusable.findIndex((node) => node === document.activeElement);
    const next = (current + delta + focusable.length) % focusable.length;
    focusable[next]?.focus();
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        style={{ display: "flex", alignItems: "center", gap: 2, padding: 0 }}
      >
        {trigger}
        <Icon name="chevron-down" size={13} />
      </button>

      {open ? (
        <div
          className="menu"
          role="menu"
          aria-label={label}
          style={{ top: "calc(100% + 6px)", [align]: 0 }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveFocus(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveFocus(-1);
            }
          }}
        >
          {header ? <div className="menu__head">{header}</div> : null}
          {header ? <div className="menu__sep" /> : null}
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              className="menu__item"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon ? <Icon name={item.icon} size={16} /> : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

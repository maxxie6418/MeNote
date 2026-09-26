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
  /** 禁用时**必须**给 `title` 说明原因（DESIGN.md §6.1） */
  disabled?: boolean;
  title?: string;
  /**
   * 选中后**不关闭菜单**（需求 M18-03：菜单里的主题切换切完不收起，便于连续比色）。
   * 其余项点完即收起。
   */
  keepOpen?: boolean;
}

export interface DropdownMenuProps {
  /** 触发按钮的无障碍名称 */
  label: string;
  trigger: ReactNode;
  header?: ReactNode;
  /**
   * 自定义内容块（渲染在头部之后、条目之前）。
   * 用于放"一排三档"这类**不是单个菜单项**的控件（例如账户菜单里的主题切换）——
   * 菜单项是 `role="menuitem"` 的按钮，里面不能再嵌按钮。
   */
  blocks?: ReactNode;
  items: MenuItemSpec[];
  align?: "left" | "right";
  /** 触发元素本身已是图标按钮时（如笔记本的 `+`）不需要再挂箭头 */
  showChevron?: boolean;
}

export function DropdownMenu({
  label,
  trigger,
  header,
  blocks,
  items,
  align = "right",
  showChevron = true,
}: DropdownMenuProps) {
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
        {showChevron ? <Icon name="chevron-down" size={13} /> : null}
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
          {blocks ? <div className="menu__block">{blocks}</div> : null}
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              className="menu__item"
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                if (!item.keepOpen) setOpen(false);
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

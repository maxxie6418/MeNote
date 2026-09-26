/**
 * 胶囊（components.md §八 `Chip`）。
 *
 * 三种形态，对应原型里的三处用法：
 * - `default`：`.chip`——实底信息胶囊（标签云里的标签、只读标记）
 * - `compact`：`.sw`——20px 小巧胶囊，录入框的模式附加项（截止 / 优先级 / 首行作标题 / 根目录）
 * - `tag`：`.chip.tag`——描边标签胶囊，可点筛选
 *
 * 颜色一律走令牌的语义色档位（`tone`），**不在组件里写业务语义**（components.md 铁律 2）：
 * 用 `tone="amber"` 而不是 `kind="pending"`。
 */
import { Icon, type IconName } from "./Icon";

export type ChipTone = "neutral" | "amber" | "green" | "red" | "primary";

export interface ChipProps {
  children: React.ReactNode;
  tone?: ChipTone;
  variant?: "default" | "compact" | "tag";
  icon?: IconName;
  /** 可点时给回调；不给则渲染为不可交互的标记 */
  onClick?: () => void;
  active?: boolean;
  title?: string;
  disabled?: boolean;
}

export function Chip({
  children,
  tone = "neutral",
  variant = "default",
  icon,
  onClick,
  active = false,
  title,
  disabled = false,
}: ChipProps) {
  const classes = [
    variant === "compact" ? "sw" : "chip",
    variant === "tag" ? "chip--tag" : "",
    variant === "compact" ? `sw--${tone}` : `chip--${tone}`,
    active ? "chip--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </>
  );

  if (!onClick) {
    return (
      <span className={classes} title={title} data-disabled={disabled || undefined}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      title={title}
      aria-pressed={variant === "tag" ? active : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

/**
 * 盒式分段控件（components.md §八 `SegmentedControl`；DESIGN.md §2.5-4）。
 *
 * 与 `UnderlineTabs`（下划线页签）**刻意不同**：这里是"外框 + 灰实底选中"的盒子造型，
 * 用于**同一容器内的模式切换**（录入框 Memo/待办/笔记、正文区 分屏/仅编辑/仅预览）。
 * 两条导航造型不得混用——浏览三段用下划线页签，模式切换用盒式。
 *
 * 复用关系（components.md）：`ComposerModeTabs`、`DocModeSwitch` 等都是它的用法，不是独立控件。
 */
import { Icon, type IconName } from "./Icon";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  /** 禁用时**必须**给 `title` 说明原因（DESIGN.md §6.1） */
  disabled?: boolean;
  title?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** `compact` 对应原型里的 `.mode-tabs`：更矮更紧凑，用于录入框模式行 */
  size?: "default" | "compact";
  ariaLabel: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "default",
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={[
        "segmented",
        size === "compact" ? "segmented--compact" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented__item"
          aria-pressed={option.value === value}
          disabled={option.disabled}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.icon ? <Icon name={option.icon} size={13} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}

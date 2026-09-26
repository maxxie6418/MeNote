/**
 * 通用控件：按钮、字段、空状态、胶囊、头像（DESIGN.md §5 的用法与层级）。
 * 这里只做展示与交互，不含业务逻辑。
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "default" | "sm";
}

/** 操作层级：同一屏最多一个主操作（DESIGN.md §5.1） */
export function Button({
  variant = "secondary",
  size = "default",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = ["btn", `btn--${variant}`, size === "sm" ? "btn--sm" : "", className]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={classes} {...rest} />;
}

export function IconButton({
  label,
  icon,
  size = 16,
  className,
  type = "button",
  ...rest
}: { label: string; icon: IconName; size?: 13 | 16 | 20 } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={["iconbtn", className].filter(Boolean).join(" ")}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function Field({ label, error, id, ...rest }: FieldProps) {
  const inputId = id ?? `field-${label}`;
  const errorId = `${inputId}-error`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
      {error ? (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** 空状态必须给出口（DESIGN.md §5.4-3：为什么空 + 下一步做什么） */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {hint ? <p className="empty__hint">{hint}</p> : null}
      {action}
    </div>
  );
}

export function Pill({
  tone = "neutral",
  icon,
  children,
  title,
}: {
  tone?: "neutral" | "ok" | "busy" | "err";
  icon?: IconName;
  children: ReactNode;
  title?: string;
}) {
  const classes = ["pill", tone === "neutral" ? "" : `pill--${tone}`].filter(Boolean).join(" ");
  return (
    <span className={classes} title={title}>
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  );
}

export function Avatar({ username, size = 30 }: { username: string; size?: number }) {
  const initial = username.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span className="avatar" style={{ width: size, height: size }} aria-hidden="true">
      {initial}
    </span>
  );
}

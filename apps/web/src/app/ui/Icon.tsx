/**
 * 图标（DESIGN.md §5.5）：
 * - 一律走 **SVG symbol sprite**，不在组件里内联 path、不引外部图标库、不用字体图标；
 * - 三档尺寸：常规 16、小 13、大 20，与文字并排时对齐光学中线；
 * - 描边规格统一 `.ic`（1.6px、无填充、`currentColor`）；
 * - 图标**不可作为唯一表意手段**：调用处必须配文字或 `aria-label`。
 *
 * sprite 挂载一次（`<IconSprite />` 放在应用根部）。
 */

export type IconName =
  | "plus"
  | "search"
  | "chevron-down"
  | "chevron-right"
  | "settings"
  | "logout"
  | "info"
  | "cloud-ok"
  | "cloud-off"
  | "alert"
  | "note"
  | "home"
  | "clock"
  | "check-square"
  | "refresh"
  | "star"
  | "folder"
  | "tag"
  | "lock"
  | "table";

export function IconSprite() {
  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: "absolute" }}>
      <symbol id="i-plus" viewBox="0 0 16 16">
        <path d="M8 3.2v9.6M3.2 8h9.6" />
      </symbol>
      <symbol id="i-search" viewBox="0 0 16 16">
        <circle cx="7" cy="7" r="4.2" />
        <path d="M10.2 10.2 13.5 13.5" />
      </symbol>
      <symbol id="i-chevron-down" viewBox="0 0 16 16">
        <path d="M4 6.5 8 10.5l4-4" />
      </symbol>
      <symbol id="i-settings" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="2.2" />
        <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1" />
      </symbol>
      <symbol id="i-logout" viewBox="0 0 16 16">
        <path d="M9.5 3H4.2A1.2 1.2 0 0 0 3 4.2v7.6A1.2 1.2 0 0 0 4.2 13h5.3" />
        <path d="M10 5.5 12.5 8 10 10.5M12.5 8H6.5" />
      </symbol>
      <symbol id="i-info" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 7.2v4M8 4.8v.6" />
      </symbol>
      <symbol id="i-cloud-ok" viewBox="0 0 16 16">
        <path d="M4.6 11.5h6.9a2.4 2.4 0 0 0 .3-4.8A3.4 3.4 0 0 0 5 6.2a2.7 2.7 0 0 0-.4 5.3Z" />
        <path d="M6.4 8.9 7.6 10l2-2.2" />
      </symbol>
      <symbol id="i-cloud-off" viewBox="0 0 16 16">
        <path d="M4.6 11.5h6.9a2.4 2.4 0 0 0 .3-4.8A3.4 3.4 0 0 0 5 6.2a2.7 2.7 0 0 0-.4 5.3Z" />
        <path d="M3 3l10 10" />
      </symbol>
      <symbol id="i-alert" viewBox="0 0 16 16">
        <path d="M8 2.6 14 13H2L8 2.6Z" />
        <path d="M8 6.6v3.1M8 11.5v.4" />
      </symbol>
      <symbol id="i-note" viewBox="0 0 16 16">
        <path d="M3.6 2.5h6.2l2.6 2.6v8.4H3.6z" />
        <path d="M9.6 2.6v2.6h2.6M5.6 8.4h4.8M5.6 10.8h3.4" />
      </symbol>
      <symbol id="i-chevron-right" viewBox="0 0 16 16">
        <path d="M6 3.5 10.5 8 6 12.5" />
      </symbol>
      <symbol id="i-home" viewBox="0 0 16 16">
        <path d="M2.8 7.2 8 2.8l5.2 4.4v5.6a1 1 0 0 1-1 1H3.8a1 1 0 0 1-1-1z" />
        <path d="M6.4 13.6V9.4h3.2v4.2" />
      </symbol>
      <symbol id="i-clock" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="5.6" />
        <path d="M8 4.8V8l2.2 1.6" />
      </symbol>
      <symbol id="i-check-square" viewBox="0 0 16 16">
        <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2" />
        <path d="M5.6 8.2 7.4 10l3-3.6" />
      </symbol>
      <symbol id="i-refresh" viewBox="0 0 16 16">
        <path d="M13 8a5 5 0 1 1-1.6-3.7" />
        <path d="M13.2 2.6v3.2h-3.2" />
      </symbol>
      <symbol id="i-star" viewBox="0 0 16 16">
        <path d="M8 2.6l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.3l-3.4 1.8.7-3.8L2.5 6.6l3.8-.5z" />
      </symbol>
      <symbol id="i-folder" viewBox="0 0 16 16">
        <path d="M2.6 4.4a1 1 0 0 1 1-1h2.6l1.4 1.6h4.8a1 1 0 0 1 1 1v5.6a1 1 0 0 1-1 1H3.6a1 1 0 0 1-1-1z" />
      </symbol>
      <symbol id="i-tag" viewBox="0 0 16 16">
        <path d="M8.4 2.6H13v4.6l-5.6 5.6-4.6-4.6z" />
        <path d="M10.6 5.4v.4" />
      </symbol>
      <symbol id="i-lock" viewBox="0 0 16 16">
        <rect x="3.6" y="7" width="8.8" height="6.4" rx="1.4" />
        <path d="M5.8 7V5.4a2.2 2.2 0 0 1 4.4 0V7" />
      </symbol>
      <symbol id="i-table" viewBox="0 0 16 16">
        <rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.4" />
        <path d="M2.6 6.6h10.8M6.6 6.6v6M10.2 6.6v6" />
      </symbol>
    </svg>
  );
}

export interface IconProps {
  name: IconName;
  size?: 13 | 16 | 20;
  className?: string;
}

export function Icon({ name, size = 16, className = "ic" }: IconProps) {
  return (
    <svg className={className} width={size} height={size} aria-hidden="true" focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  );
}

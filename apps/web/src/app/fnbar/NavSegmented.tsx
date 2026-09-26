/**
 * 浏览三段（components.md §六 `NavSegmented`；原型 `.nav-seg`）。
 *
 * 造型是**下划线页签**，与录入框模式行的盒式分段控件刻意区分（DESIGN.md §2.5-4）：
 * 三段压成横向一行，保留原名，点不同位置进不同页面。
 *
 * M2 的边界：首页 / Memo / 待办分别在 M2-8 / M2-4 / M2-5 落地。三者现已全部可用；
 * 「未选首页作为启动视图时不显示首页项」由 `showHome` 控制（需求 §7.4）。
 */
import { Icon, type IconName } from "../ui/Icon";

export type BrowsableView = "home" | "memo" | "task";

interface TabSpec {
  view: BrowsableView;
  label: string;
  icon: IconName;
  /** 接入该视图的步骤，`null` = 已可用 */
  pendingStep: string | null;
}

const TABS: readonly TabSpec[] = [
  { view: "home", label: "首页", icon: "home", pendingStep: null },
  { view: "memo", label: "Memo", icon: "clock", pendingStep: null },
  { view: "task", label: "待办", icon: "check-square", pendingStep: null },
];

export interface NavSegmentedProps {
  active?: BrowsableView;
  onSelect?: (view: BrowsableView) => void;
  /**
   * 是否显示首页项。**未选首页作为启动视图时不显示**（需求 §7.4）：此时浏览三段只剩两项，
   * 由它们等分（CSS 的 `flex: 1` 自动完成）。
   */
  showHome?: boolean;
}

export function NavSegmented({ active, onSelect, showHome = true }: NavSegmentedProps) {
  const tabs = TABS.filter((tab) => tab.view !== "home" || showHome);

  return (
    <div className="nav-seg" role="tablist" aria-label="浏览">
      {tabs.map((tab) => {
        const pending = tab.pendingStep !== null;
        return (
          <button
            key={tab.view}
            type="button"
            role="tab"
            className="seg-item"
            aria-current={!pending && active === tab.view}
            aria-selected={!pending && active === tab.view}
            disabled={pending}
            title={pending ? `${tab.label}将在 ${tab.pendingStep} 提供` : tab.label}
            onClick={() => onSelect?.(tab.view)}
          >
            <Icon name={tab.icon} size={13} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

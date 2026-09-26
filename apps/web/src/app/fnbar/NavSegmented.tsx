/**
 * 浏览三段（components.md §六 `NavSegmented`；原型 `.nav-seg`）。
 *
 * 造型是**下划线页签**，与录入框模式行的盒式分段控件刻意区分（DESIGN.md §2.5-4）：
 * 三段压成横向一行，保留原名，点不同位置进不同页面。
 *
 * M2 的边界：首页 / Memo / 待办分别在 M2-8 / M2-4 / M2-5 落地。在那之前对应项
 * **禁用并说明原因**（`title`），不做空入口、也不隐藏——否则"N 条导航造型保持区分"
 * 这条验收点无从对照。
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
  { view: "home", label: "首页", icon: "home", pendingStep: "M2-8" },
  { view: "memo", label: "Memo", icon: "clock", pendingStep: "M2-4" },
  { view: "task", label: "待办", icon: "check-square", pendingStep: "M2-5" },
];

export interface NavSegmentedProps {
  active?: BrowsableView;
  onSelect?: (view: BrowsableView) => void;
}

export function NavSegmented({ active, onSelect }: NavSegmentedProps) {
  return (
    <div className="nav-seg" role="tablist" aria-label="浏览">
      {TABS.map((tab) => {
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

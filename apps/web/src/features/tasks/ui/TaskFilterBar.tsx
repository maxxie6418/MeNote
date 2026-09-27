/**
 * 待办筛选栏（components.md §七 `TaskFilterBar`；需求 §9.4）。
 *
 * 三个维度都是**纯本地**筛选（状态 / 优先级 / 截止范围），不发请求；
 * **各状态的条数挂在这里**（实时计数必须保持可见，`DESIGN.md` §5.4）——
 * 概览（`.tksum`）按原型只放"总数 + 完成率"，分状态计数不重复。
 */
import { SegmentedControl } from "../../../app/ui/SegmentedControl";
import type { TaskStatus } from "@menote/mdcore";
import {
  DUE_RANGES,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  type TaskFilter,
} from "../model";

export interface TaskFilterBarProps {
  filter: TaskFilter;
  onChange: (filter: TaskFilter) => void;
  /** 各状态的条数（含"全部"的合计由调用方给 `all`）；缺省时不显示计数 */
  counts?: Record<TaskStatus, number> & { all?: number };
}

export function TaskFilterBar({ filter, onChange, counts }: TaskFilterBarProps) {
  return (
    <div className="taskfilter">
      <SegmentedControl
        ariaLabel="按状态筛选"
        size="compact"
        value={filter.status}
        onChange={(status) => onChange({ ...filter, status })}
        options={STATUS_OPTIONS.map((item) => ({
          value: item.value,
          // 计数**并进标签**：一是保持"实时计数可见"，二是原型就是这么放的（不与概览重复）
          label:
            counts && item.value !== "all" ? `${item.label} ${counts[item.value] ?? 0}` : item.label,
        }))}
      />
      <SegmentedControl
        ariaLabel="按优先级筛选"
        size="compact"
        value={filter.priority}
        onChange={(priority) => onChange({ ...filter, priority })}
        options={PRIORITY_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
      />
      <SegmentedControl
        ariaLabel="按截止范围筛选"
        size="compact"
        value={filter.due}
        onChange={(due) => onChange({ ...filter, due })}
        options={DUE_RANGES.map((item) => ({ value: item.value, label: item.label }))}
      />
    </div>
  );
}

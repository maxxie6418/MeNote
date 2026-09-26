/**
 * 待办筛选栏（components.md §七 `TaskFilterBar`；需求 §9.4）。
 *
 * 三个维度都是**纯本地**筛选（状态 / 优先级 / 截止范围），不发请求；同时给出各状态的条数
 * （实时计数必须保持可见，DESIGN.md §5.4）。
 */
import { SegmentedControl } from "../../../app/ui/SegmentedControl";
import {
  DUE_RANGES,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  type TaskFilter,
} from "../model";

export interface TaskFilterBarProps {
  filter: TaskFilter;
  onChange: (filter: TaskFilter) => void;
}

export function TaskFilterBar({ filter, onChange }: TaskFilterBarProps) {
  return (
    <div className="taskfilter">
      <SegmentedControl
        ariaLabel="按状态筛选"
        size="compact"
        value={filter.status}
        onChange={(status) => onChange({ ...filter, status })}
        options={STATUS_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
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

/**
 * 待办筛选条（components.md §七 `TaskFilterBar`；需求 §9.4）。
 *
 * 三个维度都是**纯本地**筛选（状态 / 优先级 / 截止范围），不发请求；
 * **各状态的条数挂在这里**（实时计数必须保持可见，`DESIGN.md` §5.4）——
 * 概览（`.tksum`）按原型只放"总数 + 完成率"，分状态计数不重复。
 *
 * 【v0.5.2 · 按定稿 2026-09-27 调整】
 * 1. **位置**：它不再是页头下面的满宽横带，而是**主区滚动容器的第一个子元素**
 *    （原型 `.page--task .page__scroll` 的第一个孩子是 `.tkhead__dock` 外壳）——
 *    所以宽度与下面的列表**同一个上限、同样居中**，看板下取消上限铺满。
 * 2. **组名**：胶囊不靠外壳成组，每组前面一行灰微标（状态 / 优先级 / 截止）。
 * 3. **两种形态都由这里渲染**（定稿：两种都留，用户在设置里自选）：
 *    基线 `capsules` = 胶囊横排；`floating` = 收成左侧顶部的紧凑卡片（零高度 sticky 外壳，
 *    不占横排空间、贴着滚动容器常驻），且**只在列表模式出现**（看板列头已承载状态与计数）。
 * 4. **看板下收获**：状态筛选与「隐藏已完成」在看板里失去意义（列头已经说明状态与条数），
 *    一并收起——与原型 `body[data-taskview="kanban"]` 那两条规则同一口径。
 */
import { SegmentedControl } from "../../../app/ui/SegmentedControl";
import type { TaskStatus } from "@menote/mdcore";
import type { TaskFilterForm } from "@menote/shared";
import {
  DUE_RANGES,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  type TaskFilter,
} from "../model";

/**
 * 筛选条的两种形态（定稿：两种都留，用户在设置 › 界面偏好里自选）。
 * **类型来自 `@menote/shared`**（与设置契约同一个联合类型），这里只做转出，不再写一份。
 */
export type { TaskFilterForm };

export interface TaskFilterBarProps {
  filter: TaskFilter;
  onChange: (filter: TaskFilter) => void;
  /** 各状态的条数（含"全部"的合计由调用方给 `all`）；缺省时不显示计数 */
  counts?: Record<TaskStatus, number> & { all?: number };
  /** 形态（来自用户设置 `task_view.filter_form`） */
  form: TaskFilterForm;
  /** 是否看板模式（看板下收起状态筛选与「隐藏已完成」） */
  board: boolean;
  /** 「隐藏已完成」开关：与已完成分组头的收起按钮**共用同一份状态**（定稿要求） */
  hideDone: boolean;
  onHideDoneChange: (hide: boolean) => void;
}

export function TaskFilterBar({
  filter,
  onChange,
  counts,
  form,
  board,
  hideDone,
  onHideDoneChange,
}: TaskFilterBarProps) {
  return (
    <div className={`tkhead__dock${form === "floating" ? " tkhead__dock--float" : ""}`}>
      <div className="taskfilter">
        {board ? null : (
          <>
            <span className="tkhead__gl">状态</span>
            <SegmentedControl
              ariaLabel="按状态筛选"
              size="compact"
              value={filter.status}
              onChange={(status) => onChange({ ...filter, status })}
              options={STATUS_OPTIONS.map((item) => ({
                value: item.value,
                // 计数**并进标签**：一是保持"实时计数可见"，二是原型就是这么放的（不与概览重复）
                label:
                  counts && item.value !== "all"
                    ? `${item.label} ${counts[item.value] ?? 0}`
                    : item.label,
              }))}
            />
          </>
        )}

        <span className="tkhead__gl">优先级</span>
        <SegmentedControl
          ariaLabel="按优先级筛选"
          size="compact"
          value={filter.priority}
          onChange={(priority) => onChange({ ...filter, priority })}
          options={PRIORITY_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
        />

        <span className="tkhead__gl">截止</span>
        <SegmentedControl
          ariaLabel="按截止范围筛选"
          size="compact"
          value={filter.due}
          onChange={(due) => onChange({ ...filter, due })}
          options={DUE_RANGES.map((item) => ({ value: item.value, label: item.label }))}
        />

        <span className="tkhead__spacer" />

        {board ? null : (
          <span className="taskfilter__switch">
            {/* 开关（DESIGN.md §5.3：开 / 关用开关，不用复选框）；文字与开关并排，状态不靠颜色 */}
            <span className="taskfilter__switch-label">隐藏已完成</span>
            <button
              type="button"
              role="switch"
              className="toggle"
              aria-checked={hideDone}
              aria-label="隐藏已完成"
              onClick={() => onHideDoneChange(!hideDone)}
            />
          </span>
        )}
      </div>
    </div>
  );
}

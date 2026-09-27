/**
 * 筛选与排序条（M4-9；《M4 界面稿》§2.7）。
 *
 * 形态：工具栏按钮下方就地展开的**面板内信息条**（不是弹窗、不是菜单）。
 * 两条口径：**纯本地**（不发请求）、**关闭即重置**（收起时由上层把筛排状态清零，本组件只报事件）。
 */
import { type TableColumn } from "@menote/mdcore";
import { Button, Field } from "../../../app/ui/Controls";
import { DropdownMenu } from "../../../app/ui/Menu";
import {
  FILTER_OPERATOR_LABELS,
  type FilterOperator,
  type TableFilter,
} from "../model";

const OPERATORS: FilterOperator[] = ["contains", "equals", "empty", "not_empty", "gt", "lt"];

/** 不需要填值的条件（空/非空），值输入框要收起来——留着会让人以为必须填 */
const VALUELESS: ReadonlySet<FilterOperator> = new Set<FilterOperator>(["empty", "not_empty"]);

export interface TableFilterBarProps {
  columns: readonly TableColumn[];
  filters: readonly TableFilter[];
  onChange: (filters: TableFilter[]) => void;
  /** 「清除全部」：把筛排一起清掉（表头排序指示也由上层一并清） */
  onClearAll: () => void;
  /** 排序当前落在哪一列（条内显示一行只读说明） */
  sort: { columnId: string; direction: "asc" | "desc" } | null;
}

export function TableFilterBar({ columns, filters, onChange, onClearAll, sort }: TableFilterBarProps) {
  const hasConditions = filters.length > 0;

  const update = (index: number, patch: Partial<TableFilter>): void => {
    onChange(filters.map((filter, position) => (position === index ? { ...filter, ...patch } : filter)));
  };

  const sortColumn = sort ? columns.find((column) => column.id === sort.columnId) : undefined;

  return (
    <div className="tablefilterbar" role="group" aria-label="筛选与排序">
      {filters.map((filter, index) => (
        <div className="tablefilterbar__row" key={`${filter.columnId}-${index}`}>
          <DropdownMenu
            label={`第 ${index + 1} 个条件的列`}
            align="left"
            trigger={
              <Button variant="secondary" size="sm">
                {columns.find((column) => column.id === filter.columnId)?.name ?? "选择列"}
              </Button>
            }
            items={columns.map((column) => ({
              id: column.id,
              label: column.name,
              onSelect: () => update(index, { columnId: column.id }),
            }))}
          />

          <DropdownMenu
            label={`第 ${index + 1} 个条件的判断方式`}
            align="left"
            trigger={
              <Button variant="secondary" size="sm">
                {FILTER_OPERATOR_LABELS[filter.operator]}
              </Button>
            }
            items={OPERATORS.map((operator) => ({
              id: operator,
              label: FILTER_OPERATOR_LABELS[operator],
              onSelect: () => update(index, { operator, value: VALUELESS.has(operator) ? "" : filter.value }),
            }))}
          />

          {VALUELESS.has(filter.operator) ? null : (
            <Field
              label={`第 ${index + 1} 个条件的值`}
              value={filter.value}
              onChange={(event) => update(index, { value: event.target.value })}
            />
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => onChange(filters.filter((_, position) => position !== index))}
          >
            移除
          </Button>
        </div>
      ))}

      <div className="tablefilterbar__foot">
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            onChange([...filters, { columnId: columns[0]?.id ?? "", operator: "contains", value: "" }])
          }
          disabled={columns.length === 0}
          title={columns.length === 0 ? "还没有列，先建一列" : undefined}
        >
          加一条条件
        </Button>

        {sortColumn ? (
          <span className="tablefilterbar__sort">
            已按「{sortColumn.name}」{sort?.direction === "asc" ? "升序" : "降序"}
          </span>
        ) : null}

        {/* 没有条件时「清除全部」禁用并写明原因（界面稿 §2.7） */}
        <Button
          variant="secondary"
          size="sm"
          onClick={onClearAll}
          disabled={!hasConditions && sort === null}
          title={!hasConditions && sort === null ? "还没有筛选条件" : undefined}
        >
          清除全部
        </Button>
      </div>
    </div>
  );
}

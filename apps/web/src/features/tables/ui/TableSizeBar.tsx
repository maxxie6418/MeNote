/**
 * 表格状态栏与上限提示（M4-9；《M4 界面稿》§2.1 第 6/7 块、§2.8）。
 *
 * 两条硬规则（`DESIGN.md` §5.4-2 / 禁止项 #8）：**上限提示与实时计数必须可见**，不进 `InfoHint`；
 * 破坏性后果（硬上限 = 本次改动没保存）用危险态写明，并给出出口。
 */
import { type TableSize, type TableHint } from "../model";

export interface TableSizeBarProps {
  size: TableSize;
  hints: readonly TableHint[];
  rows: number;
  columns: number;
  /** 硬上限时的出口（界面稿 §2.8：拆分表格 / 复制本行内容） */
  onSplit?: () => void;
  onCopyRow?: () => void;
}

export function TableSizeBar({ size, hints, rows, columns, onSplit, onCopyRow }: TableSizeBarProps) {
  return (
    <div className="tablesizebar">
      {size.level === "soft" ? (
        <p className="tablesizebar__warn" role="status">
          已超过 1 MB，仍可保存，建议拆分表格
        </p>
      ) : null}

      {size.level === "hard" ? (
        <div className="tablesizebar__danger" role="alert">
          <p>已达 1.9 MB 硬上限，本次改动未保存</p>
          <div className="tablesizebar__actions">
            {onSplit ? (
              <button type="button" className="link" onClick={onSplit}>
                拆分表格
              </button>
            ) : null}
            {onCopyRow ? (
              <button type="button" className="link" onClick={onCopyRow}>
                复制本行内容
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {hints.map((hint) => (
        <p className="tablesizebar__hint" key={hint.kind} role="status">
          {hint.message}
        </p>
      ))}

      <div className="tablesizebar__foot">
        <span className="tablesizebar__count">
          {rows} 行 · {columns} 列
        </span>
        <span className={`size-tag size-tag--${size.level}`} title="按正文实际字节数计算">
          {size.label}
        </span>
      </div>
    </div>
  );
}

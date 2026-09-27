/**
 * 表格区（M4-9；《M4 界面稿》§2.2 / §2.3 / §2.4 / §2.9）。
 *
 * 一条硬约束：**表头固定、表体滚动，横向滚动也发生在同一个容器内**（界面稿 §2.9 /
 * `DESIGN.md` §2.7「每层一个滚动容器」）——所以这里是 `.tablegrid__scroll` 一个滚动容器，
 * 表头用 `position: sticky` 而不是另起一块。
 *
 * 单元格的九种控件（界面稿 §2.3）里，本文实现的是**不依赖附件管线**的那几种；
 * 图片列显示文件名并置灰（缩略图随 M4-10 的附件管线接入），点格进附件选择也留到那一步。
 * 这是有意留的顺序：先把"能编辑的表格"跑通，再加图片。
 */
import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ROW_ID_COLUMN,
  type TableColumn,
  type TableColumnType,
  type TableDoc,
} from "@menote/mdcore";
import { Icon, type IconName } from "../../../app/ui/Icon";
import { DropdownMenu, type MenuItemSpec } from "../../../app/ui/Menu";
import { Chip } from "../../../app/ui/Chip";
import {
  DEFAULT_STATUS_OPTIONS,
  cellValue,
  isProtectedColumn,
  type TableSort,
  type TableViewState,
} from "../model";
import { useVirtualWindow } from "./useVirtualWindow";

const COLUMN_TYPE_LABELS: Readonly<Record<TableColumnType, string>> = {
  text: "文字",
  number: "纯数字",
  select: "单选",
  multi_select: "多选",
  checkbox: "复选",
  status: "状态",
  url: "超链接",
  image: "图片附件",
  date: "时间",
  tags: "标签",
};

/**
 * 列类型图标：**从 sprite 现有 symbol 里挑最近的**（界面稿 §2.2：图标不可单独表意）。
 *
 * sprite 里没有 `hash`/`image`/`more` 这些专用字形，补齐要动 `Icon.tsx` 与 `DESIGN.md §5.5`，
 * 所以这里挑最近的既有字形，**并始终把类型名写成文字**——文字才是承载语义的那一半。
 */
const COLUMN_TYPE_ICONS: Readonly<Record<TableColumnType, IconName>> = {
  text: "note",
  number: "tag",
  select: "check-square",
  multi_select: "check-square",
  checkbox: "check-square",
  status: "clock",
  url: "chevron-right",
  image: "folder",
  date: "clock",
  tags: "tag",
};

function typeLabel(column: TableColumn): string {
  return COLUMN_TYPE_LABELS[column.type] ?? column.type;
}

/** 状态 / 单选的候选项：列定义里给了就用它，否则用状态默认三档 */
function optionsOf(column: TableColumn): string[] {
  if (column.options && column.options.length > 0) return column.options;
  return column.type === "status" ? [...DEFAULT_STATUS_OPTIONS] : [];
}

export interface TableGridProps {
  state: TableViewState;
  /** 可见行（已筛排；由 `visibleRows` 算好传进来，组件不重复算） */
  rows: ReadonlyArray<Record<string, string>>;
  columns: readonly TableColumn[];
  /** 正在编辑的格（`rowId:columnId`），由上层持有，便于"点外部提交" */
  editing: string | null;
  onEditingChange: (cellKey: string | null) => void;
  onCellChange: (rowId: string, columnId: string, value: string) => void;
  onSortChange: (sort: TableSort | null) => void;
  onOpenColumnPanel: () => void;
  onInsertRow: (anchorRowId: string | null, position: "above" | "below") => void;
  onDeleteRow: (rowId: string) => void;
  onMoveRow: (rowId: string, offset: -1 | 1) => void;
  /** 表格一行都没有时的空状态出口（界面稿 §2.8：同屏只有一个实心主按钮） */
  emptyAction?: React.ReactNode;
}

export function TableGrid({
  state,
  rows,
  columns,
  editing,
  onEditingChange,
  onCellChange,
  onSortChange,
  onOpenColumnPanel,
  onInsertRow,
  onDeleteRow,
  onMoveRow,
  emptyAction,
}: TableGridProps) {
  const doc = state.doc;
  // 大表只渲染可见的那一段（小表/量不出视口时自动退化成全渲染）
  const { containerRef, range } = useVirtualWindow(rows.length);

  if (doc.rows.length === 0) {
    return (
      <div className="tablegrid__empty">
        <p className="tablegrid__empty-title">这张表还没有内容</p>
        <p className="tablegrid__empty-hint">列结构已经建好，加第一行就能开始记。</p>
        {emptyAction}
      </div>
    );
  }

  return (
    <div className="tablegrid__scroll" ref={containerRef} role="grid" aria-label="表格">
      <table className="tablegrid">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col" className="tablegrid__th">
                <span className="tablegrid__th-inner">
                  <Icon name={COLUMN_TYPE_ICONS[column.type]} size={13} />
                  <span className="tablegrid__th-name">{column.name}</span>
                  <span className="tablegrid__th-type" title={`列类型：${typeLabel(column)}`}>
                    {typeLabel(column)}
                  </span>
                  {state.sort?.columnId === column.id ? (
                    <span className="tablegrid__sort" title="当前排序列">
                      {state.sort.direction === "asc" ? "↑" : "↓"}
                    </span>
                  ) : null}
                  <ColumnHeaderMenu
                    column={column}
                    doc={doc}
                    sort={state.sort}
                    onSortChange={onSortChange}
                    onOpenColumnPanel={onOpenColumnPanel}
                  />
                </span>
              </th>
            ))}
            <th scope="col" className="tablegrid__th tablegrid__th--rowmenu" aria-label="行操作" />
          </tr>
        </thead>
        <tbody>
          {/*
            大表窗口化：上下各一个占位行撑住滚动条高度（界面稿 §2.9）。
            占位行 `aria-hidden` 且没有单元格内容——读屏与"复制整表"都不该看见它。
          */}
          {range.topPad > 0 ? (
            <tr aria-hidden="true" className="tablegrid__pad" style={{ height: range.topPad }} />
          ) : null}
          {rows.slice(range.start, range.end).map((row) => {
            const rowId = cellValue(row, ROW_ID_COLUMN);
            return (
              <tr key={rowId} className="tablegrid__tr">
                {columns.map((column) => (
                  <Cell
                    key={column.id}
                    column={column}
                    row={row}
                    rowId={rowId}
                    editing={editing}
                    onEditingChange={onEditingChange}
                    onCellChange={onCellChange}
                  />
                ))}
                <td className="tablegrid__td tablegrid__td--rowmenu">
                  <RowMenu
                    rowId={rowId}
                    onInsertRow={onInsertRow}
                    onDeleteRow={onDeleteRow}
                    onMoveRow={onMoveRow}
                  />
                </td>
              </tr>
            );
          })}
          {range.bottomPad > 0 ? (
            <tr aria-hidden="true" className="tablegrid__pad" style={{ height: range.bottomPad }} />
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/** 列头菜单：三个入口（列设置 / 按此列筛选 / 按此列排序），**不在这里增删列**（界面稿 §2.2） */
function ColumnHeaderMenu({
  column,
  doc,
  sort,
  onSortChange,
  onOpenColumnPanel,
}: {
  column: TableColumn;
  doc: TableDoc;
  sort: TableSort | null;
  onSortChange: (sort: TableSort | null) => void;
  onOpenColumnPanel: () => void;
}) {
  const sorted = sort?.columnId === column.id;
  const items: MenuItemSpec[] = [
    { id: "settings", label: "列设置…", onSelect: onOpenColumnPanel },
    {
      id: "sort-asc",
      label: "按此列升序",
      onSelect: () => onSortChange({ columnId: column.id, direction: "asc" }),
    },
    {
      id: "sort-desc",
      label: "按此列降序",
      onSelect: () => onSortChange({ columnId: column.id, direction: "desc" }),
    },
    {
      id: "sort-clear",
      label: "清除排序",
      disabled: !sorted,
      title: sorted ? undefined : "当前没有按这一列排序",
      onSelect: () => onSortChange(null),
    },
  ];

  if (isProtectedColumn(doc, column.id)) {
    items.push({
      id: "protected",
      label: "行 ID 列不可修改",
      disabled: true,
      title: "`_id` 是稳定行 ID，不可删除或改类型",
      onSelect: () => undefined,
    });
  }

  return (
    <span className="tablegrid__th-menu">
      <DropdownMenu
        label={`${column.name} 的列操作`}
        showChevron={false}
        trigger={<Icon name="chevron-down" size={13} />}
        items={items}
      />
    </span>
  );
}

function RowMenu({
  rowId,
  onInsertRow,
  onDeleteRow,
  onMoveRow,
}: {
  rowId: string;
  onInsertRow: (anchorRowId: string | null, position: "above" | "below") => void;
  onDeleteRow: (rowId: string) => void;
  onMoveRow: (rowId: string, offset: -1 | 1) => void;
}) {
  return (
    <DropdownMenu
      label="行操作"
      showChevron={false}
      trigger={<Icon name="chevron-down" size={13} />}
      items={[
        { id: "above", label: "在上方插入", onSelect: () => onInsertRow(rowId, "above") },
        { id: "below", label: "在下方插入", onSelect: () => onInsertRow(rowId, "below") },
        { id: "up", label: "上移一行", onSelect: () => onMoveRow(rowId, -1) },
        { id: "down", label: "下移一行", onSelect: () => onMoveRow(rowId, 1) },
        { id: "delete", label: "删除此行", onSelect: () => onDeleteRow(rowId) },
      ]}
    />
  );
}

/** 单元格：按列类型给不同的就地控件（界面稿 §2.3） */
function Cell({
  column,
  row,
  rowId,
  editing,
  onEditingChange,
  onCellChange,
}: {
  column: TableColumn;
  row: Record<string, string>;
  rowId: string;
  editing: string | null;
  onEditingChange: (cellKey: string | null) => void;
  onCellChange: (rowId: string, columnId: string, value: string) => void;
}) {
  const value = cellValue(row, column.id);
  const cellKey = `${rowId}:${column.id}`;
  const isEditing = editing === cellKey;
  const [draft, setDraft] = useState(value);

  const commit = (): void => {
    if (draft !== value) onCellChange(rowId, column.id, draft);
    onEditingChange(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(value);
      onEditingChange(null);
    }
  };

  if (column.type === "checkbox") {
    const checked = value === "true" || value === "1";
    return (
      <td className="tablegrid__td">
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={`${column.name}：${checked ? "已勾选" : "未勾选"}`}
          className="tablegrid__check"
          onClick={() => onCellChange(rowId, column.id, checked ? "" : "true")}
        >
          {checked ? <Chip tone="green">✓</Chip> : null}
        </button>
      </td>
    );
  }

  if (column.type === "select" || column.type === "status" || column.type === "multi_select") {
    const options = optionsOf(column);
    const selected = column.type === "multi_select"
      ? value.split(",").map((item) => item.trim()).filter((item) => item !== "")
      : [value];
    const items: MenuItemSpec[] = options.map((option) => ({
      id: option,
      label: `${selected.includes(option) ? "✓ " : ""}${option}`,
      // 多选**选完不收起**（界面稿 §2.3）
      keepOpen: column.type === "multi_select",
      onSelect: () => {
        if (column.type === "multi_select") {
          const next = selected.includes(option)
            ? selected.filter((item) => item !== option)
            : [...selected, option];
          onCellChange(rowId, column.id, next.join(", "));
          return;
        }
        onCellChange(rowId, column.id, option);
      },
    }));

    if (items.length === 0) {
      return (
        <td className="tablegrid__td">
          <span className="tablegrid__cell-text">{value || "—"}</span>
        </td>
      );
    }

    return (
      <td className="tablegrid__td">
        <DropdownMenu
          label={`${column.name}：选择值`}
          align="left"
          showChevron={false}
          trigger={
            // 触发内容用 `span` 而不是 `button`：外层已经是菜单自己的按钮，套两层按钮是非法 HTML
            // （React 会警告，读屏与键盘也会遇到两个可点元素）
            <span className="tablegrid__cell">
              {value ? <Chip tone="neutral">{value}</Chip> : <span className="tablegrid__cell-empty">—</span>}
            </span>
          }
          items={items}
        />
      </td>
    );
  }

  if (isEditing && (column.type === "text" || column.type === "number" || column.type === "url" ||
    column.type === "date" || column.type === "tags")) {
    return (
      <td className="tablegrid__td">
        <input
          className="tablegrid__input"
          // 就地编辑：进入编辑态就要能直接打字（不是页面级的自动聚焦，是"点哪格编哪格"）
          autoFocus
          aria-label={`${column.name}（编辑）`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
        {column.type === "number" && draft.trim() !== "" && Number.isNaN(Number(draft)) ? (
          <span className="tablegrid__cell-warn" role="alert">
            不是数字，保存后会按原文显示
          </span>
        ) : null}
      </td>
    );
  }

  return (
    <td className="tablegrid__td">
      <button
        type="button"
        className="tablegrid__cell"
        aria-label={`${column.name}：${value || "空"}`}
        onClick={() => {
          setDraft(value);
          onEditingChange(cellKey);
        }}
      >
        {column.type === "image" ? (
          value ? (
            // 缩略图随 M4-10 的附件管线接入；现在如实显示文件名（界面稿 §2.3：找不到附件显示文件名并置灰）。
            // sprite 里没有 `image` 字形，所以这里只用文字，不拿一个不相干的图标充数
            <span className="tablegrid__cell-image" title="缩略图随附件功能（M4-10）接入">
              {value}
            </span>
          ) : (
            <span className="tablegrid__cell-empty">—</span>
          )
        ) : column.type === "tags" && value ? (
          <span className="tablegrid__cell-tags">
            {value
              .split(",")
              .map((tag) => tag.trim())
              .filter((tag) => tag !== "")
              .map((tag) => (
                <Chip key={tag} variant="tag">
                  {tag}
                </Chip>
              ))}
          </span>
        ) : column.type === "url" && value ? (
          <span className="link">{value}</span>
        ) : (
          <span className="tablegrid__cell-text">{value || "—"}</span>
        )}
      </button>
    </td>
  );
}

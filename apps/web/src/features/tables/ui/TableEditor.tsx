/**
 * 表格视图（M4-9；《M4 界面稿》§二）。
 *
 * 装配件：正文头（标题 + 「更多」菜单）→ 工具栏 → 筛选条（展开时）→ 表格 / 图册 → 状态栏。
 *
 * **状态归属**：`doc` 由上层（条目的编辑工作区）持有——这个组件只把"用户做了什么"报上去
 * （`onDocChange`），自己不落库、不管同步；筛排与档位是**纯界面状态**，活在这里的 `useState`，
 * 关闭即重置（界面稿 §2.5 / §2.7），因此它们永远不会被写进 YAML。
 */
import { useMemo, useState } from "react";
import { Icon } from "../../../app/ui/Icon";
import { Button } from "../../../app/ui/Controls";
import { DropdownMenu } from "../../../app/ui/Menu";
import { TableFilterBar } from "./TableFilterBar";
import { TableColumnManager } from "./TableColumnManager";
import { TableGrid } from "./TableGrid";
import { TableSizeBar } from "./TableSizeBar";
import { TableToolbar } from "./TableToolbar";
import { GalleryView } from "./GalleryView";
import {
  addRow,
  blocksSave,
  galleryAvailability,
  insertRow,
  moveRow,
  removeRow,
  reorderRow,
  setCell,
  tableHints,
  tableSize,
  visibleColumns,
  visibleRows,
  type TableFilter,
  type TableSort,
  type TableViewState,
} from "../model";

export interface TableEditorProps {
  /** 条目标题（明文；表格本身不存标题——它在 `items.title` 里，由工作区持有） */
  title?: string;
  doc: TableViewState["doc"];
  onDocChange: (doc: TableViewState["doc"]) => void;
  /** 「更多」菜单里的降级入口（确认框由外层负责） */
  onRequestDegrade: () => void;
  /** 硬上限时的出口之一：把这一行内容复制走 */
  onCopyRow?: () => void;
  /** 隐私锁定态：整个表格区不渲染（界面稿 §2.11），由外层决定是否挂载本组件 */
  encrypted?: boolean;
}

export function TableEditor({
  title = "表格",
  doc,
  onDocChange,
  onRequestDegrade,
  onCopyRow,
  encrypted = false,
}: TableEditorProps) {
  const [view, setView] = useState<TableViewState["view"]>("table");
  const [filters, setFilters] = useState<TableFilter[]>([]);
  const [sort, setSort] = useState<TableSort | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  // 列定义面板由本组件托管：两个入口（表头菜单「列设置…」、图册禁用时的「添加图片列」）都落在它上面。
  // `panelSeq` 每次打开自增并作为面板的 `key`：**换 key 重新挂载**，草稿自然以最新文档为起点
  // （比在面板里写"打开时重置草稿"的 effect 干净，也躲开 effect 里同步 setState 的级联渲染）
  const [panelSeq, setPanelSeq] = useState<number | null>(null);

  const state: TableViewState = useMemo(
    () => ({ doc, filters, sort, view }),
    [doc, filters, sort, view],
  );

  const columns = visibleColumns(doc);
  const rows = useMemo(() => visibleRows(state), [state]);
  const size = useMemo(() => tableSize(doc), [doc]);
  const hints = useMemo(() => tableHints(doc), [doc]);
  const gallery = galleryAvailability(doc);

  /** 改文档后按硬上限判定：到上限就**不提交**这次改动（界面稿 §2.8：保存被阻止） */
  const commit = (next: typeof doc): void => {
    if (blocksSave(tableSize(next))) {
      onDocChange(doc);
      return;
    }
    onDocChange(next);
  };

  /** 打开列定义面板：`panelSeq` 自增即换 key，面板重新挂载、草稿以最新文档为起点 */
  const openColumnPanel = (): void => setPanelSeq((seq) => (seq ?? 0) + 1);

  return (    <div className="tableeditor">
      <header className="tableeditor__head">
        <h1 className="tableeditor__title">{title}</h1>
        {encrypted ? <span className="enc-mark">已加密</span> : null}
        <DropdownMenu
          label="表格的更多操作"
          showChevron={false}
          trigger={<Icon name="chevron-down" size={13} />}
          items={[
            { id: "columns", label: "列设置…", onSelect: () => openColumnPanel() },
            { id: "degrade", label: "降级为普通笔记", onSelect: onRequestDegrade },
          ]}
        />
      </header>

      <TableToolbar
        view={view}
        onViewChange={setView}
        galleryAvailable={gallery.available}
        onRequestImageColumn={() => openColumnPanel()}
        onAddRow={() => commit(addRow(doc).doc)}
        showAddRow={doc.rows.length > 0}
        filterOpen={filterOpen}
        onToggleFilter={() => {
          // 关闭即重置（界面稿 §2.7）：收起时把筛排一起清掉，表头排序指示也一并清
          if (filterOpen) {
            setFilters([]);
            setSort(null);
          }
          setFilterOpen(!filterOpen);
        }}
        activeFilterCount={filters.length}
        filteredCount={rows.length}
        totalCount={doc.rows.length}
      />

      {filterOpen ? (
        <TableFilterBar
          // 传**可见列**：默认条件落在第一个数据列上，而不是默认隐藏的 `_id`（否则用户加一条空条件
          // 会莫名其妙按行 ID 筛）
          columns={columns}
          filters={filters}
          onChange={setFilters}
          onClearAll={() => {
            setFilters([]);
            setSort(null);
          }}
          sort={sort}
        />
      ) : null}

      {view === "gallery" ? (
        <GalleryView
          doc={doc}
          columns={columns}
          onCellChange={(rowId, columnId, value) => commit(setCell(doc, rowId, columnId, value))}
          onBackToTable={() => setView("table")}
        />
      ) : (
        <TableGrid
          state={state}
          rows={rows}
          columns={columns}
          editing={editing}
          onEditingChange={setEditing}
          onCellChange={(rowId, columnId, value) => commit(setCell(doc, rowId, columnId, value))}
          onSortChange={setSort}
          onOpenColumnPanel={() => openColumnPanel()}
          onInsertRow={(anchorRowId, position) => commit(insertRow(doc, anchorRowId, position).doc)}
          onDeleteRow={(rowId) => commit(removeRow(doc, rowId))}
          onMoveRow={(rowId, offset) => commit(moveRow(doc, rowId, offset))}
          onReorderRow={(rowId, beforeRowId) => commit(reorderRow(doc, rowId, beforeRowId))}
          emptyAction={
            <Button variant="secondary" size="sm" onClick={() => commit(addRow(doc).doc)}>
              <Icon name="plus" size={13} />
              新增行
            </Button>
          }
        />
      )}

      <TableSizeBar
        size={size}
        hints={hints}
        rows={doc.rows.length}
        columns={doc.columns.length}
        onCopyRow={onCopyRow}
      />

      {panelSeq !== null ? (
        <TableColumnManager
          // 换 key 重新挂载：草稿从最新 `doc` 起算，无需在面板里做"打开时重置"
          key={panelSeq}
          open
          mode="edit"
          doc={doc}
          onConfirm={(next) => {
            commit(next);
            setPanelSeq(null);
          }}
          onCancel={() => setPanelSeq(null)}
        />
      ) : null}
    </div>
  );
}

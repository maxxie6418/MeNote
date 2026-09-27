/**
 * 表格工具栏（M4-9；《M4 界面稿》§2.1 第 2 块、§2.5）。
 *
 * 左：「表格 / 图册」盒式分段控件（`DESIGN.md` §5.3：互斥视图切换用盒式，不用下划线页签）；
 * 右：「新增行」+「筛选与排序」。**图册不可用时置灰且必须说明原因 + 给出口**（`DESIGN.md` §6.1）。
 */
import { Icon } from "../../../app/ui/Icon";
import { Button, IconButton } from "../../../app/ui/Controls";
import { SegmentedControl } from "../../../app/ui/SegmentedControl";

export interface TableToolbarProps {
  view: "table" | "gallery";
  onViewChange: (view: "table" | "gallery") => void;
  /** 没有图片列时图册不可用 */
  galleryAvailable: boolean;
  /** 不可用时的出口：打开列定义面板加一列图片 */
  onRequestImageColumn: () => void;
  onAddRow: () => void;
  /**
   * 表格一行都没有时**收掉「新增行」**：空状态自己带一个同动作的按钮，
   * 同屏只能有一个实心主色按钮（界面稿 §2.8）。
   */
  showAddRow?: boolean;
  filterOpen: boolean;
  onToggleFilter: () => void;
  /** 生效的筛选条数（用于按钮选中态与实时计数） */
  activeFilterCount: number;
  filteredCount: number;
  totalCount: number;
}

export function TableToolbar({
  view,
  onViewChange,
  galleryAvailable,
  onRequestImageColumn,
  onAddRow,
  showAddRow = true,
  filterOpen,
  onToggleFilter,
  activeFilterCount,
  filteredCount,
  totalCount,
}: TableToolbarProps) {
  const filtering = activeFilterCount > 0;

  return (
    <div className="tabletoolbar">
      <SegmentedControl
        ariaLabel="表格视图切换"
        size="compact"
        value={view}
        onChange={onViewChange}
        options={[
          { value: "table", label: "表格", icon: "table" },
          {
            value: "gallery",
            label: "图册",
            icon: "folder",
            disabled: !galleryAvailable,
            title: galleryAvailable ? undefined : "添加图片列后可使用图册",
          },
        ]}
      />

      {/* 禁用说明必须可见，并给出出口（不是只置灰） */}
      {!galleryAvailable ? (
        <span className="tabletoolbar__hint">
          添加图片列后可使用图册，
          <button type="button" className="link" onClick={onRequestImageColumn}>
            添加图片列
          </button>
        </span>
      ) : null}

      <div className="tabletoolbar__right">
        {filtering ? (
          <span className="tabletoolbar__count" role="status">
            筛选后 {filteredCount} / {totalCount} 行
          </span>
        ) : null}
        <IconButton
          label={filtering ? `筛选与排序（已生效 ${activeFilterCount} 条）` : "筛选与排序"}
          icon="search"
          size={13}
          aria-pressed={filterOpen || filtering}
          onClick={onToggleFilter}
        />
        {/* 空表时不渲染它：空状态自己带一个同动作的按钮，同屏只留一个主操作（界面稿 §2.8） */}
        {showAddRow ? (
          <Button variant="secondary" size="sm" onClick={onAddRow}>
            <Icon name="plus" size={13} />
            新增行
          </Button>
        ) : null}
      </div>
    </div>
  );
}

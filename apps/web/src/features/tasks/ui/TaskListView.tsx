/**
 * 待办列表视图（components.md §七 `TaskListView`）。
 *
 * 按状态分组（待办 → 进行中 → 已完成），组内按"有截止在前 → 优先级"排序（见 `../model`）。
 * 待办视图**不受置顶影响**（Q9）。
 *
 * 【v0.5.2 · 按定稿 2026-09-27 调整】
 * 1. 分组头补上**分隔线**（原型 `.tkgrp__rule`：占满剩余宽度的 1px 细线），分组之间更好扫；
 * 2. 「已完成」分组头带**收起按钮**，与筛选条上的「隐藏已完成」开关**共用同一份状态**
 *    （定稿明写"同一份状态"）——收起时分组头与计数仍在（不让人以为数据没了），只收行；
 * 3. 列表整体与筛选条同一个内容上限并居中（原型 `.page--task` 的 `--cap: 920px`）。
 */
import type { LocalItem } from "../../../data/db";
import type { TaskStatus } from "@menote/mdcore";
import { groupTasks } from "../model";
import { TaskRow } from "./TaskRow";
import { Button } from "../../../app/ui/Controls";
import { Icon } from "../../../app/ui/Icon";

export interface TaskListViewProps {
  tasks: readonly LocalItem[];
  titles: Readonly<Record<string, string>>;
  today: string;
  /** 正打开详情的那一条（`null` = 没有） */
  openId: string | null;
  onOpen: (itemId: string) => void;
  onStatusChange: (itemId: string, status: TaskStatus) => void;
  onClearMarker: (itemId: string) => void;
  /** 「隐藏已完成」的当前状态（与筛选条开关同一份） */
  hideDone: boolean;
  onToggleHideDone: () => void;
  /** 空状态里的「切到录入框」出口（原型空态有主按钮；面板已有这个回调） */
  onAdd?: () => void;
}

export function TaskListView({
  tasks,
  titles,
  today,
  openId,
  onOpen,
  onStatusChange,
  onClearMarker,
  hideDone,
  onToggleHideDone,
  onAdd,
}: TaskListViewProps) {
  const groups = groupTasks(tasks).filter((group) => group.tasks.length > 0);

  if (groups.length === 0) {
    return (
      <div className="memo-empty">
        <span className="empty-ico">
          <Icon name="check-square" size={20} />
        </span>
        <p className="memo-empty__title">没有待办</p>
        <p className="memo-empty__hint">
          在录入框切到「待办」记一条，或者放宽上面的筛选条件。
        </p>
        {onAdd ? (
          <Button size="sm" variant="secondary" onClick={onAdd}>
            <Icon name="plus" size={13} />
            切到录入框
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="tasklist">
      {groups.map((group) => {
        const collapsed = group.status === "done" && hideDone;
        return (
          <section key={group.status} className="tasklist__group" aria-label={group.label}>
            <h3 className="tasklist__head">
              {/* 分组圆点（原型 `.tkgrp__dot`：进行中琥珀、已完成绿、待办中性）——色不单独表意，旁边就是分组名 */}
              <span
                className={`tasklist__dot tasklist__dot--${group.status}`}
                aria-hidden="true"
              />
              {group.label}
              {/* 列表分组计数：**无底微标 + 带单位**（原型 `.tkgrp__n`；看板列头那套是胶囊、不带单位） */}
              <span className="tasklist__n">{group.tasks.length} 条</span>
              {/* 分隔线（原型 `.tkgrp__rule`）：把分组头与右侧的收起按钮连成一条 */}
              <span className="tasklist__rule" aria-hidden="true" />
              {group.status === "done" ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm tasklist__collapse"
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? "展开已完成" : "收起已完成"}
                  title={collapsed ? "展开已完成" : "收起已完成"}
                  onClick={onToggleHideDone}
                >
                  <Icon name="chevron-down" size={13} />
                </button>
              ) : null}
            </h3>
            {/* 行装在一个圆角容器里（原型 `.tkrows`），行之间由 CSS 画一条细线 */}
            {collapsed ? null : (
              <div className="tasklist__rows">
                {group.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    title={titles[task.id] ?? "未命名"}
                    today={today}
                    open={openId === task.id}
                    onOpen={onOpen}
                    onStatusChange={onStatusChange}
                    onClearMarker={onClearMarker}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

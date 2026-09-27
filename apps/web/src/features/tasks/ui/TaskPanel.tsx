/**
 * 待办视图（components.md §七 `TaskPanel`；需求 §9.4、功能拆解 M06-10）。
 *
 * 独立的浏览入口（在 Memo 之后）。清单条目**仍然出现在 Memo 时间轴**（不动数据模型）；
 * 待办视图**不受置顶影响**（Q9）。
 *
 * 结构（**v0.5.2 按定稿 2026-09-27 调整·已定收成一条**）：
 * ```
 * .taskpanel
 *  ├─ .tkhead            ← 页头只留一条主控：标题 · 说明 ⓘ · 概览 · 视图切换 · 添加待办
 *  └─ .taskpanel__wrap   ← 相对定位外壳（详情浮层绝对定位在它里面，不推挤内容）
 *      ├─ .taskpanel__body（唯一滚动容器：筛选条 + 列表 / 看板）
 *      └─ .tdetail（可选，浮层）
 * ```
 * 两条与原型一致的口径：**筛选条在滚动容器里**（所以与列表同宽、随内容滚），
 * **详情浮层不占位**（不推挤列表与看板、不铺遮罩，面板开着还能点别的任务切过去）。
 *
 * 「今天」在这里只取一次（渲染期调 `Date.now()` 不纯）；日期口径按设置时区算。
 */
import { useState } from "react";
import type { LocalItem } from "../../../data/db";
import { isMemoVisible, type PrivacyGate } from "@menote/shared";
import { Button } from "../../../app/ui/Controls";
import { InfoHint } from "../../../app/ui/InfoHint";
import { LockedPlaceholder } from "../../../app/ui/LockedPlaceholder";
import { SegmentedControl } from "../../../app/ui/SegmentedControl";
import type { TaskStatus } from "@menote/mdcore";
import {
  countByStatus,
  EMPTY_TASK_FILTER,
  filterTasks,
  summarizeTasks,
  TASK_COLUMNS,
  type TaskFilter,
} from "../model";
import { TaskDetail } from "./TaskDetail";
import { TaskFilterBar, type TaskFilterForm } from "./TaskFilterBar";
import { TaskKanban } from "./TaskKanban";
import { TaskListView } from "./TaskListView";

export type TaskViewMode = "list" | "kanban";

const VIEW_MODES = [
  { value: "list" as const, label: "列表" },
  { value: "kanban" as const, label: "看板" },
];

export interface TaskPanelProps {
  tasks: readonly LocalItem[];
  /** 条目标题（正文首行），由调用方从 Memo 正文剥出来 */
  titles: Readonly<Record<string, string>>;
  /** 条目正文（详情浮层的「描述」用；没缓存到就是缺项） */
  bodies: Readonly<Record<string, string>>;
  /** 今天的 `YYYY-MM-DD`（按设置时区算好） */
  today: string;
  /**
   * 隐私门禁（M3-5）：待办是 Memo 派生的，Memo 锁定时**整屏占位**
   * （清单条目的内容也在 Memo 正文里，所以与 Memo 同生共死）。
   */
  gate: PrivacyGate;
  /** 占位上的「解锁」出口（打开解锁框） */
  onUnlock: () => void;
  /** 页头「添加待办」：把焦点送回功能栏的录入框并切到待办档（M07-01 入口二） */
  onAdd: () => void;
  /** 筛选条形态（用户设置 `task_view.filter_form`：胶囊横排 / 悬浮小组件） */
  filterForm: TaskFilterForm;
  onStatusChange: (itemId: string, status: TaskStatus) => void;
  onClearMarker: (itemId: string) => void;
}

export function TaskPanel({
  tasks,
  titles,
  bodies,
  today,
  gate,
  onUnlock,
  onAdd,
  filterForm,
  onStatusChange,
  onClearMarker,
}: TaskPanelProps) {
  const [mode, setMode] = useState<TaskViewMode>("list");
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_TASK_FILTER);
  /** 「隐藏已完成」：筛选条开关与已完成分组头的收起按钮**共用这一份状态**（定稿要求） */
  const [hideDone, setHideDone] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = filterTasks(tasks, filter, today);
  const counts = countByStatus(tasks);
  const total = TASK_COLUMNS.reduce((sum, column) => sum + counts[column.status], 0);
  /** 概览（原型 `.tksum`）：总数、完成率与进度条的分段比例 */
  const summary = summarizeTasks(tasks);
  const board = mode === "kanban";
  /** 详情跟着**数据**走：条目被清掉标记 / 被删后自动关闭，不会留下一个空壳面板 */
  const openTask = openId === null ? null : (tasks.find((task) => task.id === openId) ?? null);

  if (!isMemoVisible(gate)) {
    // 锁定时整屏占位：保留标题与计数（统计口径不变），筛选与内容一律不渲染
    return (
      <section className="taskpanel" aria-label="待办">
        <header className="tkhead">
          <div className="tkhead__main">
            <h2 className="memopanel__title">待办</h2>
            <span className="listpane__count">共 {total} 条</span>
          </div>
        </header>
        <div className="taskpanel__wrap">
          <div className="taskpanel__body scroll-thin">
            <LockedPlaceholder
              title="待办已锁定"
              hint="待办来自 Memo 正文；隐私锁已锁定时不显示内容与状态。解锁后即可查看。"
              onUnlock={onUnlock}
            />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`taskpanel${board ? " taskpanel--board" : ""}`}
      aria-label="待办"
      /* 形态挂在容器上：看板下筛选条不限宽、详情浮层宽度也按同一断点走（CSS 里用这个标记） */
      data-filter-form={filterForm}
    >
      <header className="tkhead">
        <div className="tkhead__main">
          <h2 className="memopanel__title">待办</h2>
          {/* 说明收进 InfoHint（DESIGN.md §5.4-1）；概览里的实时计数照旧**可见**（禁止项 #8） */}
          <InfoHint label="待办说明">
            待办是清单 Memo 派生的视图，不改变数据模型；清单条目仍然出现在 Memo 时间轴里。
            待办视图不受置顶影响。
          </InfoHint>
          {/*
            概览照原型 `.tksum`：细进度条 + 「共 N 条 · 已完成 M 条（P%）」。
            原型有意**不在概览里重复分状态计数**（那些挂在筛选条上），所以这里也不重复。
            进度条是纯视觉的（三段按条数占比、颜色只是辅助），所以给它 `role="img"` + 读屏文案。
          */}
          <span className="tksum">
            {summary.total > 0 ? (
              <span className="tksum__bar" role="img" aria-label={summary.barLabel}>
                <span className="bar__done" style={{ flex: summary.done }} />
                <span className="bar__doing" style={{ flex: summary.doing }} />
                <span className="bar__todo" style={{ flex: summary.todo }} />
              </span>
            ) : null}
            <span>
              共 <b>{summary.total}</b> 条 · 已完成 <b>{summary.done}</b> 条（
              <b>{summary.donePercent}%</b>）
            </span>
          </span>
          <span className="tkhead__spacer" />
          {/* 视图切换固定在「添加」左边，与 Memo 页同一个位置、同一套壳 */}
          <SegmentedControl
            ariaLabel="待办视图切换"
            size="compact"
            value={mode}
            onChange={setMode}
            options={VIEW_MODES}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={onAdd}
            title="回到功能栏的录入框记一条待办"
          >
            添加待办
          </Button>
        </div>
      </header>

      <div className="taskpanel__wrap">
        <div className="taskpanel__body scroll-thin">
          <TaskFilterBar
            filter={filter}
            onChange={setFilter}
            counts={counts}
            form={filterForm}
            board={board}
            hideDone={hideDone}
            onHideDoneChange={setHideDone}
          />
          {board ? (
            <TaskKanban
              tasks={visible}
              titles={titles}
              today={today}
              openId={openId}
              onOpen={(itemId) => setOpenId((current) => (current === itemId ? null : itemId))}
              onStatusChange={onStatusChange}
              onClearMarker={onClearMarker}
            />
          ) : (
            <TaskListView
              tasks={visible}
              titles={titles}
              today={today}
              openId={openId}
              onOpen={(itemId) => setOpenId((current) => (current === itemId ? null : itemId))}
              onStatusChange={onStatusChange}
              onClearMarker={onClearMarker}
              hideDone={hideDone}
              onToggleHideDone={() => setHideDone((value) => !value)}
            />
          )}
        </div>

        {openTask ? (
          <TaskDetail
            task={openTask}
            title={titles[openTask.id] ?? "未命名"}
            body={bodies[openTask.id] ?? ""}
            today={today}
            onClose={() => setOpenId(null)}
            onStatusChange={onStatusChange}
            onClearMarker={onClearMarker}
          />
        ) : null}
      </div>
    </section>
  );
}

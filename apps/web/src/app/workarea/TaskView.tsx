/**
 * 待办视图在组合根里的接线（M2-5 建；M3-9 从 `App.tsx` 抽出，为入口文件的行数预算让位）。
 *
 * 三条口径在这里落定：
 * - **任务集合只取清单 Memo**（`is_task === 1`），标题与正文都由 Memo 正文剥出来；
 * - 改状态 / 清标记后**刷新工作区**（列表与时间轴都要跟着变）；
 * - 页头的「添加待办」与筛选条形态都由组合根给（前者要切录入框的档、后者来自用户设置），
 *   本组件只做透传，不自己持有全局状态。
 */
import type { LocalItem, MemoContent } from "../../data/db";
import type { PrivacyGate } from "@menote/shared";
import type { TaskStatus } from "@menote/mdcore";
import { TaskPanel } from "../../features/tasks/ui/TaskPanel";
import type { TaskFilterForm } from "../../features/tasks/ui/TaskFilterBar";
import { taskTitle } from "../../features/tasks/model";
import { TwoPane } from "./TwoPane";

export interface TaskViewProps {
  /** 全部 Memo（内部只取清单条目） */
  memos: readonly LocalItem[];
  contents: Readonly<Record<string, MemoContent>>;
  /** 今天的 `YYYY-MM-DD`（按设置时区算好） */
  today: string;
  gate: PrivacyGate;
  onUnlock: () => void;
  /** 页头「添加待办」：切录入框到待办档并聚焦 */
  onAdd: () => void;
  /** 筛选条形态（用户设置） */
  filterForm: TaskFilterForm;
  onStatusChange: (itemId: string, status: TaskStatus) => void;
  onClearMarker: (itemId: string) => void;
}

export function TaskView(props: TaskViewProps) {
  const entries = Object.entries(props.contents);

  return (
    <TwoPane
      listHidden={true}
      list={null}
      doc={
        <TaskPanel
          tasks={props.memos.filter((memo) => memo.is_task === 1)}
          titles={Object.fromEntries(
            entries.map(([id, entry]) => [id, taskTitle(entry.content)]),
          )}
          /* 详情浮层的「描述」要正文原文；标题是它的首行，两者同源 */
          bodies={Object.fromEntries(entries.map(([id, entry]) => [id, entry.content]))}
          today={props.today}
          gate={props.gate}
          onUnlock={props.onUnlock}
          onAdd={props.onAdd}
          filterForm={props.filterForm}
          onStatusChange={props.onStatusChange}
          onClearMarker={props.onClearMarker}
        />
      }
    />
  );
}

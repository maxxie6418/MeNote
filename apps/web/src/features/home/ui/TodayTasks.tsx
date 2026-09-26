/**
 * 今日待办卡（components.md §三 `TodayTasks`；需求 §7.4）。
 *
 * 内容**来自清单 Memo**，所以在 Memo 门禁锁定时以"已锁定"占位（Q7）——不是空态，而是明确告知
 * "解锁后可见"（DESIGN.md §5.4-3：空状态要说明原因与出口）。
 */
import { HomeCard } from "./HomePanel";
import { Icon } from "../../../app/ui/Icon";
import type { TaskPreview } from "../model";

export interface TodayTasksProps {
  tasks: readonly TaskPreview[];
  memoLocked: boolean;
  onOpenItem: (itemId: string) => void;
}

export function TodayTasks({ tasks, memoLocked, onOpenItem }: TodayTasksProps) {
  return (
    <HomeCard title="今日待办" icon="check-square" note="来自清单 Memo">
      {memoLocked ? (
        <div className="home-locked">
          <Icon name="lock" size={13} />
          来自 Memo 的内容已锁定，解锁后可见
        </div>
      ) : tasks.length === 0 ? (
        <div className="home-empty">没有未完成的待办。</div>
      ) : (
        <div className="home-list">
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className="home-line home-line--btn"
              onClick={() => onOpenItem(task.id)}
            >
              <span className="home-dot" aria-hidden="true" />
              <span className="home-line__main">{task.title}</span>
              <span className="home-line__meta">
                {[task.due, task.priority === "high" ? "高" : task.priority === "low" ? "低" : null]
                  .filter(Boolean)
                  .join(" · ") || "未设日期"}
              </span>
            </button>
          ))}
        </div>
      )}
    </HomeCard>
  );
}

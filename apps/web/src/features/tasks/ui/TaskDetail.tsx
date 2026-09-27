/**
 * 待办详情（`components.md` §七 `taskDetail`；用户原型 `.tdetail`）。
 *
 * 形态（**定稿 2026-09-27 调整·已定**，不要照原型 HTML 里那句旧注释改）：
 * - **绝对定位盖在原界面上**，不推挤列表与看板、也**不铺遮罩**——面板开着时还能点旁边别的任务切过去；
 * - 宽度 390px（≤1080px 时 330px；`DESIGN.md` §2.2 / §2.4），动效 260ms（§6.8）；
 * - 关闭靠 × 或 `Esc`（`DESIGN.md` §6.3 的 Esc 关闭链里就有"侧滑详情"）；
 * - 触发入口：清单行的标题、看板卡片的标题（两处都是真按钮，不是原型里那句"真实实现里应换成真按钮"的临时写法）。
 *
 * **内容只放我们真有的东西**：标题、属性（截止 / 优先级 / 状态）、描述（Memo 正文）、
 * 底部动作。原型的「子清单」与「活动记录」两块**我们模型里没有对应数据**（清单不是独立类型、
 * 是加在 Memo 上的标记；也没有逐条活动流），所以不做，不编数据。
 */
import { useEffect } from "react";
import type { LocalItem } from "../../../data/db";
import { Chip } from "../../../app/ui/Chip";
import { IconButton } from "../../../app/ui/Controls";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, type TaskStatus } from "@menote/mdcore";
import { isOverdue, statusOf, taskAdvance } from "../model";

export interface TaskDetailProps {
  task: LocalItem;
  /** 正文首行（标题） */
  title: string;
  /** 正文（已剥 front matter）；没缓存到就是空串 */
  body: string;
  today: string;
  onClose: () => void;
  onStatusChange: (itemId: string, status: TaskStatus) => void;
  onClearMarker: (itemId: string) => void;
}

export function TaskDetail({
  task,
  title,
  body,
  today,
  onClose,
  onStatusChange,
  onClearMarker,
}: TaskDetailProps) {
  const status = statusOf(task);
  const action = taskAdvance(status);
  const overdue = isOverdue(task, today);

  /**
   * `Esc` 关闭（§6.3）。挂在 `window` 上而不是面板上：面板不抢焦点（定稿要的就是"还能点别的任务"），
   * 所以键盘事件不会稳定落在面板内部。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <aside className="tdetail scroll-thin" aria-label={`${title} 的详情`}>
      <div className="tdetail__hd">
        <h2 className="tdetail__t">详情</h2>
        <span className="tdetail__spacer" />
        <IconButton label="关闭详情" icon="close" size={13} onClick={onClose} />
      </div>

      <div className="tdetail__scroll">
        <div className="tdetail__blk">
          <p className="tdetail__ttl">{title}</p>
          <div className="tdetail__props">
            {task.task_due ? (
              <Chip variant="compact" tone={overdue ? "red" : "neutral"}>
                截止 {task.task_due}
                {overdue ? " · 已逾期" : ""}
              </Chip>
            ) : (
              <Chip variant="compact" tone="neutral">
                未设日期
              </Chip>
            )}
            {task.task_priority ? (
              <Chip
                variant="compact"
                tone={task.task_priority === "high" ? "amber" : "neutral"}
              >
                {TASK_PRIORITY_LABELS[task.task_priority as "high" | "medium" | "low"] ??
                  task.task_priority}
              </Chip>
            ) : null}
            {/* 状态用**文字**胶囊（禁止项 #4：状态不能只靠颜色） */}
            <Chip variant="compact" tone="neutral">
              {TASK_STATUS_LABELS[status]}
            </Chip>
          </div>
        </div>

        <div className="tdetail__blk">
          <h3 className="tdetail__k">描述</h3>
          {body.trim() ? (
            <p className="tdetail__p">{body}</p>
          ) : (
            // 空态也要说清为什么空（§5.4-3），不写一句"暂无"了事
            <p className="tdetail__p">这条还没有正文。它仍是 Memo，可以在 Memo 视图里编辑。</p>
          )}
        </div>
      </div>

      <div className="tdetail__acts">
        {/* 与行 / 卡片上的推进按钮是同一份口径（`taskAdvance`），三处不会点出不同结果 */}
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => onStatusChange(task.id, action.next)}
        >
          {action.label}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          title="删掉 YAML 里的 task 字段，条目仍留在 Memo 时间轴（Q23）"
          onClick={() => onClearMarker(task.id)}
        >
          去掉清单标记
        </button>
      </div>
    </aside>
  );
}

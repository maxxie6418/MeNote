/**
 * 快速录入框（功能拆解 M04-01、M02-01；DESIGN.md §2.5-2 的三行结构不变量）。
 *
 * 三行顺序**不可变**：输入区（min 40 / max 180px，可纵向 resize）→ 模式附加项（固定 26px，
 * 不换行）→ 模式行（左：盒式分段控件；右：发布按钮，同一行）。切模式**只换附加项内容，
 * 不换高度**——`memo` 档是空容器占位，不得用 `display:none` 让容器塌陷（有回归用例守着）。
 *
 * 发布能力按步骤接入：`笔记` 档现在就能用（首行作标题，Q24 的入口二）；`Memo`/`待办` 分别在
 * M2-4/M2-5 落地，在此之前按钮**禁用并说明原因**（DESIGN.md §6.1），不做"点了没反应"的空按钮。
 */
import { splitFirstLineAsTitle } from "@menote/mdcore";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  type TaskPriority,
} from "@menote/mdcore";
import { useState } from "react";
import { Button } from "../ui/Controls";
import { Chip } from "../ui/Chip";
import { SegmentedControl, type SegmentedOption } from "../ui/SegmentedControl";

export const COMPOSER_MODES = [
  { value: "memo", label: "Memo", icon: "clock" },
  { value: "task", label: "待办", icon: "check-square" },
  { value: "note", label: "笔记", icon: "note" },
] as const satisfies ReadonlyArray<SegmentedOption<string>>;

export type ComposerMode = (typeof COMPOSER_MODES)[number]["value"];

/** 各模式「发布」的接入状态（未接入的给出可见原因） */
const PUBLISH_READY: Record<ComposerMode, boolean> = {
  memo: true,
  task: true,
  note: true,
};

const MODE_DISABLED_REASON: Record<ComposerMode, string> = {
  memo: "",
  task: "",
  note: "",
};

/** `- [ ]` 清单项：写了它就在录入框里提示"设为清单？"（需求 §9.3） */
const TASK_ITEM_PATTERN = /^\s*[-*+]\s+\[[ xX]\]/m;

/** 模式附加项：内容随模式变，**容器高度恒定** */
function ModeExtras({
  mode,
  showTaskPrompt,
  asTask,
  onSetTask,
  taskDue,
  onTaskDue,
  taskPriority,
  onTaskPriority,
}: {
  mode: ComposerMode;
  showTaskPrompt: boolean;
  asTask: boolean;
  onSetTask: (value: boolean) => void;
  taskDue: string;
  onTaskDue: (value: string) => void;
  taskPriority: TaskPriority;
  onTaskPriority: (value: TaskPriority) => void;
}) {
  if (mode === "task") {
    // 真实控件：截止用原生 date（可键盘输入、有系统选择器），优先级用盒式分段控件
    return (
      <>
        <label className="composer__field" title="截止日期（可留空）">
          截止
          <input
            type="date"
            className="composer__date"
            aria-label="截止日期"
            value={taskDue}
            onChange={(event) => onTaskDue(event.target.value)}
          />
        </label>
        <SegmentedControl
          ariaLabel="优先级"
          size="compact"
          value={taskPriority}
          onChange={onTaskPriority}
          options={TASK_PRIORITY_OPTIONS}
        />
      </>
    );
  }
  if (mode === "note") {
    return (
      <>
        <Chip variant="compact">首行作标题</Chip>
        <Chip variant="compact" title="M2 只支持根目录，移动条目属 M2-3">
          根目录
        </Chip>
        {/* 按需求 §8.7：输入框没有加密开关，这里刻意不放加密胶囊 */}
      </>
    );
  }
  // memo：写了 `- [ ]` 才提示"设为清单？"（需求 §9.3：由用户确认，不自动改语义）
  if (asTask) {
    return (
      <Chip
        variant="compact"
        tone="primary"
        active
        title="发布后这条 Memo 带清单标记；再点一次取消"
        onClick={() => onSetTask(false)}
      >
        已设为清单
      </Chip>
    );
  }
  if (showTaskPrompt) {
    return (
      <Chip
        variant="compact"
        tone="amber"
        title="正文里有 - [ ] 清单项；点这里让这条 Memo 变成清单"
        onClick={() => onSetTask(true)}
      >
        设为清单？
      </Chip>
    );
  }
  // 没有结构化内容：空容器占位（不得 display:none 塌陷）
  return null;
}

export interface ComposerProps {
  /** 笔记模式发布：首行作标题，其余为正文 */
  onPublishNote?: (title: string, body: string) => void;
  /** Memo 模式发布：`asTask` = 用户确认了"设为清单？" */
  onPublishMemo?: (text: string, options: { asTask: boolean }) => void;
  /** 待办模式发布（M2-5）：新建清单默认状态"待办" */
  onPublishTask?: (text: string, options: { due: string | null; priority: TaskPriority }) => void;
}

const TASK_PRIORITY_OPTIONS: ReadonlyArray<{ value: TaskPriority; label: string }> =
  TASK_PRIORITIES.map((priority) => ({ value: priority, label: TASK_PRIORITY_LABELS[priority] }));

export function Composer({ onPublishNote, onPublishMemo, onPublishTask }: ComposerProps) {
  const [mode, setMode] = useState<ComposerMode>("memo");
  const [text, setText] = useState("");
  const [taskRequested, setTaskRequested] = useState(false);
  const [taskDue, setTaskDue] = useState("");
  // M07-03 的默认优先级为"中"（原型里也是这么显示的）
  const [taskPriority, setTaskPriority] = useState<TaskPriority>("medium");

  const hasTaskItem = TASK_ITEM_PATTERN.test(text);
  // 用户把 `- [ ]` 删掉后，清单标记自动作废（不靠 effect 同步状态）
  const asTask = taskRequested && hasTaskItem;

  const ready = PUBLISH_READY[mode] && text.trim() !== "";
  const disabledReason = !PUBLISH_READY[mode]
    ? MODE_DISABLED_REASON[mode]
    : text.trim() === ""
      ? "先写点内容再发布"
      : undefined;

  function publish(): void {
    if (!ready) return;
    if (mode === "note") {
      const { title, body } = splitFirstLineAsTitle(text);
      onPublishNote?.(title === "" ? "未命名笔记" : title, body);
      setText("");
      return;
    }
    if (mode === "memo") {
      // 乐观发布：界面立刻清空，条目由调用方先落本地再后台上传
      onPublishMemo?.(text, { asTask });
      setText("");
      setTaskRequested(false);
      return;
    }
    if (mode === "task") {
      onPublishTask?.(text, { due: taskDue === "" ? null : taskDue, priority: taskPriority });
      setText("");
      setTaskDue("");
      setTaskPriority("medium");
    }
  }

  return (
    <div className="composer">
      <textarea
        className="composer__input"
        aria-label="快速录入"
        placeholder="记点什么……  Ctrl+Enter 发布"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            publish();
          }
        }}
      />

      <div className="composer__extras" data-testid="composer-extras">
        <ModeExtras
          mode={mode}
          showTaskPrompt={hasTaskItem}
          asTask={asTask}
          onSetTask={setTaskRequested}
          taskDue={taskDue}
          onTaskDue={setTaskDue}
          taskPriority={taskPriority}
          onTaskPriority={setTaskPriority}
        />
      </div>

      <div className="composer__modes">
        <SegmentedControl
          size="compact"
          ariaLabel="录入模式"
          value={mode}
          onChange={setMode}
          options={COMPOSER_MODES.map((item) => ({
            value: item.value,
            label: item.label,
            icon: item.icon,
          }))}
        />
        <Button
          variant="primary"
          size="sm"
          onClick={publish}
          disabled={!ready}
          title={disabledReason ?? "Ctrl+Enter 发布"}
        >
          发布
        </Button>
      </div>
    </div>
  );
}

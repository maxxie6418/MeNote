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
import { useRef, useState } from "react";
import { Button } from "../ui/Controls";
import { Chip } from "../ui/Chip";
import { SegmentedControl, type SegmentedOption } from "../ui/SegmentedControl";
import { QuickComposer } from "./QuickComposer";
import { attributeCommandsFor, type QuickAttributeId } from "./quick-attributes";

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

/**
 * `- [ ]` 清单项：写了它就在录入框里提示"设为清单？"（需求 §9.3）。
 * **导出**给 `AddEntryDialog` 复用——两个录入面（功能栏框 / 添加窗口）必须同一套判定。
 */
export const TASK_ITEM_PATTERN = /^\s*[-*+]\s+\[[ xX]\]/m;

/**
 * `@` 属性命令点了以后聚焦哪儿（**不写正文**，只是把光标送到已经存在的受控字段上）。
 *
 * 用容器内查询而不是往 `ModeExtras` 里穿 ref：那个组件被两个录入面复用（字段只有一份实现），
 * 为一次聚焦改它的公共契约不划算；选择器就是两个控件自己的可访问名。**导出**给
 * `AddEntryDialog` 复用——同一个 `@` 在两个录入面必须落到同一个字段。
 */
export const ATTRIBUTE_FOCUS_SELECTOR: Record<QuickAttributeId, string> = {
  due: '[aria-label="截止日期"]',
  // 优先级是分段控件：聚焦当前生效的那一档才有意义（整组没有"选中"这个概念）
  priority: '[aria-label="优先级"] button[aria-pressed="true"]',
};

/**
 * 模式附加项：内容随模式变，**容器高度恒定**（功能栏里那条 26px 不变量）。
 *
 * **导出**给 `AddEntryDialog` 复用（用户 2026-09-29：一个窗口结构、只换显示的设置）——
 * 待办的「截止 + 优先级」、Memo 的「设为清单？」都只有这一份实现。
 * `noteTargetLabel` 对非笔记档无意义，故可选（窗口只渲染 memo / task）。
 */
export function ModeExtras({
  mode,
  showTaskPrompt,
  asTask,
  onSetTask,
  taskDue,
  onTaskDue,
  taskPriority,
  onTaskPriority,
  noteTargetLabel = "根目录",
}: {
  mode: ComposerMode;
  showTaskPrompt: boolean;
  asTask: boolean;
  onSetTask: (value: boolean) => void;
  taskDue: string;
  onTaskDue: (value: string) => void;
  taskPriority: TaskPriority;
  onTaskPriority: (value: TaskPriority) => void;
  /** 「笔记」档新建会落到哪里（当前选中的笔记本名；没有笔记本上下文时是「根目录」） */
  noteTargetLabel?: string;
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
        {/*
          落点提示：**当前选中的笔记本**（2026-09-28 起新建跟随当前笔记本；
          最近编辑 / 收藏 / 标签这些视图没有笔记本上下文，才落根目录）。
        */}
        <Chip variant="compact" title={`新建的笔记会落在这里：${noteTargetLabel}`}>
          {noteTargetLabel}
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
  /**
   * 受控模式（M2-8）：首页的「记录 Memo / 新建待办」需要从外部把录入框切到指定档。
   * 不传则自己管（非受控），两种用法都支持。
   */
  mode?: ComposerMode;
  onModeChange?: (mode: ComposerMode) => void;
  /**
   * 「笔记」档的落点提示（当前笔记本名；不传 = 「根目录」）。
   * 落点本身由 `createNote` 按当前视图决定，这里只做展示，不参与写入。
   */
  noteTargetLabel?: string;
}

const TASK_PRIORITY_OPTIONS: ReadonlyArray<{ value: TaskPriority; label: string }> =
  TASK_PRIORITIES.map((priority) => ({ value: priority, label: TASK_PRIORITY_LABELS[priority] }));

export function Composer({
  onPublishNote,
  onPublishMemo,
  onPublishTask,
  mode: controlledMode,
  onModeChange,
  noteTargetLabel = "根目录",
}: ComposerProps) {
  const [innerMode, setInnerMode] = useState<ComposerMode>("memo");
  // 受控/非受控都支持：外部给了 mode 就用外部的，否则自己管（既有用法不受影响）
  const mode = controlledMode ?? innerMode;
  const setMode = (next: ComposerMode): void => {
    setInnerMode(next);
    onModeChange?.(next);
  };
  const [text, setText] = useState("");
  const [taskRequested, setTaskRequested] = useState(false);
  const [taskDue, setTaskDue] = useState("");
  // M07-03 的默认优先级为"中"（原型里也是这么显示的）
  const [taskPriority, setTaskPriority] = useState<TaskPriority>("medium");
  /** 附加项容器：`@` 选了属性后在这里找对应的受控字段聚焦 */
  const fieldsRef = useRef<HTMLDivElement | null>(null);

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

  /** `@` 选了属性：把焦点送到既有的受控字段。**属性不写进正文**（设计 v3 §3.3）。 */
  function focusAttribute(id: QuickAttributeId): void {
    fieldsRef.current
      ?.querySelector<HTMLElement>(ATTRIBUTE_FOCUS_SELECTOR[id])
      ?.focus();
  }

  return (
    <div className="composer">
      {/*
        输入区换成语义可靠的轻量即时渲染宿主（编辑拓展阶段 B / Task B6）：
        行内格式走共享纯函数，`/` 给快捷基础命令，`@` 只聚焦下面的受控字段。
        class 仍是 `.composer__input`——三行 136px 的结构不变量就按它守。
      */}
      <QuickComposer
        mode={mode}
        value={text}
        onChange={setText}
        attributes={attributeCommandsFor(mode)}
        onChooseAttribute={focusAttribute}
        onSubmitShortcut={publish}
        ariaLabel="快速录入"
        placeholder="记点什么……  Ctrl+Enter 发布"
        keepEditingWithin={fieldsRef}
      />

      <div className="composer__extras" data-testid="composer-extras" ref={fieldsRef}>
        <ModeExtras
          mode={mode}
          showTaskPrompt={hasTaskItem}
          asTask={asTask}
          onSetTask={setTaskRequested}
          taskDue={taskDue}
          onTaskDue={setTaskDue}
          taskPriority={taskPriority}
          onTaskPriority={setTaskPriority}
          noteTargetLabel={noteTargetLabel}
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

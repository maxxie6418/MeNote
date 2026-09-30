/**
 * 快速录入框（功能拆解 M04-01、M02-01；DESIGN.md §2.5-2 的两行结构不变量）。
 *
 * 两行顺序**不可变**：输入区（min 40 / max 180px，可纵向 resize）→ 模式行
 * （左：盒式分段控件；右：发布按钮，同一行）。
 *
 * 【2026-10-01 用户反馈问题 1】**功能栏这个录入框不再带"模式附加项"那一行**：原设计在输入区与
 * 模式行之间固定留 26px 放可编辑属性（待办：截止 + 优先级；Memo：「设为清单？」；笔记：
 * 「首行作标题」+ 落点），结果"没编辑时看着是一大块输入区，真开始打字可写的地方只有 40px"。
 * 属性输入现在只留在**添加内容窗口**（`AddEntryDialog`，Memo / 待办视图的「添加」），
 * `@` 属性菜单也随这一行一起退出功能栏录入框（`attributes` 传空表 → 不弹菜单，见 `QuickComposer`），
 * 后期由 `@` 统一接管属性设置（用户口径）。
 *
 * 因此这里的发布用默认值：**待办 = 无截止 + 优先级「中」**、**Memo = 不标清单**——要设属性去
 * 添加内容窗口。`ModeExtras` / `TASK_ITEM_PATTERN` / `ATTRIBUTE_FOCUS_SELECTOR` 仍从本文件导出，
 * 由窗口复用（同一份字段判定，不抄第二套）。
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
import { QuickComposer } from "./QuickComposer";
import type { QuickAttributeCommand, QuickAttributeId } from "./quick-attributes";

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
 * 属性命令点了以后聚焦哪儿（**不写正文**，只是把光标送到已经存在的受控字段上）。
 *
 * 2026-10-01 起只有「添加内容窗口」需要它——功能栏录入框的属性行按用户反馈移除，
 * `@` 菜单随之不在那里出现（`attributes` 传空表）。
 * 用容器内查询而不是往 `ModeExtras` 里穿 ref：那个组件被录入面复用（字段只有一份实现），
 * 为一次聚焦改它的公共契约不划算；选择器就是两个控件自己的可访问名。
 */
export const ATTRIBUTE_FOCUS_SELECTOR: Record<QuickAttributeId, string> = {
  due: '[aria-label="截止日期"]',
  // 优先级是分段控件：聚焦当前生效的那一档才有意义（整组没有"选中"这个概念）
  priority: '[aria-label="优先级"] button[aria-pressed="true"]',
};

/**
 * 功能栏录入框的**空属性表**：模块级冻结常量，不能写成字面量 `[]`——
 * `QuickComposer` 把它放进 `useMemo` 依赖，每次渲染新建数组会让菜单过滤每帧重算。
 */
const NO_ATTRIBUTES: readonly QuickAttributeCommand[] = Object.freeze([]);

/**
 * 模式附加项：内容随模式变，**容器高度恒定**（`AddEntryDialog` 里那条 26px 不变量）。
 *
 * **导出**给 `AddEntryDialog` 复用（用户 2026-09-29：一个窗口结构、只换显示的设置）——
 * 待办的「截止 + 优先级」、Memo 的「设为清单？」都只有这一份实现。
 * `noteTargetLabel` 对非笔记档无意义，故可选（窗口只渲染 memo / task；笔记档的行
 * 2026-10-01 起不再出现在功能栏录入框，那一档保留给"以后接笔记属性"）。
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
  /**
   * Memo 模式发布。`asTask` 恒为 `false`——「设为清单？」那个 chip 随附加项行一起退出功能栏
   * （2026-10-01）；要标清单去「添加内容窗口」（那里还有同一个 chip）。
   */
  onPublishMemo?: (text: string, options: { asTask: boolean }) => void;
  /**
   * 待办模式发布（M2-5）：无截止 + 优先级「中」——属性字段随附加项行退出功能栏（2026-10-01）。
   */
  onPublishTask?: (text: string, options: { due: string | null; priority: TaskPriority }) => void;
  /**
   * 受控模式（M2-8）：首页的「记录 Memo / 新建待办」需要从外部把录入框切到指定档。
   * 不传则自己管（非受控），两种用法都支持。
   */
  mode?: ComposerMode;
  onModeChange?: (mode: ComposerMode) => void;
}

const TASK_PRIORITY_OPTIONS: ReadonlyArray<{ value: TaskPriority; label: string }> =
  TASK_PRIORITIES.map((priority) => ({ value: priority, label: TASK_PRIORITY_LABELS[priority] }));

/** 待办档没有字段可填时的发布值：无截止、优先级「中」（M07-03 的默认档） */
const DEFAULT_TASK_ATTRIBUTES = { due: null, priority: "medium" } as const;

export function Composer({
  onPublishNote,
  onPublishMemo,
  onPublishTask,
  mode: controlledMode,
  onModeChange,
}: ComposerProps) {
  const [innerMode, setInnerMode] = useState<ComposerMode>("memo");
  // 受控/非受控都支持：外部给了 mode 就用外部的，否则自己管（既有用法不受影响）
  const mode = controlledMode ?? innerMode;
  const setMode = (next: ComposerMode): void => {
    setInnerMode(next);
    onModeChange?.(next);
  };
  const [text, setText] = useState("");

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
      onPublishMemo?.(text, { asTask: false });
      setText("");
      return;
    }
    if (mode === "task") {
      onPublishTask?.(text, { ...DEFAULT_TASK_ATTRIBUTES });
      setText("");
    }
  }

  return (
    <div className="composer">
      {/*
        输入区换成语义可靠的轻量即时渲染宿主（编辑拓展阶段 B / Task B6）：
        行内格式走共享纯函数，`/` 给快捷基础命令。`@` 属性菜单**不在这个录入面出现**
        （2026-10-01：属性行退出功能栏，`attributes` 传空表，`QuickComposer` 因此不弹菜单）。
        class 仍是 `.composer__input`——两行结构不变量就按它守。
      */}
      <QuickComposer
        mode={mode}
        value={text}
        onChange={setText}
        attributes={NO_ATTRIBUTES}
        onSubmitShortcut={publish}
        ariaLabel="快速录入"
        placeholder="记点什么……  Ctrl+Enter 发布"
      />

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

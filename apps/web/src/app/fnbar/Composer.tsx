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
  memo: false,
  task: false,
  note: true,
};

const MODE_DISABLED_REASON: Record<ComposerMode, string> = {
  memo: "Memo 发布将在 M2-4 提供",
  task: "待办发布将在 M2-5 提供",
  note: "",
};

/** 模式附加项：内容随模式变，**容器高度恒定** */
function ModeExtras({ mode }: { mode: ComposerMode }) {
  if (mode === "task") {
    return (
      <>
        <Chip variant="compact" tone="amber" title="截止日期选择将在 M2-5 提供">
          截止 未设置
        </Chip>
        <Chip variant="compact" title="优先级选择将在 M2-5 提供">
          优先级 中
        </Chip>
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
  // memo：空容器占位（不得 display:none 塌陷）
  return null;
}

export interface ComposerProps {
  /** 笔记模式发布：首行作标题，其余为正文 */
  onPublishNote?: (title: string, body: string) => void;
}

export function Composer({ onPublishNote }: ComposerProps) {
  const [mode, setMode] = useState<ComposerMode>("memo");
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
        <ModeExtras mode={mode} />
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

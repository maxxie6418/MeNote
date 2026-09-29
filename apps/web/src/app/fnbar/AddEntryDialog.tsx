/**
 * 添加内容窗口（通用，非笔记类）——`docs/modules/Menote-添加内容窗口-设计-v1.md`。
 *
 * 背景：Memo 视图与待办视图页头的「添加」此前是**把焦点送回左侧功能栏的录入框并切档**
 * （M07-01 入口二）。用户 2026-09-29 反馈这个跳转让人看不清"点的添加去哪了"，要求
 * **单独弹窗添加、给明确反馈**——本组件就是那个窗口。
 *
 * 一个结构、两种 kind（用户 2026-09-29："不同类型复用一个窗口结构但是显示的设置不同"）：
 * - `kind = "memo"`：正文含 `- [ ]` 时给「设为清单？」chip（与录入框「Memo」档一致）；
 * - `kind = "task"`：截止 + 优先级（与录入框「待办」档一致）。
 *
 * 字段直接复用 `Composer` 导出的 `ModeExtras` / `TASK_ITEM_PATTERN`——**同一份判定，不复制第二套**。
 * 笔记（`note`）**不进本窗口**：新建笔记仍走功能栏「新建笔记」/录入框「笔记」档。
 *
 * 反馈链（"明确反馈"的落点）：点发布 → 调 `onPublishMemo/onPublishTask`（`publishMemo` 会
 * `await refresh()`）→ 关窗 → 既有 toast → 新条目**立刻出现在当前列表**。不再有"点了没反应"。
 *
 * 焦点：`Modal` 的自动聚焦只找 `input/button/[tabindex]`，够不到 `<textarea>`——这里在
 * **打开时**（子组件 `Modal` 的 effect 先跑、本 effect 后跑）把焦点拉回输入区，可直接打字。
 */
import { useEffect, useRef, useState } from "react";
import type { TaskPriority } from "@menote/mdcore";
import { Button } from "../ui/Controls";
import { Modal } from "../ui/Modal";
import { ModeExtras, TASK_ITEM_PATTERN } from "./Composer";

export type AddEntryKind = "memo" | "task";

const TITLE: Record<AddEntryKind, string> = {
  memo: "添加 Memo",
  task: "添加待办",
};

export interface AddEntryDialogProps {
  open: boolean;
  kind: AddEntryKind;
  onClose: () => void;
  /** 发布 Memo（`asTask` = 用户点了「设为清单？」），语义同 `Composer.onPublishMemo` */
  onPublishMemo: (text: string, options: { asTask: boolean }) => void;
  /** 发布待办（截止可空、优先级默认「中」），语义同 `Composer.onPublishTask` */
  onPublishTask: (text: string, options: { due: string | null; priority: TaskPriority }) => void;
}

export function AddEntryDialog({
  open,
  kind,
  onClose,
  onPublishMemo,
  onPublishTask,
}: AddEntryDialogProps) {
  const [text, setText] = useState("");
  const [taskRequested, setTaskRequested] = useState(false);
  const [taskDue, setTaskDue] = useState("");
  const [taskPriority, setTaskPriority] = useState<TaskPriority>("medium");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const hasTaskItem = TASK_ITEM_PATTERN.test(text);
  const asTask = taskRequested && hasTaskItem;
  const ready = text.trim() !== "";

  /**
   * 打开时把焦点送进输入区（`Modal` 的自动聚焦只找 `input/button/[tabindex]`，够不到 `<textarea>`；
   * 子组件 effect 先跑、本 effect 后跑，最后落点就是这里）。
   * **只做焦点、不在 effect 里 setState**（`react-hooks/set-state-in-effect`：effect 里改状态会触发级联渲染）。
   */
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, kind]);

  /**
   * 关窗的统一出口：**先清空、再交回调用方**。清空放在事件处理器里（不是 effect），
   * 既避开上面那条规则，也保证下次打开是干净输入区——模态遮罩挡着，必须关了才能再点「添加」。
   */
  function close(): void {
    setText("");
    setTaskRequested(false);
    setTaskDue("");
    setTaskPriority("medium");
    onClose();
  }

  function publish(): void {
    if (!ready) return;
    if (kind === "memo") onPublishMemo(text, { asTask });
    else onPublishTask(text, { due: taskDue === "" ? null : taskDue, priority: taskPriority });
    close();
  }

  return (
    <Modal
      open={open}
      title={TITLE[kind]}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={publish}
            disabled={!ready}
            title={ready ? "Ctrl+Enter 发布" : "先写点内容再发布"}
          >
            发布
          </Button>
        </>
      }
    >
      <textarea
        ref={inputRef}
        className="addentry__input"
        aria-label={`${TITLE[kind]}的内容`}
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
      {/* 字段行：与录入框同族（随 kind 换内容）；容器不塌陷，避免发布时高度跳动 */}
      <div className="addentry__extras">
        <ModeExtras
          mode={kind}
          showTaskPrompt={hasTaskItem}
          asTask={asTask}
          onSetTask={setTaskRequested}
          taskDue={taskDue}
          onTaskDue={setTaskDue}
          taskPriority={taskPriority}
          onTaskPriority={setTaskPriority}
        />
      </div>
    </Modal>
  );
}

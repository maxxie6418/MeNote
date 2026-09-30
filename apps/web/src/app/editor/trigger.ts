/**
 * 命令触发词的**唯一判定处**（编辑拓展阶段 B；正文编辑器 `/`、快捷输入 `/` 与 `@` 共用）。
 *
 * 两个宿主（CodeMirror 正文、受控 `textarea` 快捷输入）从同一份规则里取结果，否则同一个
 * `/加粗` 在正文里出菜单、在录入框里不出，用户只会觉得"时好时坏"。
 *
 * 规则（写死，改这里就两边一起改）：
 * 1. 触发词必须出现在**行首或空白之后**——`12/34`、`正文/` 里的斜杠是内容，不是命令；
 * 2. 触发词到光标之间**不能有空白**——`/加 粗` 已经不是在输入命令了；
 * 3. **代码围栏内不触发**：代码块里的 `/` 与 `@` 是代码；
 * 4. 只看光标之前，取**最近**的一个触发词（前面还有别的 `/` 也无所谓）。
 */
import {
  applyFormatCommand,
  type FormatCommandId,
  type FormatResult,
  type TextSelection,
} from "./format-commands";

export type TriggerKind = "/" | "@";

export interface TriggerMatch {
  kind: TriggerKind;
  /** 触发词与光标之间已经输入的内容（刚打完触发词时是空串） */
  query: string;
  /** 触发词在文本里的下标（宿主删触发段时要用） */
  start: number;
  /** 光标：查询词的结束位置 */
  caret: number;
}

/** 代码围栏内不触发：`/` 与 `@` 在代码块里是正文内容。 */
export function insideCodeFence(text: string, caret: number): boolean {
  let fences = 0;
  for (const line of text.slice(0, caret).split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fences += 1;
  }
  return fences % 2 === 1;
}

/** 光标处是否正在输入命令；不在触发位置时返回 `null`。 */
export function triggerAt(
  text: string,
  caret: number,
  kinds: readonly TriggerKind[] = ["/", "@"],
): TriggerMatch | null {
  if (caret <= 0 || caret > text.length) return null;
  if (insideCodeFence(text, caret)) return null;

  const before = text.slice(0, caret);
  let index = -1;
  let kind: TriggerKind | null = null;
  for (const candidate of kinds) {
    const found = before.lastIndexOf(candidate);
    if (found > index) {
      index = found;
      kind = candidate;
    }
  }
  if (kind === null) return null;
  if (index > 0 && !/\s/.test(before[index - 1] ?? "")) return null;

  const query = before.slice(index + 1);
  if (/\s/.test(query)) return null;
  return { kind, query, start: index, caret };
}

/**
 * 执行一条格式命令，**并先吃掉光标前的触发段**（`/加粗`、`@`）。
 *
 * 触发词是"给命令用的"，不是用户要写的内容——留着就会出现 `/加粗****`，或者正文里多一个 `@`。
 * 三个宿主（CodeMirror 正文、快捷输入、试验页三个框）都从这里走，规则不会各写一套：
 * 有选区时按普通命令处理（选中的文字不该被当成触发词）。
 */
export function applyFormatAt(
  text: string,
  selection: TextSelection,
  command: FormatCommandId,
  kinds: readonly TriggerKind[] = ["/"],
): FormatResult {
  if (selection.from !== selection.to) return applyFormatCommand(text, selection, command);
  const caret = selection.from;
  const trigger = triggerAt(text, caret, kinds);
  if (!trigger) return applyFormatCommand(text, selection, command);
  return applyFormatCommand(
    text.slice(0, trigger.start) + text.slice(caret),
    { from: trigger.start, to: trigger.start },
    command,
  );
}

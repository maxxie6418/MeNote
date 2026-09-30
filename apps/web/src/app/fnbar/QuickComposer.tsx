/**
 * 快捷输入的**轻量即时渲染宿主**（编辑拓展阶段 B / Task B5；产品口径见设计 v3 第 51 行）。
 *
 * 模型是「**编辑时可靠 textarea、完成后按 Markdown 呈现**」：
 * - 聚焦时就是一个原生 `<textarea>`——中文输入法、原生撤销、列表连续回车都可靠；
 * - 失焦且内容非空时，用 `React.lazy` 动态导入的 `MarkdownPreview` **只读**呈现；点击呈现区回到编辑；
 * - `/` 与 `@` 只在**行首或空白后**触发，且代码围栏内、输入法组合中不触发；
 * - 不把呈现区设成 `contenteditable`、不解析改写用户内容。
 *
 * 它不冒充正文那种逐字符块级富文本，也不访问 Dexie / API：文本与属性的落库都在宿主
 * （`Composer` / `AddEntryDialog`）的受控字段与发布回调里。
 *
 * 类名约定（说死，见实施计划 Task B5 Step 4）：输入态保留 `.composer__input`
 * （`layout-invariants.test.ts` 按它守 40–180px 与 `resize: vertical`、`focus-visibility.test.ts`
 * 把它列进 outline 白名单），呈现态用 `.quick-composer__view`，外层 `.quick-composer`。
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { CommandMenu } from "../editor/CommandMenu";
import {
  QUICK_FORMAT_COMMANDS,
  applyFormatCommand,
  type FormatCommandId,
  type TextSelection,
} from "../editor/format-commands";
import {
  type QuickAttributeCommand,
  type QuickAttributeHost,
  type QuickAttributeId,
} from "./quick-attributes";

const MarkdownPreview = lazy(async () => {
  const mod = await import("../editor/MarkdownPreview");
  return { default: mod.MarkdownPreview };
});

export interface QuickComposerProps {
  mode: QuickAttributeHost;
  value: string;
  onChange: (value: string) => void;
  /** 属性命令（只读；组件不改也不排序，过滤规则在 `quick-attributes.ts`） */
  attributes: readonly QuickAttributeCommand[];
  onChooseAttribute?: (id: QuickAttributeId) => void;
  /** `Ctrl/Cmd + Enter` 的发布快捷键（与正文快捷键一致） */
  onSubmitShortcut?: () => void;
  ariaLabel: string;
  /** 输入态的占位文字（不传就不显示） */
  placeholder?: string;
  /**
   * 输入态用的类名。默认 `.composer__input`（功能栏录入框：40–180px、`resize: vertical` 由
   * `layout-invariants.test.ts` 守着）；添加内容窗口沿用自己那套 `.addentry__input`（更高、自带焦点环）。
   * 注意 `.composer__input` 抹掉了 outline，**宿主必须自己给焦点环**（`.composer:focus-within` /
   * `.addentry__input:focus` 都已提供）。
   */
  inputClassName?: string;
  /** 让宿主能主动把焦点送回输入区（添加内容窗口打开时用） */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /**
   * 这个容器里的元素拿到焦点时**不收起输入态**（一般是录入框自己的字段行）。
   *
   * 没有它的话，"待办"档 `@` 选完截止日期 → 焦点移到日期控件 → 输入区立刻塌成只读呈现，
   * 用户想接着补两个字还得先点回来。同一录入面内部换焦点不算"写完了"。
   */
  keepEditingWithin?: RefObject<HTMLElement | null>;
}

interface Trigger {
  kind: "/" | "@";
  query: string;
  /** 触发词（`/` 或 `@`）在文本里的下标 */
  start: number;
  /** 光标：查询词的结束位置，也是"该被吃掉的触发段"的右端 */
  caret: number;
}

/** 代码围栏内不触发：`/` 与 `@` 在代码块里是正文内容，不是命令。 */
function insideCodeFence(text: string, caret: number): boolean {
  let fences = 0;
  for (const line of text.slice(0, caret).split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fences += 1;
  }
  return fences % 2 === 1;
}

/**
 * 光标处是否正在输入命令：`/` 或 `@` 出现在**行首或空白后**，且到光标之间没有空白。
 * 返回触发词与已经输入的内容（`/加` 的 query 是「加」）。
 */
export function triggerAt(text: string, caret: number): Trigger | null {
  if (caret <= 0 || caret > text.length) return null;
  if (insideCodeFence(text, caret)) return null;
  const before = text.slice(0, caret);
  const index = Math.max(before.lastIndexOf("/"), before.lastIndexOf("@"));
  if (index === -1) return null;
  const char = before[index];
  if (char !== "/" && char !== "@") return null;
  if (index > 0 && !/\s/.test(before[index - 1] ?? "")) return null;
  const query = before.slice(index + 1);
  if (/\s/.test(query)) return null;
  return { kind: char, query, start: index, caret };
}

export function QuickComposer({
  mode,
  value,
  onChange,
  attributes,
  onChooseAttribute,
  onSubmitShortcut,
  ariaLabel,
  placeholder,
  inputClassName = "composer__input",
  inputRef: externalInputRef,
  keepEditingWithin,
}: QuickComposerProps) {
  /*
    `editing` 从 true 起步：**打开就是输入态**（用户要能立刻打字），只有在"失焦且内容非空"之后
    才切成呈现态。内容被发布清空后自动回到输入态。
  */
  const [editing, setEditing] = useState(true);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [attributeIndex, setAttributeIndex] = useState(0);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** 内部要读选区、外部（添加内容窗口）要能聚焦：两边都收到同一个节点 */
  const attachInput = (node: HTMLTextAreaElement | null): void => {
    inputRef.current = node;
    if (externalInputRef) externalInputRef.current = node;
  };
  const composingRef = useRef(false);
  /** 从呈现态点回来时要补一次聚焦（此刻 textarea 还没挂载，focus() 会落空） */
  const wantFocus = useRef(false);
  /** 命令执行后要恢复的选区（受控组件：值更新后才能在 DOM 上设回去） */
  const pendingSelection = useRef<TextSelection | null>(null);
  const selectionRef = useRef<TextSelection>({ from: value.length, to: value.length });

  /*
    呈现态是**派生**的，不是又一个状态机：`editing=false` 且内容非空才呈现。
    内容被发布清空后 `showView` 自然变回 false → 直接回到输入态，不需要再用 effect 去改状态
    （在 effect 里同步 setState 会多一轮渲染，eslint 也确实会拦）。
  */
  const showView = !editing && value.trim() !== "";

  useEffect(() => {
    if (editing && wantFocus.current) {
      wantFocus.current = false;
      inputRef.current?.focus();
    }
  }, [editing]);

  // 命令改了文本 + 选区：等父组件把新值传回来再设选区（早设会被这一次渲染覆盖）
  useEffect(() => {
    const pending = pendingSelection.current;
    if (!pending) return;
    pendingSelection.current = null;
    inputRef.current?.setSelectionRange(pending.from, pending.to);
  }, [value]);

  const filteredAttributes = useMemo(() => {
    if (trigger?.kind !== "@") return [];
    const query = trigger.query.trim().toLowerCase();
    return attributes.filter((item) => item.label.includes(query) || item.id.includes(query));
  }, [attributes, trigger]);

  const activeAttribute =
    filteredAttributes.length === 0 ? -1 : Math.min(attributeIndex, filteredAttributes.length - 1);

  /** 记下选区并重算命令触发（输入、移动光标、点击都要算）。 */
  function syncTrigger(nextValue: string, node: HTMLTextAreaElement | null): void {
    const caret = node?.selectionStart ?? nextValue.length;
    selectionRef.current = { from: caret, to: node?.selectionEnd ?? caret };
    if (composingRef.current) return;
    const next = triggerAt(nextValue, caret);
    // 这个宿主没有可写的属性命令时，`@` 不进菜单（不然会留一个"按键没反应"的状态）
    setTrigger(next?.kind === "@" && attributes.length === 0 ? null : next);
    setAttributeIndex(0);
  }

  /**
   * 吃掉触发段（`/加`、`@`）后返回文本与光标位置。
   *
   * **必须吃掉**：触发词是"给命令用的"，不是用户想写进 Memo 的内容——留着就会出现
   * `/加****` 或正文里一条 `@`。只有当前文本仍与触发时一致（用户没在中途改过）才吃，
   * 否则退回"在光标处执行"。
   */
  function stripTrigger(): { text: string; caret: number } {
    const selection = selectionRef.current;
    if (!trigger) return { text: value, caret: selection.to };
    const token = `${trigger.kind}${trigger.query}`;
    if (value.slice(trigger.start, trigger.caret) !== token || selection.to < trigger.caret) {
      return { text: value, caret: selection.to };
    }
    return {
      text: value.slice(0, trigger.start) + value.slice(trigger.caret),
      caret: trigger.start,
    };
  }

  function applyCommand(id: FormatCommandId): void {
    const base = stripTrigger();
    const result = applyFormatCommand(base.text, { from: base.caret, to: base.caret }, id);
    pendingSelection.current = result.selection;
    setTrigger(null);
    onChange(result.text);
  }

  function chooseAttribute(id: QuickAttributeId): void {
    // 属性**不写进正文**：吃掉 `@…` 触发段，只把选择交回宿主（宿主去聚焦既有的受控字段）
    const base = stripTrigger();
    if (base.text !== value) onChange(base.text);
    setTrigger(null);
    onChooseAttribute?.(id);
  }

  function backToEditing(): void {
    wantFocus.current = true;
    setEditing(true);
  }

  if (showView) {
    return (
      <div className="quick-composer" data-quick-mode={mode}>
        <div
          className="quick-composer__view"
          role="button"
          tabIndex={0}
          aria-label={`${ariaLabel}（点击继续编辑）`}
          onClick={(event) => {
            // 呈现内容里的链接自己处理点击，不要顺手把整块切回编辑态
            if ((event.target as HTMLElement).closest("a, button")) return;
            backToEditing();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              backToEditing();
            }
          }}
        >
          <Suspense fallback={<p>{value}</p>}>
            <MarkdownPreview source={value} />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="quick-composer" data-quick-mode={mode}>
      {trigger?.kind === "/" ? (
        <CommandMenu
          open
          query={trigger.query}
          commands={QUICK_FORMAT_COMMANDS}
          onChoose={applyCommand}
          onClose={() => setTrigger(null)}
        />
      ) : null}

      {trigger?.kind === "@" ? (
        <div className="menu cmd-menu" role="listbox" aria-label="属性">
          {filteredAttributes.length === 0 ? (
            <div className="cmd-menu__empty">没有匹配的属性</div>
          ) : (
            filteredAttributes.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={index === activeAttribute}
                tabIndex={-1}
                className={`menu__item cmd-menu__item${index === activeAttribute ? " is-active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setAttributeIndex(index)}
                onClick={() => chooseAttribute(item.id)}
              >
                {item.label}
              </button>
            ))
          )}
        </div>
      ) : null}

      <textarea
        ref={attachInput}
        className={inputClassName}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          syncTrigger(event.target.value, event.target);
        }}
        onSelect={(event) => syncTrigger(value, event.currentTarget)}
        onClick={(event) => syncTrigger(value, event.currentTarget)}
        onFocus={() => setEditing(true)}
        onBlur={(event) => {
          composingRef.current = false;
          setTrigger(null);
          /*
            同一录入面内部换焦点（输入区 → 截止/优先级字段）不算"写完了"：
            `relatedTarget` 在部分环境下为空，所以退一步看 `document.activeElement`（blur 时焦点已经移走）。
          */
          const next = (event.relatedTarget as Node | null) ?? document.activeElement;
          if (next && keepEditingWithin?.current?.contains(next)) return;
          setEditing(false);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          syncTrigger(event.currentTarget.value, event.currentTarget);
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmitShortcut?.();
            return;
          }
          // 输入法组合期间一切交给输入法（中文输入 `/`、`@` 常常是组合的一部分）
          if (event.nativeEvent.isComposing || composingRef.current) return;
          // `/` 菜单的键盘由 CommandMenu 自己接管（它在打开期间监听 document）
          if (trigger?.kind === "/") return;
          if (trigger?.kind !== "@") return;

          if (event.key === "Escape") {
            event.preventDefault();
            setTrigger(null);
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (filteredAttributes.length === 0) return;
            const delta = event.key === "ArrowDown" ? 1 : -1;
            setAttributeIndex((current) => {
              const from = Math.min(current, filteredAttributes.length - 1);
              return (from + delta + filteredAttributes.length) % filteredAttributes.length;
            });
            return;
          }
          if (event.key === "Enter") {
            const chosen = filteredAttributes[activeAttribute];
            if (chosen === undefined) return;
            event.preventDefault();
            chooseAttribute(chosen.id);
          }
        }}
      />
    </div>
  );
}

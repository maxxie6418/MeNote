/**
 * 快捷输入的**块级即时渲染宿主**（编辑拓展：块级即时渲染，v0.6.3）。
 *
 * 模型是「**当前块保持源码、其余块即时呈现**」：
 * - 内容按 `splitQuickBlocks()` 切成 Markdown 块；**光标所在的那一块**是原生 `<textarea>`
 *   （中文输入法、原生撤销、列表连续回车都可靠），其余块用 `React.lazy` 动态导入的
 *   `MarkdownPreview` 只读呈现，点一下某块就回到那一块继续编辑；
 * - **回车就呈现上一行**：Enter 插 `\n` 后若切出新块，当前块自动落到新块，原来那一块当场呈现；
 * - **`/` 命令应用后当场可见**：命令只在**当前块的局部文本**上执行，格式立即落到该块上，
 *   不需要失焦；
 * - 整段失焦（且内容非空）时**整块呈现**——这是兜底，点击呈现区回到编辑；
 * - `/` 与 `@` 只在**行首或空白后**触发，代码围栏内与输入法组合中不触发；
 * - 不把呈现区设成 `contenteditable`、不解析改写用户内容（切块只影响"哪一段先呈现"，
 *   `blocks.join("\n")` 与原文字节相等，见 `quick-blocks.ts` 的安全网用例）。
 *
 * 它不冒充正文那种逐字符块级富文本，也不访问 Dexie / API：文本与属性的落库都在宿主
 * （`Composer` / `AddEntryDialog`）的受控字段与发布回调里。
 *
 * 已知取舍（写在代码里，不装作没有）：
 * - **跨块撤销变弱**：原生 `Ctrl+Z` 只作用于当前块的 textarea；"撤销上一块刚提交的改动"不保证。
 * - 从呈现态点回编辑时，落点取该块末尾（不按鼠标坐标定位）。
 *
 * 类名约定（说死，见实施计划 Task Q2）：输入态保留 `.composer__input`
 * （`layout-invariants.test.ts` 按它守 40–180px 与 `resize: vertical`、`focus-visibility.test.ts`
 * 把它列进 outline 白名单），呈现态用 `.quick-composer__view`（整块）与 `.quick-composer__block`
 * （单块），块列表容器 `.quick-composer__blocks`，外层 `.quick-composer`。
 */
import {
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { CommandMenu } from "../editor/CommandMenu";
import {
  QUICK_FORMAT_COMMANDS,
  type FormatCommandId,
  type TextSelection,
} from "../editor/format-commands";
import {
  columnOfOffset,
  lineOfOffset,
  offsetOfLine,
  splitQuickBlocks,
  type QuickBlock,
} from "./quick-blocks";
import {
  type QuickAttributeCommand,
  type QuickAttributeHost,
  type QuickAttributeId,
} from "./quick-attributes";
import { applyFormatAt, triggerAt as matchTrigger } from "../editor/trigger";

const MarkdownPreview = lazy(async () => {
  const mod = await import("../editor/MarkdownPreview");
  return { default: mod.MarkdownPreview };
});

/** 空输入框也要有一个"当前块"可编辑 */
const EMPTY_BLOCK: QuickBlock = { from: 0, to: 0, text: "" };

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
  /** 触发词（`/` 或 `@`）在**当前块文本**里的下标 */
  start: number;
  /** 光标：查询词的结束位置，也是"该被吃掉的触发段"的右端 */
  caret: number;
}

/**
 * 光标处是否正在输入命令。
 *
 * 判定规则不在这里：和正文编辑器共用 `editor/trigger.ts`（行首或空白后、触发词到光标之间无空白、
 * 代码围栏内不算）。**导出**是为了能单独测这条边界。
 */
export function triggerAt(text: string, caret: number): Trigger | null {
  return matchTrigger(text, caret, ["/", "@"]);
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
    才切成整块呈现态。内容被发布清空后自动回到输入态。
  */
  const [editing, setEditing] = useState(true);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [attributeIndex, setAttributeIndex] = useState(0);
  /**
   * 当前块的**首行行号**。`null` = 还没点过任何块，跟随最后一块（正常打字的默认路径）。
   * 用行号而不是下标：`value` 一变（打字、回车、删除）下标会错位，行号才是稳定的锚。
   */
  const [activeFrom, setActiveFrom] = useState<number | null>(null);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** 内部要读选区、外部（添加内容窗口）要能聚焦：两边都收到同一个节点 */
  const attachInput = (node: HTMLTextAreaElement | null): void => {
    inputRef.current = node;
    if (externalInputRef) externalInputRef.current = node;
  };
  const composingRef = useRef(false);
  /** 从呈现态点回来时要补一次聚焦（此刻 textarea 还没挂载，focus() 会落空） */
  const wantFocus = useRef(false);
  /** 命令执行后要恢复的选区（受控组件：值更新后才能在 DOM 上设回去）；**块内局部**偏移 */
  const pendingSelection = useRef<TextSelection | null>(null);
  /**
   * 换当前块之后要落的光标（**块内局部**偏移）。回车切块、点别的块都靠它——
   * 等 React 把新值渲进去之后才在 DOM 上设，早设会被这一次渲染覆盖。
   */
  const pendingCaret = useRef<number | null>(null);
  /** 当前块内的选区（命令要吃触发段、要算出新选区，都读它） */
  const selectionRef = useRef<TextSelection>({ from: 0, to: 0 });

  /*
    切块是**派生**的：`value` 变了就重算，不额外维护一份"块的副本"。
    空串没有块，补一个空块，保证永远有一个可编辑的当前块。
  */
  const blocks = useMemo(() => {
    const list = splitQuickBlocks(value);
    return list.length > 0 ? list : [EMPTY_BLOCK];
  }, [value]);

  const activeBlock = useMemo(() => {
    const last = blocks[blocks.length - 1] ?? EMPTY_BLOCK;
    if (activeFrom === null) return last;
    return (
      blocks.find((block) => block.from === activeFrom) ??
      blocks.find((block) => activeFrom >= block.from && activeFrom <= block.to) ??
      last
    );
  }, [activeFrom, blocks]);

  /*
    整块呈现态是**派生**的：`editing=false` 且内容非空才整块呈现（失焦兜底路径）。
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

  /*
    换块之后把光标放回去。用 `useLayoutEffect`：必须在浏览器重绘前设好，否则会看到光标先跳一下。
    这里只操作 DOM 选区，不 setState（eslint 的 `react-hooks/set-state-in-effect` 管的是后者）。
  */
  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    if (pending === null) return;
    pendingCaret.current = null;
    const node = inputRef.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(pending, pending);
  }, [value, activeFrom]);

  const filteredAttributes = useMemo(() => {
    if (trigger?.kind !== "@") return [];
    const query = trigger.query.trim().toLowerCase();
    return attributes.filter((item) => item.label.includes(query) || item.id.includes(query));
  }, [attributes, trigger]);

  const activeAttribute =
    filteredAttributes.length === 0 ? -1 : Math.min(attributeIndex, filteredAttributes.length - 1);

  /** 把当前块换成新文本，拼回全文（切块的安全网保证只有这一段变了）。 */
  function withActiveText(nextBlockText: string): string {
    return blocks
      .map((block) => (block.from === activeBlock.from ? nextBlockText : block.text))
      .join("\n");
  }

  /** 记下**块内**选区并重算命令触发（输入、移动光标、点击都要算）。 */
  function syncTrigger(nextText: string, node: HTMLTextAreaElement | null): void {
    const caret = node?.selectionStart ?? nextText.length;
    selectionRef.current = { from: caret, to: node?.selectionEnd ?? caret };
    if (composingRef.current) return;
    const next = triggerAt(nextText, caret);
    // 这个宿主没有可写的属性命令时，`@` 不进菜单（不然会留一个"按键没反应"的状态）
    setTrigger(next?.kind === "@" && attributes.length === 0 ? null : next);
    setAttributeIndex(0);
  }

  /**
   * 块被改动之后：先算光标落在**哪一块的哪一行**，再决定当前块是谁。
   *
   * 这条是"回车就呈现上一行"的关键：回车在列表里切出新块，光标随之落到新块，
   * 当前块跟着切过去，原来那一行当场变成呈现块。段落内的软换行不会切块，所以不会乱跳。
   */
  function handleBlockChange(event: React.ChangeEvent<HTMLTextAreaElement>): void {
    const node = event.target;
    const nextBlockText = node.value;
    const caret = node.selectionStart ?? nextBlockText.length;
    const caretLine = lineOfOffset(nextBlockText, caret);
    const column = columnOfOffset(nextBlockText, caret);
    const nextValue = withActiveText(nextBlockText);
    const globalLine = activeBlock.from + caretLine;
    const nextBlocks = splitQuickBlocks(nextValue);
    const target =
      nextBlocks.find((block) => globalLine >= block.from && globalLine <= block.to) ??
      nextBlocks[nextBlocks.length - 1];

    if (target && target.from !== activeBlock.from) {
      setActiveFrom(target.from);
      pendingCaret.current = offsetOfLine(target.text, globalLine - target.from) + column;
    }
    syncTrigger(nextBlockText, node);
    onChange(nextValue);
  }

  /**
   * 吃掉触发段（`/加`、`@`）后返回**当前块**的文本与光标位置。
   *
   * **必须吃掉**：触发词是"给命令用的"，不是用户想写进 Memo 的内容——留着就会出现
   * `/加****` 或正文里一条 `@`。只有当前文本仍与触发时一致（用户没在中途改过）才吃，
   * 否则退回"在光标处执行"。
   */
  function stripTrigger(): { text: string; caret: number } {
    const selection = selectionRef.current;
    if (!trigger) return { text: activeBlock.text, caret: selection.to };
    const token = `${trigger.kind}${trigger.query}`;
    if (
      activeBlock.text.slice(trigger.start, trigger.caret) !== token ||
      selection.to < trigger.caret
    ) {
      return { text: activeBlock.text, caret: selection.to };
    }
    return {
      text: activeBlock.text.slice(0, trigger.start) + activeBlock.text.slice(trigger.caret),
      caret: trigger.start,
    };
  }

  function applyCommand(id: FormatCommandId): void {
    // 触发段由共享的 `applyFormatAt()` 吃掉——三个宿主（正文、这里、试验页）只有这一份实现
    const result = applyFormatAt(activeBlock.text, selectionRef.current, id, ["/", "@"]);
    pendingSelection.current = result.selection;
    setTrigger(null);
    onChange(withActiveText(result.text));
  }

  function chooseAttribute(id: QuickAttributeId): void {
    // 属性**不写进正文**：吃掉 `@…` 触发段，只把选择交回宿主（宿主去聚焦既有的受控字段）
    const base = stripTrigger();
    if (base.text !== activeBlock.text) onChange(withActiveText(base.text));
    setTrigger(null);
    onChooseAttribute?.(id);
  }

  function backToEditing(): void {
    wantFocus.current = true;
    setEditing(true);
  }

  /** 点/键盘选到某一块：切过去，光标落在该块末尾 */
  function editBlock(block: QuickBlock): void {
    setActiveFrom(block.from);
    pendingCaret.current = block.text.length;
  }

  function blockPreview(block: QuickBlock): React.ReactElement {
    return (
      <div
        key={block.from}
        className="quick-composer__block"
        role="button"
        tabIndex={0}
        aria-label={`${ariaLabel}（第 ${block.from + 1} 行起，点击编辑这一段）`}
        onClick={(event) => {
          // 呈现内容里的链接自己处理点击，不要顺手把这一段切回编辑态
          if ((event.target as HTMLElement).closest("a, button")) return;
          editBlock(block);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            editBlock(block);
          }
        }}
      >
        <Suspense fallback={<p>{block.text}</p>}>
          <MarkdownPreview source={block.text} />
        </Suspense>
      </div>
    );
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

      <div className="quick-composer__blocks">
        {blocks.map((block) => {
          if (block.from !== activeBlock.from) return blockPreview(block);
          return (
            <textarea
              key="quick-active"
              ref={attachInput}
              className={inputClassName}
              aria-label={ariaLabel}
              placeholder={placeholder}
              value={activeBlock.text}
              onChange={handleBlockChange}
              onSelect={(event) => syncTrigger(event.currentTarget.value, event.currentTarget)}
              onClick={(event) => syncTrigger(event.currentTarget.value, event.currentTarget)}
              onFocus={(event) => {
                setEditing(true);
                syncTrigger(event.currentTarget.value, event.currentTarget);
              }}
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
          );
        })}
      </div>
    </div>
  );
}

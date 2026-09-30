/**
 * `/` 命令菜单（编辑拓展阶段 B / Task B2）。
 *
 * 只做**呈现与选择**：拿一组命令 id 显示中文名、按 `query` 过滤、把用户选中的 id 交回 `onChoose`。
 * 不认识宿主、不持有文本、不拼 Markdown——那些是宿主与 `format-commands.ts` 的事。
 *
 * 两条刻意的设计：
 * 1. **不抢 DOM 焦点**：焦点留在宿主的输入框里，用户才能继续打字过滤（`/加` 缩小到「加粗」）。
 *    高亮只用 `aria-selected` + 样式表达，键盘监听在打开期间挂在 `document` 上、关闭即撤
 *    ——与 `ui/Menu.tsx` 的 `DropdownMenu` 同一做法；`/` 的**触发**仍由宿主判定（行首或空白后），
 *    这里不是全局快捷键。
 * 2. **无匹配时菜单不关**：只显示一行说明。静默关掉会让用户以为按键丢了。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { FORMAT_COMMAND_LABELS, type FormatCommandId } from "./format-commands";

export interface CommandMenuProps {
  open: boolean;
  /** 触发词之后已经输入的内容（可带开头的 `/`） */
  query: string;
  commands: readonly FormatCommandId[];
  onChoose: (id: FormatCommandId) => void;
  onClose: () => void;
}

/**
 * 过滤：中文名或英文 id 都认（`/列`、`/bul`、`/quote` 都能命中），忽略开头的 `/` 与空白、忽略大小写。
 * 不做拼音、不做模糊匹配——规则简单到用户能预测。
 */
function matches(id: FormatCommandId, query: string): boolean {
  return id.includes(query) || FORMAT_COMMAND_LABELS[id].includes(query);
}

export function CommandMenu({ open, query, commands, onChoose, onClose }: CommandMenuProps) {
  const normalized = query.replace(/^\//, "").trim().toLowerCase();
  const filtered = useMemo(
    () => commands.filter((id) => matches(id, normalized)),
    [commands, normalized],
  );

  const [highlight, setHighlight] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // 打开、或过滤结果变化时，高亮回到第一项（"默认高亮首项"是契约）
  useEffect(() => {
    setHighlight(0);
  }, [open, normalized, commands]);

  // 过滤结果可能变短，高亮索引要夹在有效范围内（否则 Enter 会选中 undefined）
  const active = filtered.length === 0 ? -1 : Math.min(highlight, filtered.length - 1);

  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(event: KeyboardEvent): void {
      // 输入法组合期间由输入法处理，别抢键（中文输入 `/` 常常是组合的一部分）
      if (event.isComposing) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Enter") {
        const chosen = filtered[active];
        if (chosen === undefined) return; // 无匹配：不关菜单、不选中
        event.preventDefault();
        onChoose(chosen);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (filtered.length === 0) return;
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setHighlight((current) => {
          const from = Math.min(current, filtered.length - 1);
          return (from + delta + filtered.length) % filtered.length;
        });
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, filtered, active, onChoose, onClose]);

  // 高亮项滚进可视区（列表可能比菜单高）
  useEffect(() => {
    if (!open || active < 0) return;
    itemRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active, filtered.length]);

  if (!open) return null;

  return (
    <div className="menu cmd-menu" role="listbox" aria-label="命令">
      {filtered.length === 0 ? (
        <div className="cmd-menu__empty">没有匹配的命令</div>
      ) : (
        filtered.map((id, index) => (
          <button
            key={id}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            role="option"
            aria-selected={index === active}
            tabIndex={-1}
            className={`menu__item cmd-menu__item${index === active ? " is-active" : ""}`}
            onMouseEnter={() => setHighlight(index)}
            onClick={() => onChoose(id)}
          >
            {FORMAT_COMMAND_LABELS[id]}
          </button>
        ))
      )}
    </div>
  );
}

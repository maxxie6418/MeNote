/**
 * 快捷输入的**块切分**（编辑拓展：块级即时渲染的第一步）。
 *
 * 用途：`QuickComposer` 要把"已写完的块"按 Markdown 呈现、把"正在写的块"留成源码 textarea，
 * 这就需要先把整段文本切成块。规则按 Markdown 的块语义写，**不是随便按换行切**：
 * - 标题 / 引用 / 无序列表 / 有序列表 / 围栏 / 分隔线在行首就是块的开头；
 * - 空行是分隔符，但**空行本身归前一块的尾部**（这样 `blocks.join("\n")` 才能逐字还原原文）；
 * - 围栏（``` / ~~~）内部一律不切，直到配对的闭围栏或文末；
 * - 其余连续行留同块（CommonMark 的 lazy continuation：`- 项目\n续行` 是一块）。
 *
 * **安全网**：对任意输入都有 `splitQuickBlocks(t).map((b) => b.text).join("\n") === t`。
 * 也就是说切块只影响"哪一段先呈现"，**永远不改内容**。这条由用例守着。
 *
 * 已知不精确（写在这里，不装作没有）：setext 标题（`===`/`---` 下划线式）、缩进代码块、
 * 表格跨行等边角不单独识别；遇到时表现为"呈现时机分块稍有不同"，内容仍逐字不变。
 */

/** 一块：`from`/`to` 是**行下标**区间（含首含尾），`text` 是该块原文（含块内换行） */
export interface QuickBlock {
  from: number;
  to: number;
  text: string;
}

/** 空行（含只有空白的行） */
function isBlank(line: string): boolean {
  return /^\s*$/.test(line);
}

/** 开围栏：返回围栏串（如 "```" / "~~~~"），不是围栏返回 `null` */
function fenceOpen(line: string): string | null {
  const matched = /^(`{3,}|~{3,})/.exec(line);
  return matched ? matched[1] ?? null : null;
}

/** 闭围栏：同一种字符、长度不小于开围栏，且后面只剩空白 */
function fenceClose(line: string, fence: string): boolean {
  const char = fence[0] === "~" ? "~" : "`";
  const pattern = new RegExp(`^\\${char}{${fence.length},}\\s*$`);
  return pattern.test(line);
}

/** 行首是块级标记（标题 / 引用 / 列表 / 围栏 / 分隔线） */
function startsBlock(line: string): boolean {
  if (isBlank(line)) return false;
  if (/^#{1,6}\s/.test(line)) return true;
  if (/^>/.test(line)) return true;
  if (/^[-*+]\s/.test(line)) return true;
  if (/^\d+[.)]\s/.test(line)) return true;
  if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return true;
  return fenceOpen(line) !== null;
}

/**
 * 该行开头的块**不能被下一行续写**：标题与分隔线都没有续行（列表项、引用有 lazy continuation，
 * 所以它们不算）。少了这条，`# 标题\n正文` 会被当成一块，标题那一行就永远不呈现。
 */
function isUncontinuable(line: string): boolean {
  if (/^#{1,6}\s/.test(line)) return true;
  if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return true;
  return fenceOpen(line) !== null;
}

/**
 * 把整段文本切成块。空串没有块（调用方按"一个空输入框"处理）。
 */
export function splitQuickBlocks(text: string): QuickBlock[] {
  if (text === "") return [];
  // 只按 `\n` 切、不规范化 `\r`：这样 CRLF 文本 join 回来仍逐字相等
  const lines = text.split("\n");
  const blocks: QuickBlock[] = [];
  let start = 0;
  let fence: string | null = null;

  const push = (to: number): void => {
    blocks.push({ from: start, to, text: lines.slice(start, to + 1).join("\n") });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (fence !== null) {
      if (fenceClose(line, fence)) {
        fence = null;
        push(index);
        start = index + 1;
      }
      continue;
    }
    const opening = fenceOpen(line);
    if (opening !== null) {
      // 围栏可以打断段落：前面还有内容就先收掉前一块
      if (index > start) push(index - 1);
      start = index;
      fence = opening;
      continue;
    }
    if (index === 0) continue;
    const previous = lines[index - 1] ?? "";
    // 空行是分隔符，但它自己归前一块；连续空行不制造空块。
    // `index > start` 保证不重复收掉已经落定的块（闭围栏之后、空行之后都可能落到这里）
    const boundary =
      (isBlank(previous) && !isBlank(line)) || startsBlock(line) || isUncontinuable(previous);
    if (boundary && index > start) {
      push(index - 1);
      start = index;
    }
  }
  if (start < lines.length) push(lines.length - 1);
  return blocks;
}

/** 光标在第几行（0 起）；用于把"当前块"钉在光标所在的那一块上 */
export function lineOfOffset(text: string, offset: number): number {
  const safe = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  for (let index = 0; index < safe; index += 1) {
    if (text[index] === "\n") line += 1;
  }
  return line;
}

/** 行内偏移：某一行里第几个字符（用于把光标放回块内的同一列） */
export function columnOfOffset(text: string, offset: number): number {
  const safe = Math.max(0, Math.min(offset, text.length));
  const lastBreak = text.lastIndexOf("\n", safe - 1);
  return safe - (lastBreak + 1);
}

/** 第 `line` 行在该行首的字符偏移（越界时夹到文本首尾） */
export function offsetOfLine(text: string, line: number): number {
  if (line <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      seen += 1;
      if (seen === line) return index + 1;
    }
  }
  return text.length;
}

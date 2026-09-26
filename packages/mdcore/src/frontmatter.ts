/**
 * 条目 md 的 YAML front matter（需求 §10.2、功能拆解 M04-06/M07-03）。
 *
 * 格式约定：文件**开头**是 `---` 包裹的 YAML，应用数据挂在 **`menote:` 根键**下
 * （需求 §10.2 的表格示例即 `menote: { type: table, row_id_column, ... }`）。本模块只认这一层，
 * 不做通用 YAML。
 *
 * **为什么自己写解析而不引 YAML 库**：`packages/mdcore` 定位是零依赖纯函数包；而 md 是我们自己
 * 生成的，读入时只需要一个**有界子集**（一层映射 + 标量 + 内联/块序列 + 一层嵌套）。
 * 引库换来的通用性，代价是一个生产依赖 + 与"纯函数包"的定位冲突；将来真需要再换（接口不变）。
 *
 * **安全底线**：解析**不丢未知内容**。表格的 `columns` / `views` 这类我们不解析的键，
 * 以"整段原始行"保留，改写时原样写回——否则保存一次就会吃掉表格元数据。
 * 格式坏了（没有闭合围栏、缩进错乱）一律**降级**：整篇当正文，不抛错（需求 §10.2「格式坏了可降级」）。
 */

export const FRONTMATTER_FENCE = "---";
export const MENOTE_KEY = "menote";

/** 任务字段（字面量口径见 `tasks.ts`；这里只做字符串承载，不做枚举校验） */
export interface TaskFields {
  status: string | null;
  due: string | null;
  priority: string | null;
}

export interface MenoteMeta {
  type: string | null;
  tags: string[];
  /** `null` 表示**没有** `menote.task` 键——清单标记的有无就看它（M07-04） */
  task: TaskFields | null;
  /** 不解析、但必须原样保留的行（如表格的 `columns` / `views`） */
  preservedLines: string[];
}

export interface ParsedDocument {
  meta: MenoteMeta;
  body: string;
  /** 原文的 front matter 文本（不含两侧围栏）；没有则为 null */
  raw: string | null;
}

const EMPTY_META: MenoteMeta = { type: null, tags: [], task: null, preservedLines: [] };

/** 拆出围栏内的原始文本；没有合法 front matter 时返回 null（此时整篇都是正文） */
function splitFences(markdown: string): { raw: string; body: string } | null {
  const text = markdown.startsWith("\uFEFF") ? markdown.slice(1) : markdown;
  if (!text.startsWith(`${FRONTMATTER_FENCE}\n`) && text.trimEnd() !== FRONTMATTER_FENCE) {
    if (!text.startsWith(FRONTMATTER_FENCE)) return null;
  }

  const lines = text.split("\n");
  if (lines[0]?.trim() !== FRONTMATTER_FENCE) return null;

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === FRONTMATTER_FENCE);
  if (end === -1) return null; // 没闭合 → 降级为普通正文

  return {
    raw: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n").replace(/^\n/, ""),
  };
}

/** `[a, b, "c,d"]` → 数组；不去重、不裁剪语义，交给上层 */
function parseInlineArray(text: string): string[] {
  const inner = text.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (inner.trim() === "") return [];

  const out: string[] = [];
  let current = "";
  let quoted = false;

  for (const char of inner) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current.trim());
  return out.filter((item) => item !== "");
}

/** 需要加引号的值：含分隔符、引号，或首尾空白 */
function needsQuote(value: string): boolean {
  return /[,[\]"]/.test(value) || value.trim() !== value;
}

export function renderInlineArray(values: readonly string[]): string {
  return `[${values.map((value) => (needsQuote(value) ? `"${value.replace(/"/g, '\\"')}"` : value)).join(", ")}]`;
}

/** 去掉标量两侧引号（保留内部内容原样） */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  return trimmed;
}

/**
 * 把一个块（menote 之下）按**顶层键**切成段：每段是 `键 + 其后续缩进行`。
 * 段是原样保留与行级改写的最小单位——只改被 patch 命中的段，其它段一字不动。
 */
interface Segment {
  key: string;
  lines: string[];
}

function splitSegments(lines: readonly string[]): { header: string[]; segments: Segment[] } {
  const header: string[] = [];
  const segments: Segment[] = [];
  let current: Segment | null = null;

  for (const line of lines) {
    const matched = /^(\s*)([A-Za-z0-9_-]+)\s*:/.exec(line);
    const indent = matched?.[1]?.length ?? 0;

    if (matched && indent <= 2) {
      if (current) segments.push(current);
      current = { key: matched[2] ?? "", lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
    else header.push(line);
  }
  if (current) segments.push(current);
  return { header, segments };
}

/** 从某个段里取标量值（`type: note` → `note`） */
function scalarOf(segment: Segment): string {
  const first = segment.lines[0] ?? "";
  const value = first.slice(first.indexOf(":") + 1);
  return unquote(value);
}

/** 取 `tags` 段：支持内联数组与块序列两种写法 */
function tagsOf(segment: Segment): string[] {
  const first = segment.lines[0] ?? "";
  const inline = first.slice(first.indexOf(":") + 1).trim();
  if (inline.startsWith("[")) return parseInlineArray(inline).map(unquote);

  const out: string[] = [];
  for (const line of segment.lines.slice(1)) {
    const matched = /^\s*-\s*(.+)$/.exec(line);
    if (matched?.[1]) out.push(unquote(matched[1]));
  }
  return out;
}

/** 取 `task` 段（一层嵌套） */
function taskOf(segment: Segment): TaskFields {
  const task: TaskFields = { status: null, due: null, priority: null };
  for (const line of segment.lines.slice(1)) {
    const matched = /^\s*(status|due|priority)\s*:\s*(.*)$/.exec(line);
    const key = matched?.[1] as keyof TaskFields | undefined;
    if (!key) continue;
    const value = unquote(matched?.[2] ?? "");
    task[key] = value === "" || value === "null" || value === "~" ? null : value;
  }
  return task;
}

/** 解析条目 md：拿到结构化 meta、正文，以及原始 front matter 文本 */
export function parseMenoteMeta(markdown: string): ParsedDocument {
  const split = splitFences(markdown);
  if (!split) return { meta: { ...EMPTY_META }, body: markdown, raw: null };

  const blockLines = split.raw.split("\n");
  const menoteIndex = blockLines.findIndex((line) => /^menote\s*:/.test(line));
  if (menoteIndex === -1) {
    // 有 front matter 但没有 menote 键：保留原文，别丢
    return {
      meta: { ...EMPTY_META, preservedLines: blockLines },
      body: split.body,
      raw: split.raw,
    };
  }

  const { segments } = splitSegments(blockLines.slice(menoteIndex + 1));
  const meta: MenoteMeta = { ...EMPTY_META };

  for (const segment of segments) {
    if (segment.key === "type") meta.type = scalarOf(segment) || null;
    else if (segment.key === "tags") meta.tags = tagsOf(segment);
    else if (segment.key === "task") meta.task = taskOf(segment);
    else meta.preservedLines.push(...segment.lines);
  }

  return { meta, body: split.body, raw: split.raw };
}

/** 只取正文（去掉 front matter） */
export function stripFrontmatter(markdown: string): string {
  return parseMenoteMeta(markdown).body;
}

function renderTagsLine(tags: readonly string[]): string | null {
  return tags.length > 0 ? `  tags: ${renderInlineArray(tags)}` : null;
}

function renderTaskLines(task: TaskFields | null): string[] {
  if (!task) return [];
  const inner: string[] = [];
  if (task.status) inner.push(`    status: ${task.status}`);
  if (task.due) inner.push(`    due: ${task.due}`);
  if (task.priority) inner.push(`    priority: ${task.priority}`);
  return ["  task:", ...inner];
}

/** 从结构化 meta 生成完整文档（用于新建；已有的文档请用 `updateMenoteKeys` 保内容） */
export function buildDocument(meta: MenoteMeta, body: string): string {
  const lines: string[] = [];
  if (meta.type) lines.push(`  type: ${meta.type}`);
  const tagsLine = renderTagsLine(meta.tags);
  if (tagsLine) lines.push(tagsLine);
  lines.push(...renderTaskLines(meta.task));
  lines.push(...meta.preservedLines);

  if (lines.length === 0) return body;
  return `${FRONTMATTER_FENCE}\n${MENOTE_KEY}:\n${lines.join("\n")}\n${FRONTMATTER_FENCE}\n\n${body}`;
}

export interface MenotePatch {
  type?: string | null;
  tags?: string[];
  /** `null` 表示删除整个 task 块（= 去掉清单标记，M07-04） */
  task?: TaskFields | null;
}

/**
 * 只改写 patch 命中的键，**其它段原样保留**（含我们不解析的 columns / views）。
 * 这是保存路径唯一该用的写法：新建用 `buildDocument`，改写一律走这里。
 */
export function updateMenoteKeys(markdown: string, patch: MenotePatch): string {
  const split = splitFences(markdown);
  if (!split) {
    // 原本没有 front matter：按 patch 直接建一个
    const meta: MenoteMeta = {
      type: patch.type ?? null,
      tags: patch.tags ?? [],
      task: patch.task ?? null,
      preservedLines: [],
    };
    return buildDocument(meta, markdown);
  }

  const blockLines = split.raw.split("\n");
  const menoteIndex = blockLines.findIndex((line) => /^menote\s*:/.test(line));
  const outerHeader = menoteIndex === -1 ? blockLines : blockLines.slice(0, menoteIndex + 1);
  const inner = menoteIndex === -1 ? [] : blockLines.slice(menoteIndex + 1);
  const { segments } = splitSegments(inner);
  const untouched: Segment[] = [];
  let sawType = false;
  let sawTags = false;
  let sawTask = false;

  for (const segment of segments) {
    if (segment.key === "type" && patch.type !== undefined) {
      sawType = true;
      if (patch.type !== null) untouched.push({ key: "type", lines: [`  type: ${patch.type}`] });
      continue;
    }
    if (segment.key === "tags" && patch.tags !== undefined) {
      sawTags = true;
      const line = renderTagsLine(patch.tags);
      if (line) untouched.push({ key: "tags", lines: [line] });
      continue;
    }
    if (segment.key === "task" && patch.task !== undefined) {
      sawTask = true;
      const lines = renderTaskLines(patch.task);
      if (lines.length > 0) untouched.push({ key: "task", lines });
      continue;
    }
    untouched.push(segment);
  }

  // patch 里给了、原本没有的键：追加到 menote 映射末尾
  const appended: Segment[] = [];
  if (patch.type !== undefined && patch.type !== null && !sawType) {
    appended.push({ key: "type", lines: [`  type: ${patch.type}`] });
  }
  if (patch.tags !== undefined && !sawTags) {
    const line = renderTagsLine(patch.tags);
    if (line) appended.push({ key: "tags", lines: [line] });
  }
  if (patch.task !== undefined && patch.task !== null && !sawTask) {
    appended.push({ key: "task", lines: renderTaskLines(patch.task) });
  }

  const head = outerHeader.length > 0 ? outerHeader : [MENOTE_KEY];
  const headFixed = head[0]?.includes(MENOTE_KEY) ? head : [MENOTE_KEY, ...head];
  const bodyLines = [...untouched, ...appended].flatMap((segment) => segment.lines);
  const rendered = [...headFixed, ...bodyLines].join("\n");

  return `${FRONTMATTER_FENCE}\n${rendered}\n${FRONTMATTER_FENCE}\n\n${split.body}`;
}

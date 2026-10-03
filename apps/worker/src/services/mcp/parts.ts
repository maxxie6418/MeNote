/**
 * MCP 工具层共用的零件（M6 批 2）。
 *
 * ## 为什么要单独一份
 *
 * `tools-read.ts`（5 个只读工具）与批 3 的 `tools-write.ts`（6 个写类工具）要共用同一批
 * 游标编解码、字符切片、参数夹取与错误类型。放在任一个工具文件里，另一个就得跨文件
 * import 一个"工具文件"，于是形成环。零件单独成一份，两边都只向下依赖它。
 *
 * ## 三条共用口径钉在这里
 *
 * 1. **游标是 `值:id` 而不是只值**：同一毫秒可能有多条记录，只按值分页会漏行或重行；
 * 2. **按字符而不是字节切**：字节偏移会把多字节字符（中文、emoji）切半；
 * 3. **工具级失败是 `McpToolError` 不是 `DomainError`**：前者翻成 `isError: true`
 *    让 agent 自己纠正，后者留给协议层（设计 §5-2）。
 */
import {
  MCP_PAGE_LIMIT_MAX,
  base64UrlDecode,
  base64UrlEncode,
  type ItemType,
} from "@menote/shared";

/** 可见性判定不通过时的统一提示——不区分「不存在」与「不可见」 */
export const NOT_VISIBLE = "条目不存在或不在可见范围内";

/**
 * 工具级失败：翻成 `result.isError = true` 而不是 JSON-RPC error（设计 §5-2）。
 *
 * 权限不够、参数不对、条目太大——这些 agent 读完提示就能改，所以要让提示原样到达它。
 */
export class McpToolError extends Error {}

export function fail(message: string): never {
  throw new McpToolError(message);
}

// ———————————————————————————————————————— 游标

/**
 * 列表游标：`updatedAt:id`。
 *
 * **必须带 id**：同一毫秒可能有多条（批量导入、agent 连续写入），只按 `updated_at`
 * 分页会漏行或重行。与审计分页同一个道理（`tokens.ts` 的 `encodeAuditCursor`）。
 */
export interface ListCursor {
  updatedAt: number;
  id: string;
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function encodeListCursor(cursor: ListCursor): string {
  // 用 `:` 分隔，靠 `lastIndexOf` 切——分隔符不会出现在 ULID 里，所以切得准
  return base64UrlEncode(textEncoder.encode(`${cursor.updatedAt}:${cursor.id}`));
}

export function decodeListCursor(raw: unknown): ListCursor | null {
  if (typeof raw !== "string" || raw === "") return null;
  try {
    const text = textDecoder.decode(base64UrlDecode(raw));
    const sep = text.lastIndexOf(":");
    const updatedAt = Number.parseInt(text.slice(0, sep), 10);
    const id = text.slice(sep + 1);
    return Number.isFinite(updatedAt) && id !== "" ? { updatedAt, id } : null;
  } catch {
    return null;
  }
}

/** 正文续读游标：字符偏移。前缀 `o:` 用来和 `a:b` 形态的列表游标区分开 */
export function encodeOffsetCursor(offset: number): string {
  return base64UrlEncode(textEncoder.encode(`o:${offset}`));
}

export function decodeOffsetCursor(raw: unknown): number {
  if (typeof raw !== "string" || raw === "") return 0;
  try {
    const text = textDecoder.decode(base64UrlDecode(raw));
    if (!text.startsWith("o:")) return 0;
    const offset = Number.parseInt(text.slice(2), 10);
    return Number.isFinite(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

// ———————————————————————————————————————— 字符切片

/**
 * 按**字符**取前 n 个。
 *
 * `[...text].slice(0, n).join("")` 在 512 KB 正文上会先建一个几十万元素的数组；
 * 这里按码点边走边切，内存只与结果同量级。代理对（emoji 等）步进 2，不切半。
 */
export function sliceChars(text: string, max: number): string {
  if (max >= text.length) return text;
  let end = 0;
  let count = 0;
  while (end < text.length && count < max) {
    const code = text.codePointAt(end);
    end += code !== undefined && code > 0xffff ? 2 : 1;
    count += 1;
  }
  return text.slice(0, end);
}

export function charLength(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.codePointAt(i);
    if (code !== undefined && code > 0xffff) i += 1;
    count += 1;
  }
  return count;
}

// ———————————————————————————————————————— 参数

export function clampPageLimit(raw: unknown): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 1) return MCP_PAGE_LIMIT_MAX;
  return Math.min(Math.trunc(value), MCP_PAGE_LIMIT_MAX);
}

const ITEM_TYPES: readonly ItemType[] = ["note", "table", "memo"];

export function isItemType(raw: unknown): raw is ItemType {
  return typeof raw === "string" && ITEM_TYPES.includes(raw as ItemType);
}

export function pickId(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") fail("id 必填");
  return raw;
}

/** 库里的 tags 是 JSON 数组文本；脏数据不至于让整个工具失败——解析不了就当没标签 */
export function readTags(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

// ———————————————————————————————————————— 条目元数据

/** 一行可见条目的公共列（`list_items` / `search` 共用，省得两处各写一份列名） */
export const ITEM_META_COLUMNS =
  "i.id, i.type, i.folder_id, i.title, i.tags, i.memo_at, i.is_task, i.task_status, i.updated_at, i.rev";

export interface ItemMetaRow {
  id: string;
  type: ItemType;
  folder_id: string | null;
  title: string | null;
  tags: string;
  memo_at: number | null;
  is_task: number;
  task_status: string | null;
  updated_at: number;
  rev: number;
}

export function toItemMeta(row: ItemMetaRow): Record<string, unknown> {
  return {
    id: row.id,
    type: row.type,
    folder_id: row.folder_id,
    title: row.title,
    tags: readTags(row.tags),
    memo_at: row.memo_at,
    is_task: row.is_task === 1,
    task_status: row.task_status,
    updated_at: row.updated_at,
    rev: row.rev,
  };
}

/**
 * MCP 工具注册表（M6 批 2 建表，批 3 补齐写类；设计 §五-3、§六）。
 *
 * ## Schema 是**构建期写死的常量**，不是运行时生成的
 *
 * 架构 §十一 明确「工具的 JSON Schema 在构建时生成静态常量，运行时不做 schema 编译」。
 * 少一层运行时编译 = 少一份冷启动开销，也少一类"生成结果随环境而变"的怪问题。
 *
 * ## 每个条目带一个权限位
 *
 * 权限位是**数据**而不是散在执行代码里的 `if`——`tools/call` 先查表拿位、判过再执行，
 * 于是"这个工具要什么权限"只有一处可查，批 3 加工具时也不可能漏。
 *
 * ## 批 2 只注册 5 个只读工具
 *
 * 写类 6 个在批 3 才进这张表。**没注册的写工具不会被 `tools/list` 列出**，
 * 于是拿一个只读令牌去调 `edit_item` 得到的是"未知工具"而不是"权限不足"——
 * 这不是缺陷而是更准确：那枚令牌确实没有这个能力。
 */
import { MCP_PERM_LABELS, MCP_PERM_READ, type McpToolName } from "@menote/shared";
import type { StorageEnv } from "../../types";
import type { McpPrincipal } from "./auth";
import { runListFolders, runListItems, runListVersions, runSearch } from "./tools-read";
import { runReadItem } from "./tools-read-item";

export interface McpToolDefinition {
  name: McpToolName;
  /** 写给 agent 看的说明。**必须写清推荐调用顺序**（设计 §17.5：先 search/list_items → 再 read_item → 改时带上读到的 rev） */
  description: string;
  /** 所需权限位；与 `MCP_PERM_*` 对应 */
  perm: number;
  /** 静态 JSON Schema（不生成） */
  inputSchema: Record<string, unknown>;
  /** 方法式声明：参数按双变性匹配，各工具可以只声明自己用到的那几个 */
  run(env: StorageEnv, principal: McpPrincipal, args: never): Promise<unknown>;
}

const CALL_ORDER_NOTE =
  "推荐调用顺序：先 search 或 list_items 找到条目 → 再 read_item 读内容 → 修改时带上读到的 rev。";

/** 游标参数（三处复用同一份形状，省得三份 schema 漂移） */
const CURSOR_PROPERTIES = {
  cursor: {
    type: "string",
    description: "上一页返回的 next_cursor；省略表示从第一页开始",
  },
  limit: { type: "integer", minimum: 1, maximum: 50, description: "每页条数，默认 50、上限 50" },
} as const;

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: "search",
    description: `关键词搜索，返回条目 ID、标题、类型、片段与 rev。${CALL_ORDER_NOTE}`,
    perm: MCP_PERM_READ,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索词（最长 200 字符）" },
        type: { type: "string", enum: ["note", "table", "memo"], description: "按类型筛；省略为不限" },
        folder_id: {
          type: ["string", "null"],
          description: "限定某一个文件夹；null 表示根目录；省略为令牌范围内全部",
        },
        tag: { type: "string", description: "按单个标签精确匹配" },
        ...CURSOR_PROPERTIES,
      },
      required: ["query"],
    },
    run: runSearch,
  },
  {
    name: "list_folders",
    description:
      "返回令牌范围内的文件夹树（含条目数）与标签列表（含使用次数）。**加密空间不出现在树里，条目数不含隐私内容**。",
    perm: MCP_PERM_READ,
    inputSchema: { type: "object", properties: {}, required: [] },
    run: runListFolders,
  },
  {
    name: "list_items",
    description: `按文件夹、类型、标签、清单状态、更新时间筛选列出条目（只返回元数据，不含正文）。${CALL_ORDER_NOTE}`,
    perm: MCP_PERM_READ,
    inputSchema: {
      type: "object",
      properties: {
        folder_id: { type: ["string", "null"], description: "null 表示根目录；省略为不限" },
        type: { type: "string", enum: ["note", "table", "memo"] },
        tag: { type: "string" },
        task_status: { type: "string", enum: ["todo", "doing", "done"] },
        updated_after: { type: "number", description: "只看这个毫秒时间戳之后更新过的条目" },
        ...CURSOR_PROPERTIES,
      },
      required: [],
    },
    run: runListItems,
  },
  {
    name: "read_item",
    description:
      "读取一条内容：整篇的一个范围、某个 Markdown 小节，或按 next_cursor 续读；给 version_id 则读某个历史版本。默认最多 8000 字符，上限 20000 字符。",
    perm: MCP_PERM_READ,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "条目 ID" },
        section: { type: "string", description: "按 Markdown 标题读该小节（仅 512 KB 以内的条目）" },
        cursor: { type: "string", description: "上一页返回的 next_cursor" },
        max_chars: { type: "integer", minimum: 1, maximum: 20000, description: "本次最多读多少字符" },
        version_id: { type: "string", description: "读某个历史版本而不是当前稿" },
      },
      required: ["id"],
    },
    run: runReadItem,
  },
  {
    name: "list_versions",
    description: "列出某条内容的历史版本（时间、原因、大小、备注）。",
    perm: MCP_PERM_READ,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "条目 ID" },
        ...CURSOR_PROPERTIES,
      },
      required: ["id"],
    },
    run: runListVersions,
  },
];

const BY_NAME = new Map<string, McpToolDefinition>(MCP_TOOLS.map((tool) => [tool.name, tool]));

export function findTool(name: string): McpToolDefinition | undefined {
  return BY_NAME.get(name);
}

/** 权限位的人话（拒绝时给 agent 一句它能转述给用户的话） */
export function permLabel(bit: number): string {
  return MCP_PERM_LABELS[bit] ?? "该操作";
}

/** `tools/list` 的载荷（批 3 加写类工具时这里自动多几个） */
export function listToolsPayload(): Array<Record<string, unknown>> {
  return MCP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

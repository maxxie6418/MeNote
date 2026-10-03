/**
 * MCP 工具注册表（架构 §十一；设计 §五-3、§六）。
 *
 * ## Schema 是**构建期写死的常量**，不是运行时生成的
 *
 * 架构 §十一 明确「工具的 JSON Schema 在构建时生成静态常量，运行时不做 schema 编译」。
 * 少一层运行时编译 = 少一份冷启动开销，也少一类"生成结果随环境而变"的怪问题。
 *
 * ## 每个条目带一个权限位
 *
 * 权限位是**数据**而不是散在执行代码里的 `if`——`tools/call` 先查表拿位、判过再执行，
 * 于是"这个工具要什么权限"只有一处可查，加工具时也不可能漏。
 * 工具实现内部还会**再判一次**（`assertMcpPerm`）：注册表那一遍是给路由层的快路径，
 * 实现里那一遍留给"将来可能有别的调用方"。两遍判的不是同一件事。
 *
 * ## 这 11 个工具本身就是"哪些能力不开放"的结构性保证
 *
 * 设计 §17.6 砍掉的那些（附件 / 分享 / 备份 / 设置 / 文件夹与标签管理 / 批量操作）
 * **不靠逐条写禁止逻辑**，而是根本不在这张表里。加一条断言「注册表里每个工具名都在
 * 定稿的 11 个之内」，比维护一份禁止清单可靠——清单会被人漏改，工具名不会。
 */
import {
  MCP_PERM_CREATE,
  MCP_PERM_EDIT,
  MCP_PERM_LABELS,
  MCP_PERM_READ,
  MCP_PERM_TRASH,
  type McpToolName,
} from "@menote/shared";
import type { StorageEnv } from "../../types";
import type { McpPrincipal } from "./auth";
import { runListFolders, runListItems, runListVersions, runSearch } from "./tools-read";
import { runReadItem } from "./tools-read-item";
import { runAppendToItem, runCreateItem, runTrashItem } from "./tools-write";
import { runEditItem, runOrganizeItem } from "./tools-write-edit";
import { runEditTableRows } from "./tools-write-table";

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

  // ———————————————————————————————————————— 写类 6 个（批 3）

  {
    name: "create_item",
    description:
      "新建笔记、表格或 Memo。文件夹必须已存在（不自动创建），且须在令牌范围内。**必须带 operation_id**（重复调用靠它去重）。",
    perm: MCP_PERM_CREATE,
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["note", "table", "memo"] },
        title: { type: "string", description: "笔记与表格必填；Memo 不接受标题" },
        content: { type: "string", description: "正文（Markdown）" },
        folder_id: { type: "string", description: "目标文件夹；省略为根目录；Memo 不接受" },
        tags: { type: "array", items: { type: "string" } },
        task: {
          type: "object",
          description: "清单字段（Memo 可带）",
          properties: {
            status: { type: "string", enum: ["todo", "doing", "done"] },
            due: { type: "string" },
            priority: { type: "string", enum: ["high", "medium", "low"] },
          },
        },
        operation_id: { type: "string", description: "幂等 ID，重复调用返回同一结果" },
      },
      required: ["type", "content", "operation_id"],
    },
    run: runCreateItem,
  },
  {
    name: "append_to_item",
    description:
      "向笔记末尾或某小节末尾追加文字；对表格则追加若干行（按列名给值，行 ID 由服务端分配）。**必须带 operation_id**。追加不需要 expected_rev——服务端在最新版本上追加。",
    perm: MCP_PERM_CREATE,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        text: { type: "string", description: "追加到笔记的文字；表格模式不用这个参数" },
        section: { type: "string", description: "追加到某个小节末尾；省略则追加到文末" },
        rows: {
          type: "array",
          items: { type: "object", additionalProperties: true },
          description: "表格模式：每项是「列名 → 单元格值」",
        },
        operation_id: { type: "string" },
      },
      required: ["id", "operation_id"],
    },
    run: runAppendToItem,
  },
  {
    name: "edit_item",
    description:
      "修改正文。**必须带 expected_rev**（从 read_item 的结果里拿），冲突时返回当前 rev 并提示重新读取；`on_conflict: \"copy\"` 可改为生成冲突副本（不覆盖原条目）。修改前服务端会先封存当前稿，事后可在版本历史里撤回。",
    perm: MCP_PERM_EDIT,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        expected_rev: { type: "integer", description: "读到的 rev" },
        mode: {
          type: "string",
          enum: ["replace_text", "replace_section", "replace_all", "merge_properties", "restore_version"],
        },
        from: { type: "string", description: "replace_text：待替换文本（必须唯一出现）" },
        to: { type: "string", description: "replace_text：替换成什么" },
        section: { type: "string", description: "replace_section：目标小节标题" },
        content: { type: "string", description: "replace_section / replace_all：新内容" },
        properties: {
          type: "object",
          description: "merge_properties：YAML 属性（tags / task）",
          additionalProperties: true,
        },
        version_id: { type: "string", description: "restore_version：要恢复的版本 ID" },
        on_conflict: { type: "string", enum: ["copy"], description: "冲突时生成副本而不是报错" },
        operation_id: { type: "string", description: "可选（乐观锁已保证重试安全）" },
      },
      required: ["id", "expected_rev", "mode"],
    },
    run: runEditItem,
  },
  {
    name: "edit_table_rows",
    description:
      "按行 ID 更新或删除表格行。**必须带 expected_rev**。表格超过 256 KB 时请在应用中编辑。",
    perm: MCP_PERM_EDIT,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        expected_rev: { type: "integer" },
        updates: {
          type: "object",
          description: "行 ID → 「列名 → 单元格值」",
          additionalProperties: { type: "object", additionalProperties: true },
        },
        deletes: { type: "array", items: { type: "string" }, description: "要删的行 ID" },
        operation_id: { type: "string" },
      },
      required: ["id", "expected_rev"],
    },
    run: runEditTableRows,
  },
  {
    name: "organize_item",
    description:
      "移动到其他文件夹、改标题、增删标签、置顶收藏。**必须带 expected_meta_rev**。范围外的文件夹与加密空间都会被拒绝（MCP 不能改变内容的加密归属）。",
    perm: MCP_PERM_EDIT,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        expected_meta_rev: { type: "integer" },
        folder_id: { type: "string", description: "目标文件夹；省略表示不改" },
        title: { type: "string" },
        add_tags: { type: "array", items: { type: "string" } },
        remove_tags: { type: "array", items: { type: "string" } },
        pinned: { type: "boolean" },
        starred: { type: "boolean" },
      },
      required: ["id", "expected_meta_rev"],
    },
    run: runOrganizeItem,
  },
  {
    name: "trash_item",
    description:
      "移到回收站（**不提供永久删除**）。**必须带 expected_rev 与 operation_id**。该条目上已有的分享会同时失效。",
    perm: MCP_PERM_TRASH,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        expected_rev: { type: "integer" },
        operation_id: { type: "string" },
      },
      required: ["id", "expected_rev", "operation_id"],
    },
    run: runTrashItem,
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

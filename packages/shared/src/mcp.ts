/**
 * MCP（M17）的线上契约（架构 §十一 / 设计文档 §十七 / 功能拆解 M17）。
 *
 * 本文件只放**两端共用的形状与常量**：设置页要按它渲染与提交，服务端要按它校验，
 * 工具注册表的 JSON Schema 也要从这里的 valibot schema 同源派生（设计 §5.3）。
 *
 * 三条口径值得单独记住：
 * 1. **权限是位掩码，bit 0（只读）恒含**——它不是可选项，是所有令牌的前提；
 * 2. **完整令牌只在创建响应里出现一次**，此后任何接口只给 `token_prefix`；
 * 3. **凭据哈希的算法在 worker 侧**（`services/mcp/tokens.ts`），本包不碰密钥材料。
 */
import * as v from "valibot";
import { isUlid } from "./ulid";

/** 令牌字面量前缀。**它同时是哈希域分隔的一部分**——去掉它会让会话令牌与 MCP 令牌落进同一个哈希域 */
export const MCP_TOKEN_PREFIX = "mn_";

/** 令牌随机部分字节数（设计 §17.3：32 字节，高熵随机串用 SHA-256 即可，无需慢哈希） */
export const MCP_TOKEN_BYTES = 32;

/** 每个用户最多 20 个**有效**令牌（设计 §17.3；有效 = 未撤销且未过期） */
export const MCP_MAX_ACTIVE_TOKENS = 20;

/** 限速默认值与可调区间（设计 §17.3「默认每分钟 60 次调用（可调）」） */
export const MCP_DEFAULT_RATE_PER_MIN = 60;
export const MCP_RATE_PER_MIN_MAX = 600;

/** 令牌名称长度上限（界面有 maxlength，服务端同样校验——不靠 UI 守着） */
export const MCP_TOKEN_NAME_MAX = 64;

/** 权限位：只读 / 新建和追加 / 修改和移动 / 移到回收站（DDL 注释的位掩码） */
export const MCP_PERM_READ = 1;
export const MCP_PERM_CREATE = 2;
export const MCP_PERM_EDIT = 4;
export const MCP_PERM_TRASH = 8;
export const MCP_PERM_ALL = 15;

/** 权限位 → 中文标签（设置页与工具被拒时的提示共用一份） */
export const MCP_PERM_LABELS: Readonly<Record<number, string>> = {
  [MCP_PERM_READ]: "只读",
  [MCP_PERM_CREATE]: "新建和追加",
  [MCP_PERM_EDIT]: "修改和移动",
  [MCP_PERM_TRASH]: "移到回收站",
};

/**
 * 把任意合法掩码归一成「只读恒含」的形态。
 *
 * 客户端算位掩码很容易漏掉 bit 0（三个可勾选项都不勾就是 0），而 0 意味着
 * 「什么都干不了」——那不是用户想要的结果，只是算错了。归一而不是拒绝。
 */
export function normalizeMcpPerms(perms: number): number {
  return (perms & MCP_PERM_ALL) | MCP_PERM_READ;
}

export function hasMcpPerm(perms: number, bit: number): boolean {
  return (perms & bit) === bit;
}

const FlagSchema = v.pipe(v.number(), v.integer(), v.picklist([0, 1]));

/** 有效期：三个预设 + 自定义毫秒；`null` / 缺省 = 永不过期（设计 §17.3） */
export const MCP_EXPIRY_PRESETS = {
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
} as const;

export const McpExpirySchema = v.union([
  v.picklist(["7d", "30d", "90d"]),
  v.pipe(
    v.number(),
    v.integer(),
    v.minValue(60_000, "有效期至少 1 分钟"),
    v.maxValue(365 * 86_400_000, "有效期最长 365 天"),
  ),
]);

/** 令牌 ID（服务端生成 ULID；与条目 / 文件夹同一套） */
export const McpTokenIdSchema = v.pipe(v.string(), v.check(isUlid, "ID 格式不合法"));

/** POST /api/mcp/tokens：创建 */
export const CreateMcpTokenRequestSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, "名称必填"), v.maxLength(MCP_TOKEN_NAME_MAX)),
  perms: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MCP_PERM_ALL)),
  /** `null` = 全部内容；否则若干文件夹 ID（**含子文件夹**，服务端逐个校验归属） */
  folder_scope: v.optional(v.nullable(v.array(v.pipe(v.string(), v.check(isUlid, "ID 格式不合法"))))),
  include_memos: v.optional(FlagSchema),
  allow_url: v.optional(FlagSchema),
  rate_per_min: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MCP_RATE_PER_MIN_MAX)),
  ),
  expires_in: v.optional(v.nullable(McpExpirySchema)),
});
export type CreateMcpTokenRequest = v.InferOutput<typeof CreateMcpTokenRequestSchema>;

/**
 * 令牌记录（管理侧）。
 *
 * **没有任何凭据材料**——`token_hash` 不出服务端，完整令牌只在创建响应里给一次。
 * `folder_scope` 缺省 `null` 时服务端补成 `null`（不返回 `undefined`），前端不用判两种空。
 */
export const McpTokenRecordSchema = v.object({
  id: McpTokenIdSchema,
  name: v.string(),
  token_prefix: v.string(),
  perms: v.number(),
  folder_scope: v.nullable(v.array(v.string())),
  include_memos: v.pipe(v.number(), v.integer()),
  allow_url: v.pipe(v.number(), v.integer()),
  rate_per_min: v.pipe(v.number(), v.integer()),
  expires_at: v.nullable(v.number()),
  created_at: v.number(),
  last_used_at: v.nullable(v.number()),
  revoked_at: v.nullable(v.number()),
  /** 列表的「状态」列：撤销与过期都算失效，但**要分开显示**——两者的处置不一样 */
  status: v.picklist(["active", "revoked", "expired"]),
});
export type McpTokenRecord = v.InferOutput<typeof McpTokenRecordSchema>;

export const McpTokenListResponseSchema = v.object({ tokens: v.array(McpTokenRecordSchema) });
export type McpTokenListResponse = v.InferOutput<typeof McpTokenListResponseSchema>;

/** POST 的 201 响应：记录 + **仅此一次**的完整令牌 */
export const McpTokenCreatedSchema = v.object({
  token: McpTokenRecordSchema,
  secret: v.string(),
});
export type McpTokenCreated = v.InferOutput<typeof McpTokenCreatedSchema>;

/** 审计条目（只记写类工具的调用；设计 §七） */
export const McpAuditEntrySchema = v.object({
  id: v.pipe(v.string(), v.check(isUlid, "ID 格式不合法")),
  tool: v.string(),
  item_id: v.nullable(v.string()),
  rev_before: v.nullable(v.number()),
  rev_after: v.nullable(v.number()),
  result: v.picklist(["ok", "conflict", "denied", "error"]),
  operation_id: v.nullable(v.string()),
  at: v.number(),
});
export type McpAuditEntry = v.InferOutput<typeof McpAuditEntrySchema>;

export const McpAuditListResponseSchema = v.object({
  entries: v.array(McpAuditEntrySchema),
  next_cursor: v.nullable(v.string()),
});
export type McpAuditListResponse = v.InferOutput<typeof McpAuditListResponseSchema>;

/** 审计里的工具名全集（注册表与用例都断言「只出现这 11 个」，设计 §6.7-6） */
export const MCP_TOOL_NAMES = [
  "search",
  "list_folders",
  "list_items",
  "read_item",
  "list_versions",
  "create_item",
  "append_to_item",
  "edit_item",
  "edit_table_rows",
  "organize_item",
  "trash_item",
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/**
 * 有界读取的三个数（设计 §17.4）。
 *
 * 存在的理由是同一条：**别让 agent 一次把整库灌进上下文**。单条正文最大约 2 MB，
 * 而 Worker 每请求只有 10 ms CPU，整篇取回来再截既慢又占内存。
 */
export const MCP_READ_CHARS_DEFAULT = 8_000;
export const MCP_READ_CHARS_MAX = 20_000;

/** 列表与搜索每页最多多少条（设计 §17.4） */
export const MCP_PAGE_LIMIT_MAX = 50;

/** 搜索片段的形状：以命中处前 80 字符起、截 200 字符（设计 §17.4） */
export const MCP_SNIPPET = { chars: 200, lead: 80 } as const;

/**
 * 需要把正文取回 Worker 才能处理的门槛（设计 §17.4）。
 *
 * 超门槛的条目**不报错**，而是只给区间 / 游标读取——agent 仍能读大文件，
 * 只是不能按小节或按行操作。512 KB 对应架构 §十一 那条【待核实】（批 3 实测后定死）。
 */
export const MCP_SECTION_MAX_BYTES = 512 * 1024;

/** 单次写入内容上限（设计 §17.4） */
export const MCP_WRITE_MAX_BYTES = 256 * 1024;

/** 表格按行工具的门槛——比普通小节更严，因为解析整张表的代价是数量级的（设计 §17.4） */
export const MCP_TABLE_MAX_BYTES = 256 * 1024;

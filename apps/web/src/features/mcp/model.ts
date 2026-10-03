/**
 * 设置 › MCP 的纯函数（界面稿 §七；功能拆解 M17-01 / M17-02）。
 *
 * **这里只放纯函数**：格式、文案、选择算成什么样。组件只做展示与交互
 * （AGENTS.md「UI 只做展示和交互，复杂逻辑下沉到业务模块」）。
 *
 * 三条贯穿的口径：
 * 1. **相对时间自己算**（`formatRelative`，在 `app/format.ts`——M7 定时备份也要用，
 *    提上来免得备份 feature 反向依赖本 feature），不引依赖也不调 `Intl`——
 *    口径要能单测，也不能因为运行环境的 locale 变掉；
 * 2. **没勾的权限位不写出来**（`permissionSummary` 列"只读 · 新建和追加"而不是
 *    "未授予修改和移动"）；否定式表述又长又让人以为缺了什么；
 * 3. **加密空间不进范围候选**（`scopeCandidates` 整个空间子树排掉），不给一个
 *    必然被服务端拒的选项。
 */
import {
  MCP_MAX_ACTIVE_TOKENS,
  MCP_PERM_CREATE,
  MCP_PERM_EDIT,
  MCP_PERM_LABELS,
  MCP_PERM_READ,
  MCP_PERM_TRASH,
  hasMcpPerm,
  type McpTokenRecord,
} from "@menote/shared";
import { notebookFolders } from "../privacy/vault";
import type { LocalFolder } from "../../data/db/schema";

/** MCP 地址：固定的 `origin + /mcp`，**没有可配项**（设计稿 §二） */
export function buildMcpAddress(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/mcp`;
}

const DAY = 24 * 60 * 60_000;

/** 权限摘要：只列**已授予**的位（只读恒在，所以永远至少有它） */
export function permissionSummary(perms: number): string {
  const parts = [MCP_PERM_LABELS[MCP_PERM_READ]!];
  if (hasMcpPerm(perms, MCP_PERM_CREATE)) parts.push(MCP_PERM_LABELS[MCP_PERM_CREATE]!);
  if (hasMcpPerm(perms, MCP_PERM_EDIT)) parts.push(MCP_PERM_LABELS[MCP_PERM_EDIT]!);
  if (hasMcpPerm(perms, MCP_PERM_TRASH)) parts.push(MCP_PERM_LABELS[MCP_PERM_TRASH]!);
  return parts.join(" · ");
}

/** 范围摘要：只给数量，不在这里铺文件夹名（长了会把这一行撑爆） */
export function scopeSummary(folderScope: readonly string[] | null): string {
  if (folderScope === null) return "全部内容";
  return folderScope.length === 1 ? "1 个文件夹" : `${folderScope.length} 个文件夹`;
}

/** 有效期摘要；`now` 传进来而不是内部取 `Date.now()`，好让单测定死 */
export function expirySummary(expiresAt: number | null, now: number): string {
  if (expiresAt === null) return "永不过期";
  if (expiresAt <= now) return "已过期";
  const days = Math.max(1, Math.ceil((expiresAt - now) / DAY));
  if (days <= 45) return `${days} 天后过期`;
  return `${Math.round(days / 30)} 个月后过期`;
}

/** 状态胶囊的语义色。`Pill` 只有 `neutral` / `ok` / `busy` / `err` 四档（`Controls.tsx`） */
export type Tone = "neutral" | "ok" | "busy" | "err";

/** 状态胶囊的文案 + 语义色：撤销优先于过期（都失效时先告诉用户"是你撤的"） */
export function tokenStatus(token: Pick<McpTokenRecord, "status">): { label: string; tone: Tone } {
  if (token.status === "revoked") return { label: "已撤销", tone: "neutral" };
  // 过期标成"需留意"而不是"出错"：它没坏，只是到期了，用户通常要清理
  if (token.status === "expired") return { label: "已过期", tone: "busy" };
  return { label: "生效中", tone: "ok" };
}

/** 有效令牌数（上限判定；服务端 409 也是同一口径） */
export function activeTokenCount(tokens: readonly McpTokenRecord[]): number {
  return tokens.filter((token) => token.status === "active").length;
}

export function isTokenLimitReached(tokens: readonly McpTokenRecord[]): boolean {
  return activeTokenCount(tokens) >= MCP_MAX_ACTIVE_TOKENS;
}

/** 达上限时禁用「创建令牌」要给出的**可见**原因（DESIGN.md §6.1：禁用必须说明为何） */
export function tokenLimitHint(): string {
  return `已达 ${MCP_MAX_ACTIVE_TOKENS} 个上限，撤销一个后才能新建`;
}

// ———————————————————————————————————————— 创建弹窗的选项

export type McpExpiryChoice = "7d" | "30d" | "90d" | "custom" | "never";

export const MCP_EXPIRY_CHOICES: ReadonlyArray<{ id: McpExpiryChoice; label: string }> = [
  { id: "7d", label: "7 天" },
  { id: "30d", label: "30 天" },
  { id: "90d", label: "90 天" },
  { id: "custom", label: "自定义" },
  { id: "never", label: "永不过期" },
];

/** 有效期选择 → 提交给服务端的 `expires_in`（预设字符串 / 自定义毫秒 / null） */
export function expiryPayload(
  choice: McpExpiryChoice,
  customDate: string,
): "7d" | "30d" | "90d" | number | null {
  if (choice === "never") return null;
  if (choice === "custom") {
    const at = Date.parse(`${customDate}T23:59:59`);
    return Number.isFinite(at) ? Math.max(1, at - Date.now()) : null;
  }
  return choice;
}

/** 自定义日期是否已填（就地校验，不禁用提交按钮） */
export function customDateMissing(choice: McpExpiryChoice, customDate: string): boolean {
  return choice === "custom" && customDate.trim() === "";
}

/** 范围候选：**只列顶层**，勾选自动含子文件夹（界面稿 §九-3 用户 2026-10-03 拍板） */
export interface ScopeCandidate {
  id: string;
  name: string;
  /** 直接子文件夹数量，帮用户认出「工作（3）」是三个子夹 */
  childCount: number;
}

export function scopeCandidates(folders: readonly LocalFolder[]): ScopeCandidate[] {
  return notebookFolders(folders)
    .filter((folder) => folder.depth === 1)
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      childCount: notebookFolders(folders).filter((child) => child.parent_id === folder.id).length,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

// ———————————————————————————————————————— 审计

/** 工具名 → 中文。给 agent 侧的名字放 `ⓘ`（界面稿 §五） */
const TOOL_LABELS: Readonly<Record<string, string>> = {
  create_item: "新建",
  append_to_item: "追加",
  edit_item: "修改正文",
  edit_table_rows: "改表格行",
  organize_item: "整理",
  trash_item: "移到回收站",
};

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

export type AuditTone = Tone;

/**
 * 审计结果 → 文案 + 语义色。
 *
 * `denied` 用 `err`：它正是「agent 越权尝试」的证据，值得显眼——
 * 审查看的就是"这枚令牌有没有在干不该干的事"。
 */
export function auditResultLabel(result: string): { label: string; tone: AuditTone } {
  if (result === "ok") return { label: "成功", tone: "ok" };
  if (result === "conflict") return { label: "版本冲突", tone: "busy" };
  if (result === "denied") return { label: "被拒绝", tone: "err" };
  return { label: "出错", tone: "err" };
}

/** 条目标题取不到时给的说法：不给链接也不给 id（内部标识不是给人操作的东西） */
export const GONE_ITEM_LABEL = "已不存在的条目";

/** 审计时间：绝对时刻（审计要能对照事件发生的时间，模糊的"3 天前"没法用） */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 0006 MCP 三表（M6 第三块；DDL 权威 = `wiki/Menote-设计文档-v7.4.md` §DDL MCP 段，
 * 口径见 `docs/modules/Menote-M6-MCP-设计-v1.md` §二）。
 *
 * 与 0001–0005 同样的两条硬约束：每条语句必须**单行**（D1 的 batch 按语句执行）、必须幂等（`IF NOT EXISTS`）。
 *
 * **相对定稿 DDL 只加了四样，全是"让实现不必绕路"，没有改任何一列的语义**：
 * 1. `api_tokens.rate_window_start` / `rate_call_count` —— 限速计数**落在令牌行上**，
 *    不另建 `rate_counters` 表（设计 §3.5；定稿原写"优先 Workers Rate Limiting 绑定，
 *    不可用时用 D1 分钟窗口计数"，用户 2026-10-03 拍板直接用 D1）。好处是令牌查询那次读
 *    本来就要做，计数与 `last_used_at` 能合并成同一条 `UPDATE`。
 * 2. 四个 CHECK 约束（`perms` 位掩码范围、`include_memos` / `allow_url` 的 0/1、`result` 枚举）。
 *    0001/0004 每张表都带 CHECK，这是本仓库的一贯做法；`result` 那条尤其值——
 *    它把批 3 里"审计结果写错一个字"从静默的错值变成当场报错。
 *    ⚠️ 注意 `include_memos` 的**列默认值仍是定稿的 1**，与功能拆解 M17-03「默认不勾选＝不可见」
 *    相反。代码里**一律显式写入**、不依赖这个默认值（设计 §1.3）。
 */
import type { MigrationScript } from "./0001_init";

export const migration0006: MigrationScript = {
  version: 6,
  statements: [
    // —— 1 令牌 ——
    "CREATE TABLE IF NOT EXISTS api_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, token_hash BLOB NOT NULL UNIQUE, token_prefix TEXT NOT NULL, perms INTEGER NOT NULL CHECK (perms > 0 AND perms <= 15), folder_scope TEXT, include_memos INTEGER NOT NULL DEFAULT 1 CHECK (include_memos IN (0,1)), allow_url INTEGER NOT NULL DEFAULT 0 CHECK (allow_url IN (0,1)), rate_per_min INTEGER NOT NULL DEFAULT 60, rate_window_start INTEGER, rate_call_count INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER)",
    "CREATE INDEX IF NOT EXISTS idx_tokens_user ON api_tokens(user_id)",
    // —— 2 审计（仅记写操作，保留 90 天）——
    "CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_id TEXT, tool TEXT NOT NULL, item_id TEXT, rev_before INTEGER, rev_after INTEGER, result TEXT NOT NULL CHECK (result IN ('ok','conflict','denied','error')), operation_id TEXT, at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_audit_token ON audit_log(user_id, token_id, at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at)",
    // —— 3 幂等记录（保留 7 天）——
    "CREATE TABLE IF NOT EXISTS mcp_operations (user_id TEXT NOT NULL, operation_id TEXT NOT NULL, tool TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, operation_id))",
    "CREATE INDEX IF NOT EXISTS idx_ops_created ON mcp_operations(created_at)",
  ],
};

/** 0006 建立的表（selfheal 的完整性校验与测试都用它，避免两处各写一份） */
export const M6_MCP_TABLE_NAMES = ["api_tokens", "audit_log", "mcp_operations"] as const;

/** 0006 建立的索引（逐条登记：索引不计入校验会漏配，与 0001 的写法一致） */
export const M6_MCP_INDEX_NAMES = [
  "idx_tokens_user",
  "idx_audit_token",
  "idx_audit_at",
  "idx_ops_created",
] as const;

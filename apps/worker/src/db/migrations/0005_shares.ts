/**
 * 0005 分享两表（M5-S1；DDL 权威 = `wiki/Menote-设计文档-v7.4.md` §DDL 分享段，
 * 《数据模型与迁移设计》标记 `shares` / `share_items` 属 M5）。
 *
 * 与 0001–0004 同样的两条硬约束：每条语句必须**单行**、必须幂等（`IF NOT EXISTS`）。
 *
 * **首期只接 `kind = 'item'`**（单篇：笔记 / 表格 / 单条 Memo；用户 2026-10-02 拍板
 * Memo 固定合集后置）；`memo_set` 的枚举值与 `share_items` 表随本迁移一起建好——
 * 合集开工时零迁移，`share_items` 的"创建时固定成员"语义见 M14-02 定稿。
 *
 * 密码材料三列（`pw_salt` / `pw_kdf` / `pw_verifier`）对齐认证思路：慢哈希只在浏览器做，
 * 服务端只存盐与校验值、比对用 HMAC；凭据材料**任何接口不回显**。
 */
import type { MigrationScript } from "./0001_init";

export const migration0005: MigrationScript = {
  version: 5,
  statements: [
    "CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('item','memo_set')), item_id TEXT, title TEXT, pw_salt BLOB, pw_kdf TEXT, pw_verifier BLOB, expires_at INTEGER, created_at INTEGER NOT NULL, revoked_at INTEGER)",
    "CREATE INDEX IF NOT EXISTS idx_shares_item ON shares(item_id)",
    "CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id)",
    "CREATE TABLE IF NOT EXISTS share_items (share_id TEXT NOT NULL, item_id TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (share_id, item_id))",
    "CREATE INDEX IF NOT EXISTS idx_share_items_item ON share_items(item_id)",
  ],
};

/** 0005 建立的表与索引（selfheal 完整性校验与测试都用它，避免两处各写一份） */
export const M5_SHARE_TABLE_NAMES = ["shares", "share_items"] as const;
export const M5_SHARE_INDEX_NAMES = [
  "idx_shares_item",
  "idx_shares_user",
  "idx_share_items_item",
] as const;

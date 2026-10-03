/**
 * 0007 外部备份目标 + 变更队列（M7 第 4 项；设计 §三）。
 *
 * 与 0001–0006 同样的两条硬约束：每条语句**单行**、必须幂等（`IF NOT EXISTS`）。
 *
 * ## 两张表分工
 *
 * - **`user_backup_targets`**：用户配置的外部目标（WebDAV / S3）。**凭据用备份包裹键
 *   AES-GCM 加密**（`secret_wrapped`），不新增密钥材料——内容密钥 K 的备份包裹键
 *   M3 起就有了（`user_crypto.k_wrapped_backup`）。
 * - **`export_queue`**：**变更队列**（带版本校验）。M4 只在 Cron 里留了一行
 *   「③ 快照队列【接口位】」的占位，**表却一直没建**——《数据模型与迁移设计》§3.4 的
 *   表清单里列过它，迁移里没有它。本迁移补上，快照物化按 `rev` 条件出队。
 *
 * ## `kind` 的 CHECK 只放 webdav / s3
 *
 * Git 是定稿里列过的第三种（设计 §二 的流水线有"Git 目标最后 commit()"），
 * 但**首期不做**（用户 2026-10-03 拍板：tree/commit 编排最重、价值面窄）。
 * CHECK 里放它等于宣告"已支持"而实际没有——不如不放，等真要做时改 CHECK 是一次迁移。
 */
import type { MigrationScript } from "./0001_init";

export const migration0007: MigrationScript = {
  version: 7,
  statements: [
    "CREATE TABLE IF NOT EXISTS user_backup_targets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('webdav','s3')), label TEXT NOT NULL, endpoint TEXT NOT NULL, bucket TEXT, region TEXT, username TEXT, secret_wrapped BLOB NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)), delete_policy TEXT NOT NULL DEFAULT 'append_only' CHECK (delete_policy IN ('sync','append_only')), schedule TEXT NOT NULL DEFAULT 'daily' CHECK (schedule IN ('daily','weekly')), cursor_seq INTEGER NOT NULL DEFAULT 0, last_run_at INTEGER, last_result TEXT CHECK (last_result IN ('ok','partial','failed')), last_error TEXT, created_at INTEGER NOT NULL)",
    // 列目标：按启用状态 + 游标扫。索引前缀是 user_id（多租户隔离是硬要求，架构 §13.2）
    "CREATE INDEX IF NOT EXISTS idx_backup_targets_user ON user_backup_targets(user_id, enabled)",
    "CREATE TABLE IF NOT EXISTS export_queue (user_id TEXT NOT NULL, key TEXT NOT NULL, rev INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, key))",
    "CREATE INDEX IF NOT EXISTS idx_export_queue_created ON export_queue(created_at)",
  ],
};

/** 0007 建立的表（selfheal 的完整性校验与测试共用，避免两处各写一份） */
export const M7_BACKUP_TABLE_NAMES = ["user_backup_targets", "export_queue"] as const;

/** 0007 建立的索引（逐条登记：索引不计入校验会漏配） */
export const M7_BACKUP_INDEX_NAMES = ["idx_backup_targets_user", "idx_export_queue_created"] as const;

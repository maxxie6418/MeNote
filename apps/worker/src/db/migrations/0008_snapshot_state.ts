/**
 * 0008 快照物化游标（M7 第 4 项 批 2；架构 §12.4）。
 *
 * ## 为什么要有这张表
 *
 * 快照**不能每轮全量重写**。Cron 触发器是每 15 分钟一次（一天 96 轮），
 * 一个 500 条目的库全量重写就是每天 4.8 万次 R2 写——免费额度扛不住，而且 99% 的轮次什么也没变。
 * 所以物化是**增量的**：只处理 `sync_seq` 落在游标之后的条目，**游标存在这张表**。
 *
 * ## 为什么游标不写在 `user_crypto` / `users` 上
 *
 * 那两张都是 M1–M3 的定稿表，加列要改既有 DDL；而"快照推到哪了"是 M7 才有的状态。
 * 单开一张一行的小表最省事，也让自愈建表（`selfheal.ts`）多一个可校验的名字。
 *
 * **不存"最后跑了什么"，只存游标**：状态性信息（最近结果 / 失败原因）在目标行上，
 * 这里只管"哪些条目还没进快照"。
 */
import type { MigrationScript } from "./0001_init";

export const migration0008: MigrationScript = {
  version: 8,
  statements: [
    "CREATE TABLE IF NOT EXISTS user_snapshot_state (user_id TEXT PRIMARY KEY, cursor_seq INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)",
  ],
};

/** 0008 建立的表（selfheal 的完整性校验与测试共用，避免两处各写一份） */
export const M7_SNAPSHOT_TABLE_NAMES = ["user_snapshot_state"] as const;

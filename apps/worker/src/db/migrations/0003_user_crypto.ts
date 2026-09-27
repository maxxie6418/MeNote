/**
 * 0003 隐私锁的门禁材料表（`user_crypto`）。
 *
 * 权威定义 = `docs/modules/Menote-隐私锁设计-v1.md` §4.1：**只存门禁校验块与内容密钥 K 的两份包裹**，
 * 不加密任何内容（内容是明文存储，见该设计 §1 的 P1）。BLOB 的打包约定：
 * `版本(1B) || IV(12B) || 密文 || GCM 标签(16B)`。
 *
 * 与 0001 同样的两条硬约束：每条语句必须**单行**（D1 的 exec/batch 按语句执行，多行 DDL 会被切坏）、
 * 必须幂等（`IF NOT EXISTS`，迁移失败后会被重跑）。
 *
 * **不加 `sync_seq`**：门禁材料走专用端点（`GET/PUT /api/crypto`），不参与普通同步载荷——
 * 这是《同步引擎设计》§7 第 6 条的结论。
 */
import type { MigrationScript } from "./0001_init";

export const migration0003: MigrationScript = {
  version: 3,
  statements: [
    "CREATE TABLE IF NOT EXISTS user_crypto (user_id TEXT PRIMARY KEY, kdf TEXT NOT NULL CHECK (kdf IN ('PBKDF2-SHA-256')), kdf_iterations INTEGER NOT NULL CHECK (kdf_iterations BETWEEN 100000 AND 2000000), kdf_salt BLOB NOT NULL, verifier BLOB NOT NULL, k_wrapped_pw BLOB NOT NULL, k_wrapped_backup BLOB NOT NULL, rev INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  ],
};

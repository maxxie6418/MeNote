/**
 * 0002 任务字段的字面量约束（M2-5；语义见功能拆解 M07-03，口径见数据模型稿 §六 #1）。
 *
 * **为什么用触发器而不是给 `items` 补 CHECK**：SQLite 不支持 `ALTER TABLE ... ADD CONSTRAINT`，
 * 补 CHECK 只能**重建整张表**（复制数据 → 删表 → 改名 → 重建索引与外键），对一张已有生产数据的
 * 热表来说风险和收益不成比例。触发器用 `CREATE TRIGGER IF NOT EXISTS` 就能**幂等追加**，
 * 不动表结构、不迁数据、失败可回退，约束效果与 CHECK 等价（违反即 `RAISE(ABORT)`）。
 *
 * 约束内容（写入用英文，读取兼容中文只发生在客户端）：
 * - `task_status` 只能是 `todo` / `doing` / `done` 或 NULL；
 * - `task_priority` 只能是 `high` / `medium` / `low` 或 NULL；
 * - `is_task = 0` 时三个任务字段必须为空（避免"没有清单标记却带状态"的脏数据）。
 *
 * 与 0001 同样的两条硬约束：**每条语句单行**（D1 的 `exec()` 按换行切分），且幂等。
 * 触发器同时覆盖 INSERT 与 UPDATE 两条路径。
 */
import type { MigrationScript } from "./0001_init";

/** 任务状态字面量（与 `@menote/mdcore` 的 TASK_STATUSES 一致） */
const STATUSES = "'todo','doing','done'";
/** 任务优先级字面量（与 `@menote/mdcore` 的 TASK_PRIORITIES 一致） */
const PRIORITIES = "'high','medium','low'";

/** 触发器名（`selfheal.ts` 的完整性检查也用它） */
export const TASK_TRIGGER_NAMES = [
  "trg_items_task_status_insert",
  "trg_items_task_status_update",
  "trg_items_task_priority_insert",
  "trg_items_task_priority_update",
  "trg_items_task_flag_insert",
  "trg_items_task_flag_update",
] as const;

export const migration0002: MigrationScript = {
  version: 2,
  statements: [
    `CREATE TRIGGER IF NOT EXISTS trg_items_task_status_insert BEFORE INSERT ON items WHEN NEW.task_status IS NOT NULL AND NEW.task_status NOT IN (${STATUSES}) BEGIN SELECT RAISE(ABORT, 'invalid task_status'); END`,
    `CREATE TRIGGER IF NOT EXISTS trg_items_task_status_update BEFORE UPDATE OF task_status ON items WHEN NEW.task_status IS NOT NULL AND NEW.task_status NOT IN (${STATUSES}) BEGIN SELECT RAISE(ABORT, 'invalid task_status'); END`,
    `CREATE TRIGGER IF NOT EXISTS trg_items_task_priority_insert BEFORE INSERT ON items WHEN NEW.task_priority IS NOT NULL AND NEW.task_priority NOT IN (${PRIORITIES}) BEGIN SELECT RAISE(ABORT, 'invalid task_priority'); END`,
    `CREATE TRIGGER IF NOT EXISTS trg_items_task_priority_update BEFORE UPDATE OF task_priority ON items WHEN NEW.task_priority IS NOT NULL AND NEW.task_priority NOT IN (${PRIORITIES}) BEGIN SELECT RAISE(ABORT, 'invalid task_priority'); END`,
    "CREATE TRIGGER IF NOT EXISTS trg_items_task_flag_insert BEFORE INSERT ON items WHEN NEW.is_task = 0 AND (NEW.task_status IS NOT NULL OR NEW.task_due IS NOT NULL OR NEW.task_priority IS NOT NULL) BEGIN SELECT RAISE(ABORT, 'task fields require is_task=1'); END",
    "CREATE TRIGGER IF NOT EXISTS trg_items_task_flag_update BEFORE UPDATE ON items WHEN NEW.is_task = 0 AND (NEW.task_status IS NOT NULL OR NEW.task_due IS NOT NULL OR NEW.task_priority IS NOT NULL) BEGIN SELECT RAISE(ABORT, 'task fields require is_task=1'); END",
  ],
};

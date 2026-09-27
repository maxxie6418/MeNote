/**
 * 回收站（M4-6；《M4 设计》§5.1 / §5.2）。
 *
 * 三条语义要点：
 * 1. **软删 = 置 `deleted_at`**，`meta_rev + 1`、`rev` 不变——正文与版本都不动，
 *    所以"从回收站恢复"是零成本的（这也是当初把删除整体推到 M4 的原因：没有回收站的删除不可逆）。
 * 2. **恢复回原位置**：原文件夹还在（且没被删）就回去，否则回**根目录**；
 *    恢复**不自动恢复分享**（分享在 M5；这里只留接口位）。
 * 3. **永久删除 = 一个 D1 batch**：删条目 + 正文 + 附件引用 + 版本（`r2_key` 登记 `r2_gc_queue`）
 *    + **写墓碑**，整批**共享同一个 `sync_seq`**（一次逻辑写只推一个序号）。R2 对象不当场删，
 *    交给 Cron 按队列删——这样"删错了"在 GC 窗口内还有救，也不会让请求卡在对象存储上。
 *
 * 语句数预算：单批 10 条时共 7 条语句（见 `PERMANENT_DELETE_BATCH` 与 `permanentDeleteItems`），
 * 远在 D1 的 45 条以内；客户端按每批 10 条分请求。
 */
import { ATTACHMENT_ORPHAN_RETENTION_DAYS, DAY_MS, PERMANENT_DELETE_BATCH } from "@menote/shared";
import { DomainError } from "../errors";

export interface TrashResult {
  id: string;
  meta_rev: number;
  deleted_at: number | null;
  /** 恢复后实际落到的文件夹（`null` = 根目录）——原文件夹没了就会被挪到根 */
  folder_id: string | null;
}

export interface PermanentDeleteResult {
  /** 真正删掉的条目数（不存在或不属于该用户的不会计入） */
  deleted: number;
  /** 这一批墓碑共享的序号 */
  sync_seq: number;
}

/** 把 id 列表拼成 `?, ?, ?`（列名与 id 值一律不由请求决定，只有占位符个数随入参变） */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/**
 * 软删（移入回收站）。
 *
 * 已经在回收站里的条目**不再重复写**：否则每点一次删除都会推进 `sync_seq`，
 * 让别的设备白拉一轮。
 */
export async function softDeleteItem(
  db: D1Database,
  userId: string,
  itemId: string,
  now: number,
): Promise<TrashResult> {
  await db.batch([
    db
      .prepare(
        `UPDATE items SET deleted_at = ?, meta_rev = meta_rev + 1, updated_at = ?,
           sync_seq = (SELECT sync_seq + 1 FROM users WHERE id = ?)
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      )
      .bind(now, now, userId, itemId, userId),
    db
      .prepare(
        `UPDATE users SET sync_seq = sync_seq + 1
         WHERE id = ? AND EXISTS (SELECT 1 FROM items WHERE id = ? AND user_id = ? AND deleted_at = ?)`,
      )
      .bind(userId, itemId, userId, now),
  ]);

  const row = await db
    .prepare("SELECT meta_rev, deleted_at, folder_id FROM items WHERE id = ? AND user_id = ?")
    .bind(itemId, userId)
    .first<{ meta_rev: number; deleted_at: number | null; folder_id: string | null }>();
  if (!row) throw new DomainError("not_found", "条目不存在");

  return { id: itemId, meta_rev: row.meta_rev, deleted_at: row.deleted_at, folder_id: row.folder_id };
}

/**
 * 恢复。
 *
 * 原文件夹的判定用 `NOT EXISTS (SELECT 1 FROM folders WHERE ... deleted_at IS NULL)`：
 * 文件夹被删或已被永久删除时，**回根目录**（设计 §5.1 的 Q12 定案）。
 * 注意 `folder_id` 的目标值由 SQL 自己算，不由客户端给——恢复不该能改位置。
 */
export async function restoreItem(
  db: D1Database,
  userId: string,
  itemId: string,
  now: number,
): Promise<TrashResult> {
  await db.batch([
    db
      .prepare(
        `UPDATE items SET
           folder_id = (SELECT CASE
             WHEN i.folder_id IS NULL THEN NULL
             WHEN f.id IS NOT NULL THEN i.folder_id
             ELSE NULL END
             FROM items i LEFT JOIN folders f
               ON f.id = i.folder_id AND f.user_id = i.user_id AND f.deleted_at IS NULL
             WHERE i.id = ? AND i.user_id = ?),
           deleted_at = NULL, meta_rev = meta_rev + 1, updated_at = ?,
           sync_seq = (SELECT sync_seq + 1 FROM users WHERE id = ?)
         WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL`,
      )
      .bind(itemId, userId, now, userId, itemId, userId),
    db
      .prepare(
        `UPDATE users SET sync_seq = sync_seq + 1
         WHERE id = ? AND EXISTS (SELECT 1 FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NULL)`,
      )
      .bind(userId, itemId, userId),
  ]);

  const row = await db
    .prepare("SELECT meta_rev, deleted_at, folder_id FROM items WHERE id = ? AND user_id = ?")
    .bind(itemId, userId)
    .first<{ meta_rev: number; deleted_at: number | null; folder_id: string | null }>();
  if (!row) throw new DomainError("not_found", "条目不存在");

  return { id: itemId, meta_rev: row.meta_rev, deleted_at: row.deleted_at, folder_id: row.folder_id };
}

/**
 * 永久删除一批（**单批最多 10 条**）。
 *
 * 七条语句，次序刻意如此：
 * 1. 写墓碑（同一批共享一个 `sync_seq`：`SELECT sync_seq + 1 FROM users` 内联进语句）；
 * 2. 推进计数器（守卫 = 墓碑确实写进去了，避免重放时白推）；
 * 3. 版本正文的 R2 键进 GC 队列（**先登记再删元数据**：反过来的话键就找不回来了）；
 * 4. 删附件引用；5. 删版本元数据；6. 删正文；7. 删条目本体。
 *
 * 附件**不在这里删**（设计 §5.2）：可能还有别的条目/版本引用它，交给每日维护的孤儿流程。
 */
export async function permanentDeleteItems(
  db: D1Database,
  userId: string,
  ids: readonly string[],
  now: number,
): Promise<PermanentDeleteResult> {
  if (ids.length === 0) return { deleted: 0, sync_seq: 0 };
  if (ids.length > PERMANENT_DELETE_BATCH) {
    throw new DomainError("too_large", `单次最多永久删除 ${PERMANENT_DELETE_BATCH} 条，请分批提交`);
  }

  const slots = placeholders(ids.length);
  const dueAt = now + ATTACHMENT_ORPHAN_RETENTION_DAYS * DAY_MS;

  const seqRow = await db
    .prepare("SELECT sync_seq + 1 AS next FROM users WHERE id = ?")
    .bind(userId)
    .first<{ next: number }>();
  const syncSeq = seqRow?.next ?? 1;

  const statements = [
    // 1 墓碑：整批同一个 sync_seq；同一实体再次被永久删除时更新到新序号（否则第二次传不出去）
    db
      .prepare(
        `INSERT INTO tombstones (user_id, entity, entity_id, sync_seq, deleted_at)
         SELECT ?, 'item', i.id, ?, ? FROM items i WHERE i.user_id = ? AND i.id IN (${slots})
         ON CONFLICT (user_id, entity, entity_id)
         DO UPDATE SET sync_seq = excluded.sync_seq, deleted_at = excluded.deleted_at`,
      )
      .bind(userId, syncSeq, now, userId, ...ids),
    // 2 计数器：只有墓碑真的写了才推
    db
      .prepare(
        `UPDATE users SET sync_seq = sync_seq + 1
         WHERE id = ? AND EXISTS (SELECT 1 FROM tombstones WHERE user_id = ? AND sync_seq = ? AND deleted_at = ?)`,
      )
      .bind(userId, userId, syncSeq, now),
    // 3 版本正文的 R2 键进待删队列（用 INSERT OR IGNORE：同一把键可能已被登记过，别让整批失败）
    db
      .prepare(
        `INSERT OR IGNORE INTO r2_gc_queue (r2_key, user_id, reason, due_at, created_at)
         SELECT r2_key, user_id, 'delete', ?, ? FROM item_versions
         WHERE user_id = ? AND item_id IN (${slots})`,
      )
      .bind(dueAt, now, userId, ...ids),
    // 4 附件引用（**经 items 子查询限定归属**：这两张表没有 user_id 列，直接按 id 删会跨租户）
    db
      .prepare(
        `DELETE FROM attachment_refs WHERE item_id IN (
           SELECT id FROM items WHERE user_id = ? AND id IN (${slots})
         )`,
      )
      .bind(userId, ...ids),
    // 5 版本元数据
    db
      .prepare(`DELETE FROM item_versions WHERE user_id = ? AND item_id IN (${slots})`)
      .bind(userId, ...ids),
    // 6 正文（同样经 items 子查询限定归属）
    db
      .prepare(
        `DELETE FROM item_bodies WHERE item_id IN (
           SELECT id FROM items WHERE user_id = ? AND id IN (${slots})
         )`,
      )
      .bind(userId, ...ids),
    // 7 条目本体（带 user_id：不能删别人的）
    db
      .prepare(`DELETE FROM items WHERE user_id = ? AND id IN (${slots})`)
      .bind(userId, ...ids),
  ];

  const results = await db.batch(statements);
  // 最后一条是删条目本体，它的 changes 就是真正删掉的行数
  const deleted = results[results.length - 1]?.meta.changes ?? 0;

  return { deleted, sync_seq: syncSeq };
}

/**
 * 清空回收站：把当前所有软删条目按 `PERMANENT_DELETE_BATCH` 分批永久删除。
 *
 * 每批一个 batch（各自推进 `sync_seq`），返回总删除数。**只删回收站里的**（`deleted_at IS NOT NULL`）。
 */
export async function emptyTrash(
  db: D1Database,
  userId: string,
  now: number,
): Promise<{ deleted: number; batches: number }> {
  let deleted = 0;
  let batches = 0;

  for (let round = 0; round < 100; round += 1) {
    const rows = await db
      .prepare(
        "SELECT id FROM items WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at ASC LIMIT ?",
      )
      .bind(userId, PERMANENT_DELETE_BATCH)
      .all<{ id: string }>();
    const ids = rows.results.map((row) => row.id);
    if (ids.length === 0) break;

    const result = await permanentDeleteItems(db, userId, ids, now);
    deleted += result.deleted;
    batches += 1;
  }

  return { deleted, batches };
}

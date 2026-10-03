/**
 * 永久删除（M4-6；批 3 增第 9 步的外部备份记账）。
 *
 * ## 为什么从 `services/trash.ts` 拆出来
 *
 * 软删 / 恢复是**单条语义**（挪进回收站、放回原位置），永久删除是**一批语句的事务**
 * ——两者凑在一个文件里会让那个文件顶到 `max-lines` 的 300 行软上限
 * （`trash.ts` 加了这 9 行之后是 306，lint 会报 warning）。拆开也顺带把职责说清了。
 *
 * ## 三件事，一件 D1 batch
 *
 * 1. **写墓碑**（同一批共享一个 `sync_seq`：`SELECT sync_seq + 1 FROM users` 内联进语句）；
 * 2. **推进计数器**（守卫 = 墓碑确实写进去了，避免重放时白推）；
 * 3. **版本正文的 R2 键进 GC 队列**（**先登记再删元数据**：反过来的话键就找不回来了）；
 *    然后删附件引用、版本元数据、正文、条目本体。
 *
 * **文件夹**（2026-09-27 按用户拍板加入）：同样写墓碑（`entity = 'folder'`，与本批共用一个
 * `sync_seq`）再删 `folders` 行。**不动它的子项**——被删文件夹的内容与子文件夹本来就在回收站里，
 * 各自按本条链路处理；恢复"父夹已不存在"的子项时服务端会把它放回根目录（`restoreItem` /
 * `restoreFolder` 的父夹判定）。
 *
 * 附件**不在这里删**（设计 §5.2）：可能还有别的条目/版本引用它，交给每日维护的孤儿流程。
 *
 * ## 语句数预算
 *
 * 单批 10 条时共 **10 条语句**（`trash.test.ts` 有用例钉住 ≤45），远在 D1 的上限内；
 * 客户端按每批 10 条分请求。第 9 步（外部备份的删除记账）是 M7 第 4 项 批 3 加的。
 */
import { ATTACHMENT_ORPHAN_RETENTION_DAYS, DAY_MS, PERMANENT_DELETE_BATCH } from "@menote/shared";
import { DomainError } from "../errors";
import { lookupRemoteDeletionKeys, prepareRemoteDeletionEnqueue } from "./backup-targets";

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
    // 1 墓碑（条目）：整批同一个 sync_seq；同一实体再次被永久删除时更新到新序号（否则第二次传不出去）
    db
      .prepare(
        `INSERT INTO tombstones (user_id, entity, entity_id, sync_seq, deleted_at)
         SELECT ?, 'item', i.id, ?, ? FROM items i WHERE i.user_id = ? AND i.id IN (${slots})
         ON CONFLICT (user_id, entity, entity_id)
         DO UPDATE SET sync_seq = excluded.sync_seq, deleted_at = excluded.deleted_at`,
      )
      .bind(userId, syncSeq, now, userId, ...ids),
    // 1b 墓碑（文件夹）：同一个 sync_seq 与同一条计数器语句，所以两边的序号天然一致
    db
      .prepare(
        `INSERT INTO tombstones (user_id, entity, entity_id, sync_seq, deleted_at)
         SELECT ?, 'folder', f.id, ?, ? FROM folders f WHERE f.user_id = ? AND f.id IN (${slots})
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
    // 8 文件夹本体（同样带 user_id）
    db
      .prepare(`DELETE FROM folders WHERE user_id = ? AND id IN (${slots})`)
      .bind(userId, ...ids),
  ];

  // 9 外部备份的「这个路径没了」记账（M7 第 4 项 批 3）。**查在删除前、写排在删除后**：
  //    查要知道哪些 id 真的存在，写必须与删除同处一个 batch（要么都成、要么都不成）
  const deletionEnqueue = prepareRemoteDeletionEnqueue(
    db,
    userId,
    await lookupRemoteDeletionKeys(db, userId, ids),
    now,
  );
  if (deletionEnqueue !== null) statements.push(deletionEnqueue);

  const results = await db.batch(statements);
  // 条目本体与文件夹本体各一条（索引 7 / 8）：真正删掉的行数是两者之和
  const deletedItems = results[7]?.meta.changes ?? 0;
  const deletedFolders = results[8]?.meta.changes ?? 0;

  return { deleted: deletedItems + deletedFolders, sync_seq: syncSeq };
}

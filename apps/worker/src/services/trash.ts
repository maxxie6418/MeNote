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
 * 永久删除那 10 条语句住在 `services/trash-purge.ts`（M7 批 3 起拆出，见那里的文件头）。
 */
import { PERMANENT_DELETE_BATCH } from "@menote/shared";
import { SQL_REVOKE_ITEM_SHARES } from "../db/tables";
import { DomainError } from "../errors";
import { permanentDeleteItems } from "./trash-purge";

export interface TrashResult {
  id: string;
  meta_rev: number;
  deleted_at: number | null;
  /** 恢复后实际落到的文件夹（`null` = 根目录）——原文件夹没了就会被挪到根 */
  folder_id: string | null;
}

export interface FolderTrashResult {
  id: string;
  meta_rev: number;
  deleted_at: number | null;
  parent_id: string | null;
  /** 连带进回收站的子夹与条目数（恢复只恢复这个夹本身，里面的东西各自恢复） */
  folders: number;
  items: number;
}

/**
 * 软删一个文件夹：**连同内容一起进回收站**（设计 §5.1）。
 *
 * 三条要点：
 * 1. 层级只有两层，所以"连同内容"= 自己 + 直接子夹 + 这些夹里的条目（一条 UPDATE 搞定）；
 * 2. **整次操作共享一个 `sync_seq`**：一个逻辑写只推一个序号，客户端一次拉全；
 * 3. **加密空间行不可删**（M3-6 留下的守卫，当时没有删除入口所以顺延到这里）：
 *    空间是隐私锁的锚点，删掉它整片内容的归属就没了——要解散得先关隐私锁。
 */
export async function softDeleteFolder(
  db: D1Database,
  userId: string,
  folderId: string,
  now: number,
): Promise<FolderTrashResult> {
  const target = await db
    .prepare("SELECT is_enc_space, deleted_at, parent_id FROM folders WHERE id = ? AND user_id = ?")
    .bind(folderId, userId)
    .first<{ is_enc_space: number; deleted_at: number | null; parent_id: string | null }>();
  if (!target) throw new DomainError("not_found", "文件夹不存在");
  if (target.is_enc_space === 1) {
    throw new DomainError("invalid", "加密空间不能删除；如需解散，请先在设置里关闭隐私锁");
  }
  if (target.deleted_at !== null) {
    // 已在回收站：不重复写（同条目的口径）
    const row = await db
      .prepare("SELECT meta_rev, deleted_at, parent_id FROM folders WHERE id = ? AND user_id = ?")
      .bind(folderId, userId)
      .first<{ meta_rev: number; deleted_at: number | null; parent_id: string | null }>();
    return {
      id: folderId,
      meta_rev: row?.meta_rev ?? 0,
      deleted_at: row?.deleted_at ?? null,
      parent_id: row?.parent_id ?? null,
      folders: 0,
      items: 0,
    };
  }

  const results = await db.batch([
    db
      .prepare(
        `UPDATE folders SET deleted_at = ?, meta_rev = meta_rev + 1, updated_at = ?,
           sync_seq = (SELECT sync_seq + 1 FROM users WHERE id = ?)
         WHERE user_id = ? AND deleted_at IS NULL AND (id = ? OR parent_id = ?)`,
      )
      .bind(now, now, userId, userId, folderId, folderId),
    db
      .prepare(
        `UPDATE items SET deleted_at = ?, meta_rev = meta_rev + 1, updated_at = ?,
           sync_seq = (SELECT sync_seq + 1 FROM users WHERE id = ?)
         WHERE user_id = ? AND deleted_at IS NULL
           AND folder_id IN (SELECT id FROM folders WHERE user_id = ? AND (id = ? OR parent_id = ?))`,
      )
      .bind(now, now, userId, userId, userId, folderId, folderId),
    db
      .prepare(
        `UPDATE users SET sync_seq = sync_seq + 1
         WHERE id = ? AND EXISTS (SELECT 1 FROM folders WHERE user_id = ? AND deleted_at = ?)`,
      )
      .bind(userId, userId, now),
  ]);

  const row = await db
    .prepare("SELECT meta_rev, deleted_at, parent_id FROM folders WHERE id = ? AND user_id = ?")
    .bind(folderId, userId)
    .first<{ meta_rev: number; deleted_at: number | null; parent_id: string | null }>();

  return {
    id: folderId,
    meta_rev: row?.meta_rev ?? 0,
    deleted_at: row?.deleted_at ?? null,
    parent_id: row?.parent_id ?? null,
    folders: results[0]?.meta.changes ?? 0,
    items: results[1]?.meta.changes ?? 0,
  };
}

/**
 * 恢复文件夹：父夹不在（被删或已永久删除）→ **回根目录**；`deleted_at = NULL`、`meta_rev + 1`。
 *
 * **只恢复这个夹本身**：里面的条目与子夹各自在回收站里，由用户逐条/批量恢复——
 * 一次点击就把整棵子树复活，会让"我删的是这个夹、不是里面的东西"变得说不清。
 */
export async function restoreFolder(
  db: D1Database,
  userId: string,
  folderId: string,
  now: number,
): Promise<FolderTrashResult> {
  await db.batch([
    db
      .prepare(
        `UPDATE folders SET
           parent_id = (SELECT CASE
             WHEN f.parent_id IS NULL THEN NULL
             WHEN p.id IS NOT NULL THEN f.parent_id
             ELSE NULL END
             FROM folders f LEFT JOIN folders p
               ON p.id = f.parent_id AND p.user_id = f.user_id AND p.deleted_at IS NULL
             WHERE f.id = ? AND f.user_id = ?),
           deleted_at = NULL, meta_rev = meta_rev + 1, updated_at = ?,
           sync_seq = (SELECT sync_seq + 1 FROM users WHERE id = ?)
         WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL`,
      )
      .bind(folderId, userId, now, userId, folderId, userId),
    db
      .prepare(
        `UPDATE users SET sync_seq = sync_seq + 1
         WHERE id = ? AND EXISTS (SELECT 1 FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL)`,
      )
      .bind(userId, folderId, userId),
  ]);

  const row = await db
    .prepare("SELECT meta_rev, deleted_at, parent_id FROM folders WHERE id = ? AND user_id = ?")
    .bind(folderId, userId)
    .first<{ meta_rev: number; deleted_at: number | null; parent_id: string | null }>();
  if (!row) throw new DomainError("not_found", "文件夹不存在");

  return {
    id: folderId,
    meta_rev: row.meta_rev,
    deleted_at: row.deleted_at,
    parent_id: row.parent_id,
    folders: 0,
    items: 0,
  };
}

/**
 * 软删（移入回收站）。
 *
 * 已经在回收站里的条目**不再重复写**：否则每点一次删除都会推进 `sync_seq`，
 * 让别的设备白拉一轮。
 *
 * **连带撤销分享**（M6 第一批）：需求 §16.1 要求「从回收站恢复后分享不会自动恢复」。
 * 访客侧只做实时检查、不记得曾经死过，所以恢复条目会让链接复活——这里在软删的同一次
 * batch 里把分享行真撤销，正确性不再依赖客户端那一把（见 `SQL_REVOKE_ITEM_SHARES` 的注释）。
 * 已在回收站时前两条语句都不生效，但撤销语句幂等（`revoked_at IS NULL`），重跑无副作用。
 */
export async function softDeleteItem(
  db: D1Database,
  userId: string,
  itemId: string,
  now: number,
  /** 追加到同一次 batch 的语句（MCP 的审计行与幂等记录）。默认空 = 行为与之前完全一致 */
  extra?: readonly D1PreparedStatement[],
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
    // 与前两条同一次 batch：软删与撤销要么都成、要么都不成，中间不留「已删但链接还活」的窗口
    db.prepare(SQL_REVOKE_ITEM_SHARES).bind(now, itemId, userId),
    ...(extra ?? []),
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
 * 清空回收站：把当前所有软删**条目与文件夹**按 `PERMANENT_DELETE_BATCH` 分批永久删除。
 *
 * 每批一个 batch（各自推进 `sync_seq`），返回总删除数。**只删回收站里的**（`deleted_at IS NOT NULL`）。
 * 两类实体分别取批（2026-09-27 起文件夹也支持永久删除）——同一个批里可以同时含条目与文件夹，
 * `permanentDeleteItems` 会按各自的存在性分别写墓碑。
 */
export async function emptyTrash(
  db: D1Database,
  userId: string,
  now: number,
): Promise<{ deleted: number; batches: number }> {
  let deleted = 0;
  let batches = 0;

  for (const table of ["items", "folders"] as const) {
    for (let round = 0; round < 100; round += 1) {
      const rows = await db
        .prepare(
          `SELECT id FROM ${table} WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at ASC LIMIT ?`,
        )
        .bind(userId, PERMANENT_DELETE_BATCH)
        .all<{ id: string }>();
      const ids = rows.results.map((row) => row.id);
      if (ids.length === 0) break;

      const result = await permanentDeleteItems(db, userId, ids, now);
      deleted += result.deleted;
      batches += 1;
    }
  }

  return { deleted, batches };
}

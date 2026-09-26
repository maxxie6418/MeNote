/**
 * 增量拉取（架构 §6.1、口径见 `docs/modules/Menote-同步引擎设计-v1.md` §3.2/§3.3）。
 *
 * 三条硬规则：
 * 1. **只回元数据**，正文另取（首屏只需"元数据增量 + 当前条目"）。
 * 2. **每类最多 200 行**，且**不得把同一 `sync_seq` 的组切开**（一个逻辑写操作影响的所有行
 *    共享同一序号；切开会让客户端漏掉同组的其余行）。
 * 3. `next_cursor` 取两类末端序号的**较小值**——两类是两次独立查询，截断点不同，
 *    取较大值会永久跳过另一类落在中间的变更。
 */
import {
  SYNC_PAGE_LIMIT,
  type FolderMeta,
  type ItemMeta,
  type ItemType,
  type SyncResponse,
} from "@menote/shared";
import {
  SQL_SELECT_FOLDERS_SINCE,
  SQL_SELECT_ITEMS_SINCE,
  SQL_SELECT_USER_TOMBSTONE_FLOOR,
} from "../db/tables";
import { DomainError } from "../errors";

interface ItemRow {
  id: string;
  type: string;
  folder_id: string | null;
  title: string | null;
  enc_self: number;
  in_enc_space: number;
  size_bytes: number;
  content_hash: string;
  tags: string;
  memo_at: number | null;
  is_task: number;
  task_status: string | null;
  task_due: string | null;
  task_priority: string | null;
  pinned: number;
  starred: number;
  rev: number;
  meta_rev: number;
  sealed_rev: number | null;
  sync_seq: number;
  created_at: number;
  updated_at: number;
  last_edit_at: number | null;
  last_device: string | null;
  deleted_at: number | null;
}

interface FolderRow {
  id: string;
  parent_id: string | null;
  is_enc_space: number;
  in_enc_space: number;
  name: string;
  depth: number;
  position: number;
  meta_rev: number;
  sync_seq: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface PagedRows<T> {
  rows: T[];
  /**
   * 本类已完整返回的最大序号。
   * **没有新行时取 `+∞`**：该类别不构成限制，不能把游标拖回原地（否则 min 会让客户端原地打转）。
   */
  tail: number;
  hasMore: boolean;
}

/**
 * 截断 + 组完整性处理。
 * 多取的那一行若与末行同号，说明该组被切开：整组回退；回退后一行为空则说明单组超过上限。
 */
function paginate<T extends { sync_seq: number }>(
  rows: T[],
  limit: number,
  cursor: number,
): PagedRows<T> {
  if (rows.length <= limit) {
    const last = rows[rows.length - 1];
    return { rows, tail: last ? last.sync_seq : Number.POSITIVE_INFINITY, hasMore: false };
  }

  const kept = rows.slice(0, limit);
  const dropped = rows[limit];
  const cuttingSeq = kept[kept.length - 1]?.sync_seq ?? cursor;

  if (dropped && dropped.sync_seq === cuttingSeq) {
    const trimmed = kept.filter((row) => row.sync_seq !== cuttingSeq);
    const lastTrimmed = trimmed[trimmed.length - 1];
    if (!lastTrimmed) {
      throw new DomainError("too_large", "单次同步数据过大，请稍后重试");
    }
    return { rows: trimmed, tail: lastTrimmed.sync_seq, hasMore: true };
  }

  return { rows: kept, tail: cuttingSeq, hasMore: true };
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function toItemMeta(row: ItemRow): ItemMeta {
  return {
    id: row.id,
    type: row.type as ItemType,
    folder_id: row.folder_id,
    title: row.title,
    enc_self: row.enc_self === 1 ? 1 : 0,
    in_enc_space: row.in_enc_space === 1 ? 1 : 0,
    size_bytes: row.size_bytes,
    content_hash: row.content_hash,
    tags: parseTags(row.tags),
    memo_at: row.memo_at,
    is_task: row.is_task === 1 ? 1 : 0,
    task_status: row.task_status,
    task_due: row.task_due,
    task_priority: row.task_priority,
    pinned: row.pinned === 1 ? 1 : 0,
    starred: row.starred === 1 ? 1 : 0,
    rev: row.rev,
    meta_rev: row.meta_rev,
    sealed_rev: row.sealed_rev,
    sync_seq: row.sync_seq,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_edit_at: row.last_edit_at,
    last_device: row.last_device,
    deleted_at: row.deleted_at,
    deleted: row.deleted_at !== null,
  };
}

function toFolderMeta(row: FolderRow): FolderMeta {
  return {
    id: row.id,
    parent_id: row.parent_id,
    is_enc_space: row.is_enc_space === 1 ? 1 : 0,
    in_enc_space: row.in_enc_space === 1 ? 1 : 0,
    name: row.name,
    depth: row.depth,
    position: row.position,
    meta_rev: row.meta_rev,
    sync_seq: row.sync_seq,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    deleted: row.deleted_at !== null,
  };
}

/**
 * 拉取元数据增量。
 *
 * `full_resync` 的条件是 **`cursor > 0 且 cursor < tombstone_floor`**：游标为 0 本身就是
 * "从头拉"，不该再要求重建（否则 `0 < floor` 会永远成立 → 客户端死循环）。
 * M1 的 `tombstone_floor` 恒为 0，该分支实际不会触发，但协议先定死。
 */
export async function pullSync(
  db: D1Database,
  userId: string,
  cursor: number,
): Promise<SyncResponse> {
  const floorRow = await db
    .prepare(SQL_SELECT_USER_TOMBSTONE_FLOOR)
    .bind(userId)
    .first<{ tombstone_floor: number }>();
  const floor = floorRow?.tombstone_floor ?? 0;

  if (cursor > 0 && cursor < floor) {
    return { items: [], folders: [], next_cursor: 0, has_more: false, full_resync: true };
  }

  const probe = SYNC_PAGE_LIMIT + 1;
  const [itemsResult, foldersResult] = await Promise.all([
    db.prepare(SQL_SELECT_ITEMS_SINCE).bind(userId, cursor, probe).all<ItemRow>(),
    db.prepare(SQL_SELECT_FOLDERS_SINCE).bind(userId, cursor, probe).all<FolderRow>(),
  ]);

  const items = paginate(itemsResult.results, SYNC_PAGE_LIMIT, cursor);
  const folders = paginate(foldersResult.results, SYNC_PAGE_LIMIT, cursor);

  // 取两类末端序号的较小值；某类没有新行时其 tail 为 +∞，不参与限制
  const tails = [items.tail, folders.tail].filter((tail) => Number.isFinite(tail));
  const nextCursor = tails.length > 0 ? Math.min(...tails) : cursor;

  return {
    items: items.rows.map(toItemMeta),
    folders: folders.rows.map(toFolderMeta),
    next_cursor: nextCursor,
    has_more: items.hasMore || folders.hasMore,
    full_resync: false,
  };
}

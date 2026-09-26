/**
 * 本地库 Schema（架构 §3.2：Dexie / IndexedDB）。
 *
 * **字段名与服务端保持一致（snake_case）**：架构要求本地 `items` 与服务端 `items` 同构，
 * 不做驼峰映射——映射层是 bug 温床，而同步引擎恰好要逐字段比对。
 *
 * 本地库只是缓存：遇到无法迁移的情况可以清空后从服务端重建（清空前把 outbox 未上传项导出）。
 */
import Dexie, { type EntityTable } from "dexie";
import type { FolderMeta, ItemMeta, UserSettings } from "@menote/shared";

/** 本地待上传标记：null 表示已同步 */
export type PendingKind =
  | "create"
  | "save_body"
  | "patch_meta"
  /** 新建文件夹（M2-3） */
  | "create_folder"
  /** 文件夹改名/移动（M2-3） */
  | "patch_folder";

export interface LocalItem extends ItemMeta {
  pending: PendingKind | null;
}

export interface LocalFolder extends FolderMeta {
  pending: PendingKind | null;
}

/** 已缓存正文 */
export interface BodyRow {
  item_id: string;
  body: string;
  rev: number;
  content_hash: string;
  cached_at: number;
}

/** 未上传的编辑稿：**每 2 秒写一次**，与上传节奏无关（拆解 M04-04） */
export interface DraftRow {
  item_id: string;
  body: string;
  updated_at: number;
}

export type OutboxEntity = "item" | "folder" | "setting" | "attachment" | "version";
export type OutboxOp =
  | "create"
  | "save_body"
  | "patch_meta"
  | "create_folder"
  | "patch_folder"
  /** 用户设置整份覆盖（M2-7） */
  | "put_settings";

/** 待上传操作；正文不复制，指向 `drafts`（架构 §6.3） */
export interface OutboxRow {
  seq?: number;
  entity: OutboxEntity;
  entity_id: string;
  op: OutboxOp;
  /** 正文保存的基版本（合并时保留**最早**的一份） */
  base_rev: number;
  /** 元数据补丁的基版本 */
  base_meta_rev: number;
  retries: number;
  next_retry_at: number;
  last_error: string | null;
  queued_at: number;
}

/** 单行状态：同步游标、上次同步时间、设备标识 */
export interface SyncStateRow {
  key: string;
  cursor: number;
  last_sync_at: number | null;
  device_id: string;
}

export const SYNC_STATE_KEY = "state";

/**
 * 本地搜索索引（M2-6）：一个条目一行。
 *
 * - `sync_seq` 取自建索引时的**条目**，是增量更新的依据：同步后只重建 `sync_seq` 变了的条目；
 * - `text` 存原文（标题 + 标签 + 正文），`haystack` 存小写副本——匹配与高亮片段都从这两列来，
 *   这样片段里的偏移与原文一致（不会出现"高亮错位"）；
 * - `tokens` 是分词结果的空格串，只用于加分排序（命中判定用子串，中文更稳）。
 *
 * 只在本地，不进同步、不进服务端（服务端兜底走 `GET /api/search`）。
 */
export interface SearchIndexRow {
  item_id: string;
  sync_seq: number;
  text: string;
  haystack: string;
  tokens: string;
  updated_at: number;
  indexed_at: number;
}

/**
 * 用户设置（M2-7）：只有一行（`key = "user"`）。
 *
 * `pending` 非空表示"本地改了但还没上传"，同步拉取时遇到它会**跳过**（别把用户刚改的设置顶掉）。
 */
export interface SettingsRow {
  key: "user";
  json: UserSettings;
  rev: number;
  updated_at: number;
  pending: "put_settings" | null;
}

/**
 * 冲突关联（M2-9 的对比 UI 用）：**副本 id → 原条目 id**。
 *
 * 为什么要单独记：M1 只把出处写进副本标题（`原标题（冲突副本 09-26 12:00 · 设备）`），
 * 一旦改名就对不上、标题重名还会指错原条目。这张表是**纯本地**的加工信息——
 * 不改服务端模型，也不进同步。
 */
export interface ConflictRow {
  copy_id: string;
  original_id: string;
  created_at: number;
}

export class MenoteDatabase extends Dexie {
  items!: EntityTable<LocalItem, "id">;
  bodies!: EntityTable<BodyRow, "item_id">;
  drafts!: EntityTable<DraftRow, "item_id">;
  folders!: EntityTable<LocalFolder, "id">;
  outbox!: EntityTable<OutboxRow, "seq">;
  syncState!: EntityTable<SyncStateRow, "key">;
  searchIndex!: EntityTable<SearchIndexRow, "item_id">;
  settings!: EntityTable<SettingsRow, "key">;
  conflicts!: EntityTable<ConflictRow, "copy_id">;

  constructor(name = "menote") {
    super(name);
    this.version(1).stores({
      items: "id, folder_id, [folder_id+updated_at], memo_at, sync_seq, is_task, deleted_at",
      bodies: "item_id",
      drafts: "item_id",
      folders: "id, parent_id, sync_seq",
      outbox: "++seq, entity_id, [entity+entity_id], next_retry_at",
      syncState: "key",
    });
    // 2：新增本地搜索索引（M2-6）。纯本地表，不涉及迁移数据——空的索引由首次刷新重建。
    this.version(2).stores({
      items: "id, folder_id, [folder_id+updated_at], memo_at, sync_seq, is_task, deleted_at",
      bodies: "item_id",
      drafts: "item_id",
      folders: "id, parent_id, sync_seq",
      outbox: "++seq, entity_id, [entity+entity_id], next_retry_at",
      syncState: "key",
      searchIndex: "item_id, sync_seq, updated_at",
    });
    // 3：新增用户设置（M2-7）。同样纯本地表：只有一行（key = "user"），内容随同步往返。
    this.version(3).stores({
      items: "id, folder_id, [folder_id+updated_at], memo_at, sync_seq, is_task, deleted_at",
      bodies: "item_id",
      drafts: "item_id",
      folders: "id, parent_id, sync_seq",
      outbox: "++seq, entity_id, [entity+entity_id], next_retry_at",
      syncState: "key",
      searchIndex: "item_id, sync_seq, updated_at",
      settings: "key",
    });
    // 4：新增冲突关联（M2-9 的对比 UI）。纯本地加工信息，服务端只认两个普通条目。
    this.version(4).stores({
      items: "id, folder_id, [folder_id+updated_at], memo_at, sync_seq, is_task, deleted_at",
      bodies: "item_id",
      drafts: "item_id",
      folders: "id, parent_id, sync_seq",
      outbox: "++seq, entity_id, [entity+entity_id], next_retry_at",
      syncState: "key",
      searchIndex: "item_id, sync_seq, updated_at",
      settings: "key",
      conflicts: "copy_id, original_id",
    });
  }
}

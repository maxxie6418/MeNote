/**
 * 本地仓储（架构 §3.2/§3.3：数据的唯一真相是 IndexedDB，界面只经仓储读写）。
 *
 * 两条容易踩的规则：
 * 1. **入站（拉取）只覆盖元数据**，绝不碰 `drafts`；正文缓存只在"哈希变了且本地没有待上传改动"
 *    时失效（否则会把用户还没上传的编辑冲掉）。
 * 2. **outbox 合并保留最早的 `base_rev` / `base_meta_rev`**：用最新的基版本会把自己后来的写入
 *    误当成"服务端已更新"，从而把真冲突判成重放。
 */
import {
  newUlid,
  sha256Hex,
  utf8ByteLength,
  type FolderMeta,
  type ItemMeta,
  type ItemType,
} from "@menote/shared";
import { stripFrontmatter } from "@menote/mdcore";
import { db } from "./database";
import {
  SYNC_STATE_KEY,
  type BodyRow,
  type DraftRow,
  type LocalFolder,
  type LocalItem,
  type OutboxEntity,
  type OutboxOp,
  type OutboxRow,
  type PendingKind,
  type SyncStateRow,
} from "./schema";

// ——————————————————————————— 同步状态 ———————————————————————————

export async function getSyncState(): Promise<SyncStateRow> {
  const existing = await db.syncState.get(SYNC_STATE_KEY);
  if (existing) return existing;

  const fresh: SyncStateRow = {
    key: SYNC_STATE_KEY,
    cursor: 0,
    last_sync_at: null,
    device_id: newUlid(),
  };
  await db.syncState.put(fresh);
  return fresh;
}

export async function setSyncCursor(cursor: number, at: number): Promise<void> {
  const state = await getSyncState();
  await db.syncState.put({ ...state, cursor, last_sync_at: at });
}

// ——————————————————————————— 入站：拉取结果落库 ———————————————————————————

/** 把服务端返回的条目元数据写入本地；保留本地 `pending`，并在需要时让正文缓存失效 */
export async function applySyncItems(items: ItemMeta[]): Promise<void> {
  if (items.length === 0) return;

  await db.transaction("rw", db.items, db.bodies, async () => {
    const ids = items.map((item) => item.id);
    const existing = await db.items.bulkGet(ids);
    const pendingById = new Map<string, PendingKind | null>();
    for (const row of existing) {
      if (row) pendingById.set(row.id, row.pending);
    }

    await db.items.bulkPut(
      items.map((item) => ({ ...item, pending: pendingById.get(item.id) ?? null })),
    );

    const bodies = await db.bodies.bulkGet(ids);
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const cached = bodies[i];
      if (!item || !cached) continue;
      // 本地有未上传改动 → 正文与草稿都保留；否则哈希变了就失效，等下次按需重取
      if (pendingById.get(item.id)) continue;
      if (cached.content_hash !== item.content_hash) {
        await db.bodies.delete(item.id);
      }
    }
  });
}

export async function applySyncFolders(folders: FolderMeta[]): Promise<void> {
  if (folders.length === 0) return;

  await db.transaction("rw", db.folders, async () => {
    const existing = await db.folders.bulkGet(folders.map((folder) => folder.id));
    const pendingById = new Map<string, PendingKind | null>();
    for (const row of existing) {
      if (row) pendingById.set(row.id, row.pending);
    }
    await db.folders.bulkPut(
      folders.map((folder) => ({ ...folder, pending: pendingById.get(folder.id) ?? null })),
    );
  });
}

// ——————————————————————————— 本地读 ———————————————————————————

/** 未删除的条目，按最近编辑倒序（置顶在界面层再排）。**不含 Memo**（Q8：笔记视图不列 Memo） */
export async function listLocalItems(): Promise<LocalItem[]> {
  const rows = await db.items.toArray();
  return rows
    .filter((row) => row.deleted_at === null && row.type !== "memo")
    .sort((a, b) => b.updated_at - a.updated_at);
}

/** 未删除的 Memo，按发生时间倒序（时间轴用；置顶在界面层再排 —— Q9） */
export async function listLocalMemos(): Promise<LocalItem[]> {
  const rows = await db.items.toArray();
  return rows
    .filter((row) => row.deleted_at === null && row.type === "memo")
    .sort((a, b) => (b.memo_at ?? 0) - (a.memo_at ?? 0));
}

/**
 * Memo 的正文（已剥掉 YAML front matter），供时间轴渲染。
 *
 * 时间轴要显示**渲染后的正文**，而本地缓存里存的是原始 md（可能带 front matter）；
 * 剥壳放在数据层，界面层不该关心 md 的格式细节。
 */
export async function listMemoContents(): Promise<Record<string, string>> {
  const rows = await db.items.toArray();
  const memoIds = new Set(
    rows.filter((row) => row.deleted_at === null && row.type === "memo").map((row) => row.id),
  );
  const bodies = await db.bodies.toArray();
  const out: Record<string, string> = {};
  for (const body of bodies) {
    if (!memoIds.has(body.item_id)) continue;
    out[body.item_id] = stripFrontmatter(body.body);
  }
  return out;
}

export async function getLocalItem(id: string): Promise<LocalItem | undefined> {
  return db.items.get(id);
}

export async function listLocalFolders(): Promise<LocalFolder[]> {
  const rows = await db.folders.toArray();
  return rows.filter((row) => row.deleted_at === null);
}

// ——————————————————————————— 文件夹本地写（M2-3） ———————————————————————————

/**
 * 本地新建文件夹：写入 folders 并入队一条 `create_folder`。
 *
 * `depth` 由调用方按"父不存在 → 1；父存在 → 父深度 + 1"算出，且**不得超过 2**（需求 §4.5）。
 * 服务端会再校验一遍（客户端校验只是提前给用户反馈，不是权威）。
 */
export async function createLocalFolder(
  id: string,
  name: string,
  parentId: string | null,
  depth: number,
  now: number,
): Promise<LocalFolder> {
  const folder: LocalFolder = {
    id,
    parent_id: parentId,
    is_enc_space: 0,
    in_enc_space: 0,
    name,
    depth,
    position: 0,
    meta_rev: 0,
    sync_seq: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    deleted: false,
    pending: "create_folder",
  };

  await db.transaction("rw", db.folders, db.outbox, async () => {
    await db.folders.put(folder);
    await enqueue({
      entity: "folder",
      entity_id: id,
      op: "create_folder",
      base_rev: 0,
      base_meta_rev: 0,
      now,
    });
  });

  return folder;
}

/**
 * 文件夹改名 / 移动入队：同一文件夹只保留一行，**保留最早的 `base_meta_rev`**
 * （与条目的 `enqueueMetaPatch` 同一条合并规则，架构 §6.3）。
 */
export async function enqueueFolderPatch(
  folderId: string,
  baseMetaRev: number,
  now: number,
): Promise<void> {
  await db.transaction("rw", db.outbox, db.folders, async () => {
    const rows = await db
      .outbox
      .where("[entity+entity_id]")
      .equals(["folder", folderId])
      .toArray();

    if (rows.some((row) => row.op === "create_folder")) {
      // 还没上传过：改名随那条 create 一起走，不另排
      await db.folders.update(folderId, { pending: "create_folder" });
      return;
    }
    if (!rows.some((row) => row.op === "patch_folder")) {
      await enqueue({
        entity: "folder",
        entity_id: folderId,
        op: "patch_folder",
        base_rev: 0,
        base_meta_rev: baseMetaRev,
        now,
      });
    }
    await db.folders.update(folderId, { pending: "patch_folder" });
  });
}

/** 本地改名（走 meta_rev：多设备并发改名以后写为准，不生成冲突副本 —— Q12） */
export async function renameLocalFolder(
  folderId: string,
  name: string,
  now: number,
): Promise<void> {
  const folder = await db.folders.get(folderId);
  if (!folder) return;

  await db.folders.update(folderId, { name, updated_at: now });
  await enqueueFolderPatch(folderId, folder.meta_rev, now);
}

/**
 * 本地移动文件夹。两层限制让这件事很简单：**深度 2 的文件夹不可能有子文件夹**，
 * 所以移动只影响这一个节点自己的 `parent_id` 与 `depth`，不需要递归改子树。
 */
export async function moveLocalFolder(
  folderId: string,
  parentId: string | null,
  depth: number,
  now: number,
): Promise<void> {
  const folder = await db.folders.get(folderId);
  if (!folder) return;

  await db.folders.update(folderId, { parent_id: parentId, depth, updated_at: now });
  await enqueueFolderPatch(folderId, folder.meta_rev, now);
}

/** 某个文件夹下直接包含的条目数（含未上传的）——删除确认框与树上的计数都用它 */
export async function countItemsInFolder(folderId: string | null): Promise<number> {
  const rows = await db.items.filter((row) => row.deleted_at === null).toArray();
  return rows.filter((row) => (row.folder_id ?? null) === folderId).length;
}

/** 每个文件夹直接包含的条目数（一次算完，供笔记本树用） */
export async function countItemsByFolder(): Promise<Record<string, number>> {
  const rows = await db.items.filter((row) => row.deleted_at === null).toArray();
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.folder_id === null) continue;
    counts[row.folder_id] = (counts[row.folder_id] ?? 0) + 1;
  }
  return counts;
}

/**
 * 条目列表行的"摘要"：取已缓存正文的第一行非空内容（去掉 Markdown 标记与标题号），截断到 60 字。
 *
 * 为什么从正文取而不是加一个 DB 字段：摘要只是列表的展示细节，不值当为它引入派生列与同步字段
 * （架构 §6.1 的派生列都服务于 MCP 筛选）；正文缓存本来就在本地，列表滚动量级下够用。
 */
export async function listItemSummaries(): Promise<Record<string, string>> {
  const rows = await db.bodies.toArray();
  const out: Record<string, string> = {};
  for (const row of rows) {
    // 先剥掉 YAML front matter：否则摘要把 `menote:` 当成正文首行显示
    for (const rawLine of stripFrontmatter(row.body).split("\n")) {
      const line = rawLine
        .replace(/^#{1,6}\s*/, "")
        .replace(/^[-*+]\s+(\[[ xX]\]\s*)?/, "")
        .replace(/[`*_>]/g, "")
        .trim();
      if (line === "") continue;
      out[row.item_id] = line.length > 60 ? `${line.slice(0, 60)}…` : line;
      break;
    }
  }
  return out;
}

export async function getCachedBody(id: string): Promise<BodyRow | undefined> {
  return db.bodies.get(id);
}

export async function getDraft(id: string): Promise<DraftRow | undefined> {
  return db.drafts.get(id);
}

/** 编辑器初始内容：优先未上传草稿，其次正文缓存 */
export async function getEditableBody(id: string): Promise<{ body: string; fromDraft: boolean }> {
  const draft = await db.drafts.get(id);
  if (draft) return { body: draft.body, fromDraft: true };
  const cached = await db.bodies.get(id);
  return { body: cached?.body ?? "", fromDraft: false };
}

// ——————————————————————————— 本地写（离线优先） ———————————————————————————

/** 本地草稿：**每 2 秒**写一次，与上传节奏无关（拆解 M04-04） */
export async function saveDraft(itemId: string, body: string, now: number): Promise<void> {
  await db.drafts.put({ item_id: itemId, body, updated_at: now });
}

/** 缓存已确认的正文（上传成功或从服务端取回时调用） */
export async function putCachedBody(
  itemId: string,
  body: string,
  rev: number,
  contentHash: string,
  now: number,
): Promise<void> {
  await db.bodies.put({ item_id: itemId, body, rev, content_hash: contentHash, cached_at: now });
}

/** 本地新建条目：写入 items + bodies + drafts，并入队一条 `create` */
export interface NewLocalItemInput {
  id: string;
  type: ItemType;
  title: string | null;
  folder_id: string | null;
  tags?: string[];
  memo_at?: number | null;
  body: string;
  /** 清单标记（仅 Memo 有；由 `@menote/mdcore` 从 YAML 派生，前后端同一份实现） */
  task?: { isTask: boolean; status: string | null; due: string | null; priority: string | null };
}

export async function createLocalItem(input: NewLocalItemInput, now: number): Promise<LocalItem> {
  const contentHash = await sha256Hex(input.body);
  const item: LocalItem = {
    id: input.id,
    type: input.type,
    folder_id: input.folder_id,
    title: input.title,
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: utf8ByteLength(input.body),
    content_hash: contentHash,
    tags: input.tags ?? [],
    memo_at: input.memo_at ?? null,
    is_task: input.task?.isTask ? 1 : 0,
    task_status: input.task?.status ?? null,
    task_due: input.task?.due ?? null,
    task_priority: input.task?.priority ?? null,
    pinned: 0,
    starred: 0,
    rev: 0,
    meta_rev: 0,
    sealed_rev: null,
    sync_seq: 0,
    created_at: now,
    updated_at: now,
    last_edit_at: now,
    last_device: null,
    deleted_at: null,
    deleted: false,
    pending: "create",
  };

  await db.transaction("rw", db.items, db.bodies, db.drafts, db.outbox, async () => {
    await db.items.put(item);
    await db.bodies.put({
      item_id: input.id,
      body: input.body,
      rev: 0,
      content_hash: contentHash,
      cached_at: now,
    });
    await db.drafts.put({ item_id: input.id, body: input.body, updated_at: now });
    await enqueue({
      entity: "item",
      entity_id: input.id,
      op: "create",
      base_rev: 0,
      base_meta_rev: 0,
      now,
    });
  });

  return item;
}

/** 本地新建笔记（M1 的"新建笔记"入口） */
export async function createLocalNote(
  id: string,
  title: string,
  body: string,
  now: number,
): Promise<LocalItem> {
  return createLocalItem({ id, type: "note", title, folder_id: null, body }, now);
}

/**
 * `full_resync` 时清掉"已同步"的本地内容（架构 §6.1 的客户端分支）。
 *
 * **保留 `pending != null` 的条目及其正文/草稿**：这些是还没上传的改动，清掉就等于丢数据。
 * 设计稿说的"导出为本地备份文件"是 M5 的导出模块；M1 先用"不删未上传项"达到同样的目的。
 */
export async function clearSyncedLocalContent(): Promise<void> {
  await db.transaction("rw", db.items, db.folders, db.bodies, async () => {
    const items = await db.items.toArray();
    const keepIds = new Set(items.filter((row) => row.pending !== null).map((row) => row.id));
    await db.items.filter((row) => row.pending === null).delete();

    const bodies = await db.bodies.toArray();
    await db.bodies.bulkDelete(
      bodies.map((row) => row.item_id).filter((id) => !keepIds.has(id)),
    );

    await db.folders.filter((row) => row.pending === null).delete();
  });
}

// ——————————————————————————— outbox ———————————————————————————

interface EnqueueInput {
  entity: OutboxEntity;
  entity_id: string;
  op: OutboxOp;
  base_rev: number;
  base_meta_rev: number;
  now: number;
}

async function enqueue(input: EnqueueInput): Promise<void> {
  const row: OutboxRow = {
    entity: input.entity,
    entity_id: input.entity_id,
    op: input.op,
    base_rev: input.base_rev,
    base_meta_rev: input.base_meta_rev,
    retries: 0,
    next_retry_at: input.now,
    last_error: null,
    queued_at: input.now,
  };
  await db.outbox.add(row);
}

/**
 * 正文保存入队（合并规则见架构 §6.3）：
 * - 该条目还没上传过（队列里有 `create`）→ 不再排新行，正文取自 `drafts`；
 * - 已有 `save_body` → 复用这一行，**保留最早的 `base_rev`**。
 */
export async function enqueueBodySave(itemId: string, baseRev: number, now: number): Promise<void> {
  await db.transaction("rw", db.outbox, db.items, async () => {
    const rows = await db
      .outbox
      .where("[entity+entity_id]")
      .equals(["item", itemId])
      .toArray();

    if (rows.some((row) => row.op === "create")) {
      await db.items.update(itemId, { pending: "create" });
      return;
    }
    if (rows.some((row) => row.op === "save_body")) {
      await db.items.update(itemId, { pending: "save_body" });
      return;
    }

    await enqueue({ entity: "item", entity_id: itemId, op: "save_body", base_rev: baseRev, base_meta_rev: 0, now });
    await db.items.update(itemId, { pending: "save_body" });
  });
}

/** 元数据补丁入队：同一条目只保留一行，保留最早的 `base_meta_rev` */
export async function enqueueMetaPatch(itemId: string, baseMetaRev: number, now: number): Promise<void> {
  await db.transaction("rw", db.outbox, db.items, async () => {
    const rows = await db
      .outbox
      .where("[entity+entity_id]")
      .equals(["item", itemId])
      .toArray();

    if (!rows.some((row) => row.op === "patch_meta")) {
      await enqueue({ entity: "item", entity_id: itemId, op: "patch_meta", base_rev: 0, base_meta_rev: baseMetaRev, now });
    }
    await db.items.update(itemId, { pending: "patch_meta" });
  });
}

export async function listOutbox(): Promise<OutboxRow[]> {
  return db.outbox.orderBy("seq").toArray();
}

export async function outboxCount(): Promise<number> {
  return db.outbox.count();
}

/** 某个条目的全部队列项（用于判断它是否卡在失败列表里） */
export async function listItemOutbox(itemId: string): Promise<OutboxRow[]> {
  return db.outbox.where("[entity+entity_id]").equals(["item", itemId]).toArray();
}

/** 队首（已到重试时间的）；没有则 undefined */
export async function headOutbox(now: number): Promise<OutboxRow | undefined> {
  return db.outbox
    .orderBy("seq")
    .filter((row) => row.next_retry_at <= now)
    .first();
}

export async function removeOutbox(seq: number): Promise<void> {
  await db.outbox.delete(seq);
}

export async function markOutboxFailure(
  seq: number,
  error: string,
  nextRetryAt: number,
): Promise<void> {
  const row = await db.outbox.get(seq);
  if (!row) return;
  await db.outbox.put({
    ...row,
    retries: row.retries + 1,
    next_retry_at: nextRetryAt,
    last_error: error,
  });
}

/** 上传成功后落地：清 pending、更新 rev/哈希（正文由调用方写入 bodies） */export async function markItemSynced(
  itemId: string,
  patch: Partial<Pick<LocalItem, "rev" | "meta_rev" | "content_hash" | "size_bytes" | "sync_seq">>,
): Promise<void> {
  await db.items.update(itemId, { ...patch, pending: null });
}

/** 文件夹上传成功后落地 */
export async function markFolderSynced(
  folderId: string,
  patch: Partial<Pick<LocalFolder, "meta_rev" | "sync_seq">>,
): Promise<void> {
  await db.folders.update(folderId, { ...patch, pending: null });
}

export async function getLocalFolder(id: string): Promise<LocalFolder | undefined> {
  return db.folders.get(id);
}

/** 本地保留草稿直到用户删减到上限以内（拆解 M04-05）；上传成功后清掉 */
export async function clearDraft(itemId: string): Promise<void> {
  await db.drafts.delete(itemId);
}

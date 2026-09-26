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
} from "@menote/shared";
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

/** 未删除的条目，按最近编辑倒序（置顶在界面层再排） */
export async function listLocalItems(): Promise<LocalItem[]> {
  const rows = await db.items.toArray();
  return rows
    .filter((row) => row.deleted_at === null)
    .sort((a, b) => b.updated_at - a.updated_at);
}

export async function getLocalItem(id: string): Promise<LocalItem | undefined> {
  return db.items.get(id);
}

export async function listLocalFolders(): Promise<LocalFolder[]> {
  const rows = await db.folders.toArray();
  return rows.filter((row) => row.deleted_at === null);
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

/** 本地新建笔记：写入 items + bodies + drafts，并入队一条 `create` */
export async function createLocalNote(
  id: string,
  title: string,
  body: string,
  now: number,
): Promise<LocalItem> {
  const contentHash = await sha256Hex(body);
  const item: LocalItem = {
    id,
    type: "note",
    folder_id: null,
    title,
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: utf8ByteLength(body),
    content_hash: contentHash,
    tags: [],
    memo_at: null,
    is_task: 0,
    task_status: null,
    task_due: null,
    task_priority: null,
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
    await db.bodies.put({ item_id: id, body, rev: 0, content_hash: contentHash, cached_at: now });
    await db.drafts.put({ item_id: id, body, updated_at: now });
    await enqueue({
      entity: "item",
      entity_id: id,
      op: "create",
      base_rev: 0,
      base_meta_rev: 0,
      now,
    });
  });

  return item;
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

/** 上传成功后落地：清 pending、更新 rev/哈希（正文由调用方写入 bodies） */
export async function markItemSynced(
  itemId: string,
  patch: Partial<Pick<LocalItem, "rev" | "meta_rev" | "content_hash" | "size_bytes" | "sync_seq">>,
): Promise<void> {
  await db.items.update(itemId, { ...patch, pending: null });
}

/** 本地保留草稿直到用户删减到上限以内（拆解 M04-05）；上传成功后清掉 */
export async function clearDraft(itemId: string): Promise<void> {
  await db.drafts.delete(itemId);
}

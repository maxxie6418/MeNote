/**
 * 回收站的本地仓储（M4-12；《M4 界面稿》§六）。
 *
 * 从 `repository.ts` 分出来是因为那个文件到了行数预算，而回收站本来就自成一块：
 * **只做"本地记账"**——服务端是权威（软删/恢复的最终状态、永久删除的墓碑与 R2 待删登记），
 * 这里负责把服务端答复落到本地，好让界面立刻反映出来。
 */
import { db } from "./database";
import type { LocalItem } from "./schema";

/**
 * 回收站列表：**本地读**（离线也能看），按删除时间倒序。
 *
 * 回收站是"元数据视图"：不读正文、不解密，所以锁定时也能列出（标题按门禁占位，见 `trash/model.ts`）。
 */
export async function listTrashedItems(): Promise<LocalItem[]> {
  const rows = await db.items.toArray();
  return rows
    .filter((row) => row.deleted_at !== null)
    .sort((left, right) => (right.deleted_at ?? 0) - (left.deleted_at ?? 0));
}

/** 回收站里还有多少条（设置页卡片头要的实时计数） */
export async function countTrashedItems(): Promise<number> {
  return db.items.filter((row) => row.deleted_at !== null).count();
}

/** 软删后的本地同步：只改这几列（`rev` 不动，与服务端口径一致） */
export async function markItemTrashed(id: string, deletedAt: number, metaRev: number): Promise<void> {
  await db.items.update(id, { deleted_at: deletedAt, meta_rev: metaRev, deleted: true });
}

/** 恢复后的本地同步：`folder_id` 用**服务端返回的实际落点**（原文件夹可能已不存在） */
export async function markItemRestored(
  id: string,
  metaRev: number,
  folderId: string | null,
): Promise<void> {
  await db.items.update(id, {
    deleted_at: null,
    deleted: false,
    meta_rev: metaRev,
    folder_id: folderId,
  });
}

/** 文件夹软删/恢复的本地同步（连同内容的条目由服务端的 sync_seq 一并带回，这里只处理夹本身） */
export async function markFolderTrashed(id: string, deletedAt: number, metaRev: number): Promise<void> {
  await db.folders.update(id, { deleted_at: deletedAt, meta_rev: metaRev, deleted: true });
}

export async function markFolderRestored(
  id: string,
  metaRev: number,
  parentId: string | null,
): Promise<void> {
  await db.folders.update(id, {
    deleted_at: null,
    deleted: false,
    meta_rev: metaRev,
    parent_id: parentId,
  });
}

/**
 * 永久删除后的本地清理（与墓碑清理同一套口径，少清一处都会留下"幽灵"）：
 * 本体、正文缓存、草稿、搜索索引、冲突关联，以及出站队列里同 id 的待上传操作
 * （条目已被永久删除，那条 op 再发只会 404）。
 *
 * 服务端稍后还会通过墓碑把这些再确认一次——**幂等**，重复清不会更糟。
 */
export async function purgeLocalItems(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const list = [...ids];

  await db.transaction(
    "rw",
    [db.items, db.bodies, db.drafts, db.searchIndex, db.conflicts, db.outbox, db.attachmentsMeta],
    async () => {
      await db.items.bulkDelete(list);
      await db.bodies.bulkDelete(list);
      await db.drafts.bulkDelete(list);
      await db.searchIndex.bulkDelete(list);
      await db.outbox.filter((row) => row.entity === "item" && list.includes(row.entity_id)).delete();
      await db.conflicts
        .filter((row) => list.includes(row.original_id) || list.includes(row.copy_id))
        .delete();
      // 附件元数据也一起清（M4-10）：条目都没了，本地再留着它的附件行就是孤儿
      await db.attachmentsMeta.where("item_id").anyOf(list).delete();
    },
  );
}

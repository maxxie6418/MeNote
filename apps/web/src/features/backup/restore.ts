/**
 * 备份导入专用的**本地还原写入**。
 *
 * 为什么不放在 `data/db/repository.ts`：那是"新建一条笔记"的仓储，而这里的语义是
 * **按备份里的原样状态还原一条条目**——两者对同一批字段的取值要求相反。
 * 而且备份是 M5 的功能，不该让通用仓储为此超出行数预算（架构 §2.3.1）。
 *
 * 为什么不能直接用 `createLocalItem`：那是"新建"接口，会把 `pinned` / `starred` /
 * `enc_self` / `created_at` / `updated_at` / `deleted_at` 一律重置成新建时的样子
 * （`repository.ts` 里是硬编码的 `0` 与 `now`）。备份要还原的是**当时的状态**，
 * 用新建接口会静默丢掉置顶、收藏、单篇加密标记与创建时间——那正是恢复最该保住的部分。
 *
 * `rev` / `meta_rev` / `sync_seq` 仍然归零：这三条是**本机的乐观锁与同步游标**，
 * 服务端不认备份里的旧值（`create` 按新行处理），照抄会直接造成永久冲突。
 *
 * 幂等（设计 §五）：与 `createLocalItem` 同源——同一个 `id` 再写是覆盖，出队端去重，
 * 服务端 `SQL_INSERT_ITEM` 的 `WHERE NOT EXISTS` 让重复 insert 变 no-op。
 * 所以同一份备份反复导入不会刷出重复条目。
 */
import { sha256Hex, utf8ByteLength, type ItemType } from "@menote/shared";
import { db } from "../../data/db/database";
import { enqueue, type NewLocalItemInput } from "../../data/db/repository";
import type { LocalItem } from "../../data/db/schema";

export type RestoreLocalItemInput = Omit<NewLocalItemInput, "task"> & {
  task?: { isTask: boolean; status: string | null; due: string | null; priority: string | null };
  encSelf?: boolean;
  pinned?: boolean;
  starred?: boolean;
  createdAt?: number;
  updatedAt?: number;
  /**
   * 备份里的回收站时间。本地行按它写；服务端那边的软删由紧随其后的 `trash_item`
   * 出队补做（同条目 `create` 成功之后才轮到它，FIFO 保序）——这是"先同步成功、
   * 再进回收站"的时序（设计 §4.2）。推送失败时条目会在服务端暂时以正常条目出现，
   * 导入结果里的 `itemsFromTrash` 如实回报这个数。
   */
  deletedAt?: number | null;
};

export async function restoreLocalItem(
  input: RestoreLocalItemInput,
  now: number,
): Promise<LocalItem> {
  const contentHash = await sha256Hex(input.body);
  const createdAt = input.createdAt ?? now;
  const updatedAt = input.updatedAt ?? now;
  const item: LocalItem = {
    id: input.id,
    type: input.type as ItemType,
    folder_id: input.folder_id,
    title: input.title,
    enc_self: input.encSelf ? 1 : 0,
    in_enc_space: input.inEncSpace ? 1 : 0,
    size_bytes: utf8ByteLength(input.body),
    content_hash: contentHash,
    tags: input.tags ?? [],
    memo_at: input.memo_at ?? null,
    is_task: input.task?.isTask ? 1 : 0,
    task_status: input.task?.status ?? null,
    task_due: input.task?.due ?? null,
    task_priority: input.task?.priority ?? null,
    pinned: input.pinned ? 1 : 0,
    starred: input.starred ? 1 : 0,
    rev: 0,
    meta_rev: 0,
    sealed_rev: null,
    sync_seq: 0,
    created_at: createdAt,
    updated_at: updatedAt,
    last_edit_at: updatedAt,
    last_device: null,
    deleted_at: input.deletedAt ?? null,
    deleted: input.deletedAt != null,
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
    // 草稿**清掉**：这条不是"刚敲完还没传"，正文已经在 bodies 里、也随 create 出队了。
    // 留着草稿会被 `getEditableBody` 优先取走（结果一样），但会一直占着"待上传"的假象。
    await db.drafts.delete(input.id);
    await enqueue({
      entity: "item",
      entity_id: input.id,
      op: "create",
      base_rev: 0,
      base_meta_rev: 0,
      now,
    });
    // 回收站条目的服务端收尾（设计 §4.2）：create 出队成功后，紧跟的 trash_item
    // 才会执行——服务端先有这条，软删才有对象。enqueue 是裸追加，不受
    // "同一实体已有待推 op 就不再入队" 的合并规则影响，两条都保得住。
    if (input.deletedAt != null) {
      await enqueue({
        entity: "item",
        entity_id: input.id,
        op: "trash_item",
        base_rev: 0,
        base_meta_rev: 0,
        now,
      });
    }
  });

  return item;
}

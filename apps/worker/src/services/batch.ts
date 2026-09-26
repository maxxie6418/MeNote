/**
 * 批量写入服务（`POST /api/batch`；M2-9、架构 §4.5）。
 *
 * **为什么不是"拼一个大 batch"**：D1 的 `batch()` 是事务性的，一个操作冲突会让整批回滚，
 * 那就做不到"逐操作独立判定冲突、互不牵连"。所以这里**逐个复用单条端点的服务函数**
 * （`createItem` / `saveItemBody` / `patchItemMeta`），各自预检 + 各自的 batch，
 * 冲突就记一条失败结果继续下一个。
 *
 * 语句预算：每个操作最多 3 条写语句，入参上限 `BATCH_MAX_OPS = 10` → 单批 ≤30 条，
 * 稳在 D1 的 45 条以内（预检用的是单条查询，不计入 batch）。
 *
 * 省的是什么：客户端到 Worker 的**网络往返**（弱网上最贵的那段），不是 D1 内部的调用次数。
 */
import { BATCH_MAX_OPS, isUlid, type BatchOp, type BatchResult } from "@menote/shared";
import { DomainError } from "../errors";
import { createItem, patchItemMeta, saveItemBody } from "./items";

export async function applyBatch(
  db: D1Database,
  userId: string,
  ops: readonly BatchOp[],
  now: number,
  deviceLabel: string | null,
): Promise<BatchResult[]> {
  if (ops.length > BATCH_MAX_OPS) {
    throw new DomainError("invalid", `单批最多 ${BATCH_MAX_OPS} 个操作`);
  }

  const results: BatchResult[] = [];

  for (const [index, op] of ops.entries()) {
    // id 校验与单条端点一致（那边的 422 在这里变成该操作的失败，不牵连整批）
    if (!isUlid(op.id)) {
      results.push({
        ok: false,
        index,
        kind: op.kind,
        id: op.id,
        code: "invalid",
        message: "ID 格式不合法",
      });
      continue;
    }

    try {
      if (op.kind === "create") {
        const written = await createItem(
          db,
          userId,
          {
            id: op.id,
            type: op.meta.type,
            title: op.meta.title,
            folderId: op.meta.folder_id,
            tags: op.meta.tags,
            memoAt: op.meta.memo_at,
            isTask: op.meta.is_task,
            taskStatus: op.meta.task_status,
            taskDue: op.meta.task_due,
            taskPriority: op.meta.task_priority,
            contentHash: op.meta.content_hash,
            body: op.body,
            deviceLabel,
          },
          now,
        );
        results.push({
          ok: true,
          index,
          kind: op.kind,
          id: op.id,
          rev: written.rev,
          bytes: written.bytes,
          chars: written.chars,
        });
      } else if (op.kind === "save_body") {
        const written = await saveItemBody(
          db,
          userId,
          op.id,
          op.base_rev,
          op.content_hash,
          op.body,
          deviceLabel,
          now,
        );
        results.push({
          ok: true,
          index,
          kind: op.kind,
          id: op.id,
          rev: written.rev,
          bytes: written.bytes,
          chars: written.chars,
        });
      } else {
        const written = await patchItemMeta(db, userId, op.id, op.patch, now);
        results.push({
          ok: true,
          index,
          kind: op.kind,
          id: op.id,
          rev: written.meta_rev,
        });
      }
    } catch (error) {
      if (error instanceof DomainError) {
        // 单条失败不牵连其它：记下来继续
        results.push({
          ok: false,
          index,
          kind: op.kind,
          id: op.id,
          code: error.code,
          message: error.message,
          detail: error.detail,
        });
        continue;
      }
      throw error;
    }
  }

  return results;
}

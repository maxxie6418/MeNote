/**
 * 文件夹服务：新建、改名、移动（层级上限 2 层，需求 §4.5）。
 *
 * 加密空间（`is_enc_space = 1` 的内置记录）属 M3，M1 只处理普通文件夹（depth 1 / 2）。
 * 冲突按 `meta_rev` 乐观锁处理，**不生成冲突副本**（拆解 M13-04）。
 */
import { isUlid, type FolderPatch } from "@menote/shared";
import {
  SQL_BUMP_SYNC_SEQ_ON_FOLDER_CREATE,
  SQL_BUMP_SYNC_SEQ_ON_FOLDER_META,
  SQL_COUNT_FOLDER_CHILDREN,
  SQL_INSERT_FOLDER,
  SQL_SELECT_FOLDER_BY_ID,
  buildUpdateFolder,
  type FolderField,
} from "../db/tables";
import { DomainError } from "../errors";

/** 需求 §4.5：最多两层嵌套（第 1、2 层），加密空间 depth 0 属 M3 */
const MAX_FOLDER_DEPTH = 2;

interface FolderRow {
  id: string;
  parent_id: string | null;
  depth: number;
  meta_rev: number;
}

/** 读父节点；不存在或不属于当前用户都按"父文件夹不存在"处理 */
async function loadParent(
  db: D1Database,
  userId: string,
  parentId: string | null,
): Promise<FolderRow | null> {
  if (parentId === null) return null;
  const parent = await db
    .prepare(SQL_SELECT_FOLDER_BY_ID)
    .bind(parentId, userId)
    .first<FolderRow>();
  if (!parent) throw new DomainError("invalid", "父文件夹不存在");
  return parent;
}

function depthUnder(parent: FolderRow | null): number {
  const depth = parent === null ? 1 : parent.depth + 1;
  if (depth > MAX_FOLDER_DEPTH) {
    throw new DomainError("invalid", "文件夹最多两层");
  }
  return depth;
}

/** 新建文件夹（`POST /api/folders`）：ID 由客户端生成，ID 已存在时按重放处理 */
export async function createFolder(
  db: D1Database,
  userId: string,
  input: { id: string; parentId: string | null; name: string },
  now: number,
): Promise<{ id: string; meta_rev: number }> {
  if (!isUlid(input.id)) throw new DomainError("invalid", "文件夹 ID 格式不合法");

  const parent = await loadParent(db, userId, input.parentId);
  const depth = depthUnder(parent);

  const results = await db.batch([
    db
      .prepare(SQL_INSERT_FOLDER)
      .bind(input.id, userId, input.parentId, input.name, depth, userId, now, now, input.id),
    db.prepare(SQL_BUMP_SYNC_SEQ_ON_FOLDER_CREATE).bind(userId, input.id, now),
  ]);

  if ((results[0]?.meta.changes ?? 0) !== 1) {
    const existing = await db
      .prepare(SQL_SELECT_FOLDER_BY_ID)
      .bind(input.id, userId)
      .first<FolderRow>();
    if (existing) return { id: existing.id, meta_rev: existing.meta_rev };
    throw new DomainError("invalid", "文件夹已存在");
  }

  return { id: input.id, meta_rev: 1 };
}

/** 改名与移动（`PATCH /api/folders/:id`）：两者都是元数据操作，按 `meta_rev` 逐次判定 */
export async function patchFolder(
  db: D1Database,
  userId: string,
  id: string,
  patch: FolderPatch,
  now: number,
): Promise<{ id: string; meta_rev: number }> {
  const current = await db.prepare(SQL_SELECT_FOLDER_BY_ID).bind(id, userId).first<FolderRow>();
  if (!current) throw new DomainError("not_found", "文件夹不存在");
  if (current.meta_rev !== patch.base_meta_rev) {
    throw new DomainError("meta_conflict", "文件夹已在其他设备更新", { meta_rev: current.meta_rev });
  }

  const fields: FolderField[] = [];
  const values: unknown[] = [];

  if (patch.name !== undefined) {
    fields.push("name");
    values.push(patch.name);
  }

  if (patch.parent_id !== undefined) {
    const nextParentId = patch.parent_id;
    if (nextParentId === id) throw new DomainError("invalid", "不能把文件夹移动到自身");

    const nextParent = await loadParent(db, userId, nextParentId);
    const nextDepth = depthUnder(nextParent);
    if (nextParent !== null && nextParent.parent_id === id) {
      throw new DomainError("invalid", "不能移动到自己的子文件夹");
    }

    const children = await db
      .prepare(SQL_COUNT_FOLDER_CHILDREN)
      .bind(userId, id)
      .first<{ count: number }>();
    if ((children?.count ?? 0) > 0 && nextDepth + 1 > MAX_FOLDER_DEPTH) {
      throw new DomainError("invalid", "移动后子文件夹会超过两层");
    }

    if (nextDepth !== current.depth) {
      fields.push("depth");
      values.push(nextDepth);
    }
    fields.push("parent_id");
    values.push(nextParentId);
  }

  if (fields.length === 0) {
    return { id, meta_rev: patch.base_meta_rev };
  }

  const results = await db.batch([
    db
      .prepare(buildUpdateFolder(fields))
      .bind(...values, now, userId, id, userId, patch.base_meta_rev),
    db.prepare(SQL_BUMP_SYNC_SEQ_ON_FOLDER_META).bind(userId, id, patch.base_meta_rev + 1, now),
  ]);

  if ((results[0]?.meta.changes ?? 0) !== 1) {
    const after = await db.prepare(SQL_SELECT_FOLDER_BY_ID).bind(id, userId).first<FolderRow>();
    throw new DomainError("meta_conflict", "文件夹已在其他设备更新", {
      meta_rev: after?.meta_rev ?? patch.base_meta_rev,
    });
  }

  return { id, meta_rev: patch.base_meta_rev + 1 };
}

/**
 * 条目服务：新建、取正文、全文保存（口径见 `docs/modules/Menote-同步引擎设计-v1.md` §3.4）。
 *
 * **元数据补丁**在 `services/item-meta.ts`（2026-09-27 抽出：本文件顶到了 300 行预算，
 * 而补丁的校验规则已自成一块，与"创建 / 取正文 / 保存正文"是两条独立的演进线）。
 *
 * 写路径统一是"预检读 → 一个 batch（主写入 + 正文/副作用 + 条件推进计数器）"，判定冲突读
 * `results[0].meta.changes`；冲突时整批不产生任何改动。
 *
 * **已知取舍**：服务端不重算正文哈希（省掉大文档上的一次 SHA-256，10 ms CPU 预算内更稳），
 * 因此 `content_hash` 与正文的一致性由客户端保证；服务端只保证"写入原子 + 冲突不污染"。
 */
import {
  BODY_HARD_LIMIT_BYTES,
  countCodePoints,
  utf8ByteLength,
  type ItemType,
} from "@menote/shared";
import {
  SQL_BUMP_SYNC_SEQ_ON_ITEM_BODY,
  SQL_BUMP_SYNC_SEQ_ON_ITEM_CREATE,
  SQL_DELETE_ITEM_DRAFT_REFS,
  SQL_INSERT_ITEM,
  SQL_INSERT_ITEM_DRAFT_REFS,
  SQL_SELECT_ITEM_BODY,
  SQL_SELECT_ITEM_REV,
  SQL_UPDATE_ITEM_BODY,
  SQL_UPSERT_ITEM_BODY,
} from "../db/tables";
import { DomainError } from "../errors";
import type { StorageEnv } from "../types";
import { sealSessionVersionIfNeeded } from "./version-session";

export interface CreateItemInput {
  id: string;
  type: ItemType;
  title: string | null;
  folderId: string | null;
  tags: string[];
  memoAt: number | null;
  isTask: 0 | 1;
  taskStatus: string | null;
  taskDue: string | null;
  taskPriority: string | null;
  contentHash: string;
  body: string;
  deviceLabel: string | null;
}

export interface ItemBodyWriteResult {
  id: string;
  rev: number;
  bytes: number;
  chars: number;
}

interface ItemRevRow {
  rev: number;
  content_hash: string;
}

function tooLarge(): DomainError {
  return new DomainError("too_large", "已达硬上限，无法继续保存，请拆分内容");
}

/** 表级 CHECK 的等价校验：提前拦掉，避免把约束失败变成 500 */
function assertItemShape(input: CreateItemInput): void {
  if (input.type === "memo") {
    if (input.folderId !== null) throw new DomainError("invalid", "Memo 不能放在文件夹里");
    if (input.memoAt === null) throw new DomainError("invalid", "Memo 必须有时间戳");
    if (input.title !== null) throw new DomainError("invalid", "Memo 没有独立标题");
    return;
  }
  if (input.title === null) throw new DomainError("invalid", "笔记与表格必须有标题");
}

async function measure(body: string): Promise<{ bytes: number; chars: number }> {
  const bytes = utf8ByteLength(body);
  if (bytes > BODY_HARD_LIMIT_BYTES) throw tooLarge();
  return { bytes, chars: countCodePoints(body) };
}

/**
 * 新建（`PUT /api/items/:id`）：ID 由客户端生成。
 * 已存在时按内容哈希判定——相同视为幂等重放（200），不同返回 409（客户端据此生成冲突副本）。
 */
export async function createItem(
  db: D1Database,
  userId: string,
  input: CreateItemInput,
  now: number,
  /**
   * 追加到**同一次 batch** 的语句（M6 MCP 用：把审计行与幂等记录和主写入绑在一个事务里，
   * 架构 §十一「执行、审计与幂等记录（与写入在同一个 batch 中）」）。
   *
   * **默认空 = 行为与加这个参数之前完全一致**，同步路径与批量端点都不传，故零影响。
   */
  extra?: readonly D1PreparedStatement[],
): Promise<ItemBodyWriteResult> {
  assertItemShape(input);
  const { bytes, chars } = await measure(input.body);

  const existing = await db
    .prepare(SQL_SELECT_ITEM_REV)
    .bind(input.id, userId)
    .first<ItemRevRow>();
  if (existing) {
    if (existing.content_hash === input.contentHash) {
      return { id: input.id, rev: existing.rev, bytes, chars };
    }
    throw new DomainError("rev_conflict", "该条目已存在且内容不同", {
      rev: existing.rev,
      content_hash: existing.content_hash,
    });
  }

  const results = await db.batch([
    db
      .prepare(SQL_INSERT_ITEM)
      .bind(
        input.id,
        userId,
        input.type,
        input.folderId,
        input.title,
        bytes,
        input.contentHash,
        JSON.stringify(input.tags),
        input.memoAt,
        input.isTask,
        input.taskStatus,
        input.taskDue,
        input.taskPriority,
        0,
        0,
        userId,
        now,
        now,
        now,
        input.deviceLabel,
        input.id,
      ),
    db.prepare(SQL_UPSERT_ITEM_BODY).bind(input.id, input.body, input.id, userId, 1, input.contentHash),
    db.prepare(SQL_BUMP_SYNC_SEQ_ON_ITEM_CREATE).bind(userId, input.id, now),
    ...(extra ?? []),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 1) {
    return { id: input.id, rev: 1, bytes, chars };
  }

  // 极小窗口：预检后同一 id 被并发创建
  const after = await db.prepare(SQL_SELECT_ITEM_REV).bind(input.id, userId).first<ItemRevRow>();
  if (after && after.content_hash === input.contentHash) {
    return { id: input.id, rev: after.rev, bytes, chars };
  }
  throw new DomainError("rev_conflict", "该条目已存在且内容不同", {
    rev: after?.rev ?? 0,
    content_hash: after?.content_hash ?? "",
  });
}

/** 取正文（`GET /api/items/:id/body`）；不存在或不属于当前用户都返回 null */
export async function getItemBody(
  db: D1Database,
  userId: string,
  id: string,
): Promise<{ body: string; contentHash: string } | null> {
  const row = await db
    .prepare(SQL_SELECT_ITEM_BODY)
    .bind(id, userId)
    .first<{ body: string; content_hash: string }>();
  if (!row) return null;
  return { body: row.body, contentHash: row.content_hash };
}

/**
 * 全文保存（`PUT /api/items/:id/body`）。
 *
 * 预检把三种情况分开，**都不写库**：条目不存在（404）、上次其实已成功（200）、真冲突（409）。
 * 只有 `rev` 与基版本一致时才走 batch，避免"重放空推计数器"。
 *
 * **收 `env` 而不是 `db`**：预检通过后、写新正文之前，要按设计 §4.1 判定并封一条 `session` 版本
 * （换设备 / 距上次编辑超 1 小时），而封存要写 R2（`sealVersion` 需要桶）。放在这里而不是路由层，
 * 一是判定紧跟预检——冲突（409）与幂等重放（200）两条提前返回的路径都不会白封一条；
 * 二是批量端点（`POST /api/batch` 的 `save_body`）复用同一函数，能一起拿到这个行为。
 */
export async function saveItemBody(
  env: StorageEnv,
  userId: string,
  id: string,
  baseRev: number,
  contentHash: string,
  body: string,
  deviceLabel: string | null,
  now: number,
  /** 当前稿引用的 sha256 列表（M6 第一批 · 批 2a）；`undefined` = **不动引用表** */
  attachmentRefs?: readonly string[],
  /** 追加到同一次 batch 的语句；MCP 用它把审计行与幂等记录和正文写入绑在一个事务里。默认空 = 行为不变 */
  extra?: readonly D1PreparedStatement[],
): Promise<ItemBodyWriteResult> {
  const db = env.DB;
  const { bytes, chars } = await measure(body);

  const current = await db
    .prepare(SQL_SELECT_ITEM_REV)
    .bind(id, userId)
    .first<ItemRevRow>();
  if (!current) throw new DomainError("not_found", "条目不存在");
  if (current.rev !== baseRev) {
    if (current.content_hash === contentHash) {
      // 上次写入其实已成功，只是响应丢了
      return { id, rev: current.rev, bytes, chars };
    }
    throw new DomainError("rev_conflict", "版本冲突", {
      rev: current.rev,
      content_hash: current.content_hash,
    });
  }

  // 会话封存：读的是**保存前**的 `last_edit_at` / `last_device`（写入时会刷新这两列）
  await sealSessionVersionIfNeeded(env, userId, id, deviceLabel, now);

  const statements = [
    db
      .prepare(SQL_UPDATE_ITEM_BODY)
      .bind(bytes, contentHash, now, now, deviceLabel, userId, id, userId, baseRev),
    db.prepare(SQL_UPSERT_ITEM_BODY).bind(id, body, id, userId, baseRev + 1, contentHash),
    db
      .prepare(SQL_BUMP_SYNC_SEQ_ON_ITEM_BODY)
      .bind(userId, id, baseRev + 1, contentHash),
  ];

  /*
   * 引用集合与正文**同一次 batch**（M6 第一批 · 批 2a）——这一步的原子性不是洁癖：
   * 孤儿判定只看 `attachment_refs`。若正文已存、引用表还没跟上，那张仍在正文里显示的图
   * 会被 `SQL_MARK_ORPHANS_OF_USER` 标成孤儿，**30 天后由每日维护真删掉 R2 对象**，
   * 于是笔记里的图凭空消失。分成两次请求就留下这个窗口。
   *
   * `undefined`（客户端没带 `X-Menote-Refs`）= 引用表**一个字都不动**；带空数组 = 清空
   * 当前稿的引用。两条路径的差别是刻意的，见 shared 的 `decodeAttachmentRefs`。
   *
   * 已知的极小竞态：下面 `results[0].meta.changes === 0` 那条「预检通过后被并发抢先」的
   * 路径上，引用已经被换掉了而正文不是我们的。它会自愈——抢先那次保存同样会带自己的引用，
   * 且那个窗口比上面避免的「正文与引用不一致满 30 天」小几个数量级，不值得为它拆开 batch。
   */
  if (attachmentRefs !== undefined) {
    statements.push(
      db.prepare(SQL_DELETE_ITEM_DRAFT_REFS).bind(userId, id),
      db
        .prepare(SQL_INSERT_ITEM_DRAFT_REFS)
        .bind(id, now, userId, JSON.stringify(attachmentRefs)),
    );
  }

  // 审计行与幂等记录跟主写入同一个事务：写成功但审计丢失，正是审计要防的那种事
  if (extra !== undefined) statements.push(...extra);

  const results = await db.batch(statements);

  if ((results[0]?.meta.changes ?? 0) === 1) {
    return { id, rev: baseRev + 1, bytes, chars };
  }

  // 极小窗口：预检通过后被并发抢先
  const after = await db.prepare(SQL_SELECT_ITEM_REV).bind(id, userId).first<ItemRevRow>();
  if (after && after.content_hash === contentHash) {
    return { id, rev: after.rev, bytes, chars };
  }
  throw new DomainError("rev_conflict", "版本冲突", {
    rev: after?.rev ?? baseRev,
    content_hash: after?.content_hash ?? "",
  });
}

/** 元数据补丁（`PATCH /api/items/:id/meta`）：按 `meta_rev` 乐观锁，不生成冲突副本 */

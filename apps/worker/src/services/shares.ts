/**
 * 分享的**管理侧**服务（M5-S1；架构 §十；《M5 分享设计》§一~五）：
 * 创建 / 列表 / 改密改期 / 撤销。访客侧（状态 / 解锁 / 正文 / 附件）在
 * `services/share-public.ts`——路由也是这么分的（`routes/shares.ts` / `routes/public.ts`）。
 *
 * 创建走 `INSERT … SELECT` **同语句校验**（架构定稿原文："服务端在同一语句中校验条目
 * 非隐私条目（无 `in_enc_space` / `enc_self` 标记）、未删除，不满足则拒绝"）：
 * 条目不存在、已删、任一隐私标记命中，`changes = 0`，当场拒绝。
 *
 * 密码材料（盐 / KDF 参数 / 校验值）只在创建与改密时写入，任何响应不回显
 * （管理侧只回 `has_password` 布尔）；撤销立即生效（`revoked_at` 落库，
 * 访客侧每次访问实时检查，见 share-public）。
 */
import {
  base64UrlDecode,
  newShareId,
  type CreateShareRequest,
  type PatchShareRequest,
  type ShareListResponse,
  type ShareRecord,
} from "@menote/shared";
import {
  SQL_INSERT_SHARE,
  SQL_REVOKE_SHARE,
  SQL_SELECT_SHARES_BY_USER,
  SQL_UPDATE_SHARE_CLEAR_PASSWORD,
  SQL_UPDATE_SHARE_EXPIRY,
  SQL_UPDATE_SHARE_PASSWORD,
} from "../db/tables";
import { DomainError } from "../errors";
import { loadShare, type ShareFullRow } from "./share-public";

function mapShareRecord(row: ShareFullRow): ShareRecord {
  return {
    id: row.id,
    kind: row.kind,
    item_id: row.item_id,
    item_title: row.item_title,
    item_type: row.item_type,
    has_password: row.pw_verifier !== null,
    expires_at: row.expires_at,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
  };
}

/** 单条取回并核归属（管理侧回显用） */
async function getOwnShare(db: D1Database, userId: string, sid: string): Promise<ShareRecord> {
  const row = await loadShare(db, sid);
  if (!row || row.user_id !== userId) throw new DomainError("not_found", "分享不存在");
  return mapShareRecord(row);
}

export async function createShare(
  db: D1Database,
  userId: string,
  input: CreateShareRequest,
  now: number,
): Promise<ShareRecord> {
  if (input.expires_at !== undefined && input.expires_at !== null && input.expires_at <= now) {
    throw new DomainError("invalid", "过期时间必须晚于现在");
  }
  const material = input.password ?? null;
  const sid = newShareId();
  const result = await db
    .prepare(SQL_INSERT_SHARE)
    .bind(
      sid,
      userId,
      input.item_id,
      material ? base64UrlDecode(material.salt) : null,
      material ? JSON.stringify(material.kdf) : null,
      material ? base64UrlDecode(material.verifier) : null,
      input.expires_at ?? null,
      now,
      // 同语句校验（见文件头）：不满足时 SELECT 空集，changes = 0
      input.item_id,
      userId,
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new DomainError("invalid", "这条内容不能分享（可能已删除或带隐私标记）", {
      reason: "item_not_shareable",
    });
  }
  return getOwnShare(db, userId, sid);
}

export async function listShares(db: D1Database, userId: string): Promise<ShareListResponse> {
  const rows = await db
    .prepare(SQL_SELECT_SHARES_BY_USER)
    .bind(userId)
    .all<{
      id: string;
      kind: "item" | "memo_set";
      item_id: string | null;
      title: string | null;
      has_password: number;
      expires_at: number | null;
      created_at: number;
      revoked_at: number | null;
      item_title: string | null;
      item_type: string | null;
    }>();
  return {
    shares: rows.results.map((row) => ({
      id: row.id,
      kind: row.kind,
      item_id: row.item_id,
      item_title: row.item_title,
      item_type: row.item_type,
      has_password: row.has_password === 1,
      expires_at: row.expires_at,
      created_at: row.created_at,
      revoked_at: row.revoked_at,
    })),
  };
}

export async function patchShare(
  db: D1Database,
  userId: string,
  sid: string,
  input: PatchShareRequest,
  now: number,
): Promise<ShareRecord> {
  if (input.expires_at !== undefined && input.expires_at !== null && input.expires_at <= now) {
    throw new DomainError("invalid", "过期时间必须晚于现在");
  }

  if (input.expires_at !== undefined) {
    const result = await db
      .prepare(SQL_UPDATE_SHARE_EXPIRY)
      .bind(input.expires_at, sid, userId)
      .run();
    if ((result.meta.changes ?? 0) !== 1) throw new DomainError("not_found", "分享不存在");
  }
  if (input.password !== undefined) {
    const material = input.password;
    const result = material
      ? await db
          .prepare(SQL_UPDATE_SHARE_PASSWORD)
          .bind(
            base64UrlDecode(material.salt),
            JSON.stringify(material.kdf),
            base64UrlDecode(material.verifier),
            sid,
            userId,
          )
          .run()
      : await db.prepare(SQL_UPDATE_SHARE_CLEAR_PASSWORD).bind(sid, userId).run();
    if ((result.meta.changes ?? 0) !== 1) throw new DomainError("not_found", "分享不存在");
  }
  if (input.expires_at === undefined && input.password === undefined) {
    throw new DomainError("invalid", "没有要修改的内容");
  }
  return getOwnShare(db, userId, sid);
}

export async function revokeShare(
  db: D1Database,
  userId: string,
  sid: string,
  now: number,
): Promise<ShareRecord> {
  const result = await db.prepare(SQL_REVOKE_SHARE).bind(now, sid, userId).run();
  if ((result.meta.changes ?? 0) !== 1) throw new DomainError("not_found", "分享不存在");
  return getOwnShare(db, userId, sid);
}

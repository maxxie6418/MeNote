/**
 * 会话的创建、校验、滑动续期与删除（口径见 `docs/modules/Menote-认证与会话设计-v1.md` §4）。
 *
 * 库里只存令牌的 SHA-256；有效期滑动 30 天；`last_seen_at` 每天最多写一次（需求 §5.4），
 * 因此常规请求只有 1 次读、跨天时多 1 次写。
 */
import { SESSION_TOUCH_INTERVAL_MS, SESSION_TTL_MS, type UserRole } from "@menote/shared";
import {
  SQL_COUNT_OTHER_SESSIONS,
  SQL_DELETE_OTHER_SESSIONS,
  SQL_DELETE_SESSION,
  SQL_INSERT_SESSION,
  SQL_SELECT_SESSION_USER,
  SQL_TOUCH_SESSION,
} from "../db/tables";
import type { SessionUser } from "../types";
import { generateSessionToken, hashSessionToken } from "./tokens";

interface SessionRow {
  id: string;
  username: string;
  role: string;
  expires_at: number;
}

/** 建立会话；返回明文令牌（只在此刻出现一次，随后只以 HttpOnly Cookie 形式存在） */
export async function createSession(
  db: D1Database,
  userId: string,
  deviceLabel: string | null,
  now: number,
): Promise<{ token: string; tokenHash: ArrayBuffer }> {
  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);
  if (!tokenHash) throw new Error("生成的会话令牌无法哈希");

  await db
    .prepare(SQL_INSERT_SESSION)
    .bind(tokenHash, userId, deviceLabel, now, now + SESSION_TTL_MS, now)
    .run();

  return { token, tokenHash };
}

/**
 * 校验会话并取回用户身份；过期会话顺手删除。
 * 令牌非法（非 base64url）、不存在、已过期都返回 null —— 一律按未登录处理，不抛错。
 */
export async function resolveSession(
  db: D1Database,
  token: string,
  now: number,
): Promise<{ user: SessionUser; tokenHash: ArrayBuffer } | null> {
  const tokenHash = await hashSessionToken(token);
  if (!tokenHash) return null;

  const row = await db
    .prepare(SQL_SELECT_SESSION_USER)
    .bind(tokenHash)
    .first<SessionRow>();
  if (!row) return null;

  if (row.expires_at <= now) {
    await db.prepare(SQL_DELETE_SESSION).bind(tokenHash).run();
    return null;
  }

  // 滑动续期：last_seen_at 早于"一天前"才写（需求 §5.4）
  await db
    .prepare(SQL_TOUCH_SESSION)
    .bind(now, now + SESSION_TTL_MS, tokenHash, now - SESSION_TOUCH_INTERVAL_MS)
    .run();

  const role: UserRole = row.role === "owner" ? "owner" : "member";
  return { user: { id: row.id, username: row.username, role }, tokenHash };
}

/** 登出：删除当前会话行 */
export async function deleteSession(db: D1Database, tokenHash: ArrayBuffer): Promise<void> {
  await db.prepare(SQL_DELETE_SESSION).bind(tokenHash).run();
}

/** 改密后使其他设备会话全部失效；返回被失效的数量（当前设备保留） */
export async function invalidateOtherSessions(
  db: D1Database,
  userId: string,
  keepTokenHash: ArrayBuffer,
): Promise<number> {
  const row = await db
    .prepare(SQL_COUNT_OTHER_SESSIONS)
    .bind(userId, keepTokenHash)
    .first<{ count: number }>();
  const count = row?.count ?? 0;
  if (count > 0) {
    await db.prepare(SQL_DELETE_OTHER_SESSIONS).bind(userId, keepTokenHash).run();
  }
  return count;
}

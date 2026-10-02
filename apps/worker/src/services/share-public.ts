/**
 * 分享的**访客侧**服务（M5-S1；架构 §十；《M5 分享设计》§一~五）。
 * 管理侧（创建 / 列表 / 改密改期 / 撤销）在 `services/shares.ts`——路由也是这么分的
 * （`routes/public.ts` / `routes/shares.ts`），两摊各自独立成文。
 *
 * 两条主线：
 * 1. **实时有效性**：每次访问都重查分享行与条目侧的删除与隐私标记（架构定稿
 *    "每次访问实时检查……任一不满足即返回链接已失效"），所以"条目被加密 / 移入回收站
 *    → 链接立即失效"不需要任何后台任务。
 * 2. **访问令牌**：无状态 HMAC 签名（1 小时），密钥 = HKDF-SHA256(`AUTH_PEPPER`,
 *    info=`menote-share-v1`)，不写库、不可续期；过期或签名不符一律拒绝。
 *    令牌放 `X-Menote-Share` 头，不进 URL（避免进日志与历史记录）。
 *
 * 安全底线（设计稿 §五）：凭据与校验值**任何接口不回显**；unlock 失败按
 * `share:<sid>:<ip>` 计次限速（内存计数起步，设计稿 §六-4 已登记）。
 */
import {
  base64UrlDecode,
  base64UrlEncode,
  base64UrlEncodeUtf8,
  base64UrlDecodeUtf8,
  extractAttachmentRefs,
  SHARE_TOKEN_CONTEXT,
  SHARE_TOKEN_TTL_MS,
  type PublicShareStatus,
  type ShareContent,
  type UnlockResponse,
} from "@menote/shared";
import {
  SQL_SELECT_ATTACHMENT_FOR_SHARE,
  SQL_SELECT_SHARE_BODY,
  SQL_SELECT_SHARE_FULL,
} from "../db/tables";
import { getBlob } from "../adapters/r2";
import { DomainError } from "../errors";
import { requirePepper } from "./crypto";
import type { EnvBindings } from "../types";

// ——————————————————————————— 访问令牌 ———————————————————————————

/** 签名密钥 = HKDF-SHA256(ikm=`AUTH_PEPPER` 字节, salt 空, info=`menote-share-v1`) → 32 字节 HMAC 密钥 */
async function shareSigningKey(env: EnvBindings, usages: Array<"sign" | "verify">): Promise<CryptoKey> {
  const pepper = requirePepper(env);
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(SHARE_TOKEN_CONTEXT) },
    base,
    256,
  );
  return crypto.subtle.importKey("raw", bits, { name: "HMAC", hash: "SHA-256" }, false, usages);
}

/** 逐字节比较（长度不同立即假；内容比较不短路，避免时序侧漏） */
function byteEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

/** 令牌 = base64url(`<sid>.<过期毫秒>`) + "." + base64url(HMAC)；过期时间在签名内，改不了 */
async function issueShareToken(env: EnvBindings, sid: string, now: number): Promise<string> {
  const payload = `${sid}.${now + SHARE_TOKEN_TTL_MS}`;
  const key = await shareSigningKey(env, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${base64UrlEncodeUtf8(payload)}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** 校验令牌：签名对、未过期、且确属这个 sid。任何不满足都返回 false（不区分原因，防探测） */
async function verifyShareToken(
  env: EnvBindings,
  token: string,
  sid: string,
  now: number,
): Promise<boolean> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;
  let payload: string;
  let signature: Uint8Array<ArrayBuffer>;
  try {
    payload = base64UrlDecodeUtf8(token.slice(0, dot));
    signature = base64UrlDecode(token.slice(dot + 1));
  } catch {
    return false;
  }
  const sep = payload.lastIndexOf(".");
  if (sep <= 0) return false;
  if (payload.slice(0, sep) !== sid) return false;
  const exp = Number(payload.slice(sep + 1));
  if (!Number.isInteger(exp) || exp <= now) return false;

  const key = await shareSigningKey(env, ["verify"]);
  return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(payload));
}

// ——————————————————————————— 解锁限速（内存计数起步） ———————————————————————————

const UNLOCK_WINDOW_MS = 15 * 60 * 1000;
const UNLOCK_MAX_FAILURES = 10;
const unlockFailures = new Map<string, { count: number; resetAt: number }>();

/** 仅供测试：清掉 isolate 内的失败计数 */
export function resetShareUnlockLimitForTests(): void {
  unlockFailures.clear();
}

function assertUnlockAllowed(key: string, now: number): void {
  const entry = unlockFailures.get(key);
  if (!entry) return;
  if (entry.resetAt <= now) {
    unlockFailures.delete(key);
    return;
  }
  if (entry.count >= UNLOCK_MAX_FAILURES) {
    throw new DomainError("rate_limited", "尝试次数过多，请稍后再试");
  }
}

function recordUnlockFailure(key: string, now: number): void {
  const entry = unlockFailures.get(key);
  if (!entry || entry.resetAt <= now) {
    unlockFailures.set(key, { count: 1, resetAt: now + UNLOCK_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

// ——————————————————————————— 实时有效性 ———————————————————————————

export interface ShareFullRow {
  id: string;
  user_id: string;
  kind: "item" | "memo_set";
  item_id: string | null;
  /** shares.title：Memo 合集的标题（单条分享恒 NULL） */
  title: string | null;
  pw_salt: ArrayBuffer | null;
  pw_kdf: string | null;
  pw_verifier: ArrayBuffer | null;
  expires_at: number | null;
  created_at: number;
  revoked_at: number | null;
  /** 条目行存在才有（永久删除后 join 不到 → 分享必须失效） */
  item_row_id: string | null;
  item_title: string | null;
  item_type: string | null;
  item_deleted_at: number | null;
  item_enc_self: number | null;
  item_in_enc_space: number | null;
}

export async function loadShare(db: D1Database, sid: string): Promise<ShareFullRow | null> {
  return (await db.prepare(SQL_SELECT_SHARE_FULL).bind(sid).first<ShareFullRow>()) ?? null;
}

/** 架构定稿：撤销、过期、条目进回收站、条目被加密——任一不满足即失效 */
export function isShareLive(row: ShareFullRow, now: number): boolean {
  if (row.revoked_at !== null) return false;
  if (row.expires_at !== null && row.expires_at <= now) return false;
  if (row.kind === "item") {
    if (row.item_row_id === null || row.item_deleted_at !== null) return false;
    if (row.item_enc_self !== 0 || row.item_in_enc_space !== 0) return false;
  }
  return true;
}

// ——————————————————————————— 访客接口 ———————————————————————————

export async function getPublicShareStatus(
  db: D1Database,
  sid: string,
  now: number,
): Promise<PublicShareStatus> {
  const row = await loadShare(db, sid);
  if (!row || !isShareLive(row, now)) {
    return { status: "invalid", requires_password: false };
  }
  const requiresPassword = row.pw_verifier !== null;
  return {
    status: "ok",
    requires_password: requiresPassword,
    kind: row.kind,
    // 条目标题随 content 接口给；合集标题（后置）才在状态里
    title: row.kind === "memo_set" ? row.title : null,
    ...(row.pw_salt !== null && row.pw_kdf !== null
      ? {
          kdf: JSON.parse(row.pw_kdf) as PublicShareStatus["kdf"],
          salt: base64UrlEncode(new Uint8Array(row.pw_salt)),
        }
      : {}),
  };
}

export async function unlockShare(
  env: EnvBindings,
  db: D1Database,
  sid: string,
  verifier: string | undefined,
  ip: string,
  now: number,
): Promise<UnlockResponse> {
  const limitKey = `${sid}:${ip}`;
  assertUnlockAllowed(limitKey, now);
  const row = await loadShare(db, sid);
  if (!row || !isShareLive(row, now)) return { status: "invalid" };

  if (row.pw_verifier === null) {
    // 无密码分享：unlock 只发令牌（查看器统一走这条路径拿访问凭据）
    unlockFailures.delete(limitKey);
    return { status: "ok", token: await issueShareToken(env, sid, now) };
  }
  if (verifier === undefined || verifier.length === 0) {
    return { status: "wrong_password" };
  }

  let submitted: Uint8Array<ArrayBuffer>;
  try {
    submitted = base64UrlDecode(verifier);
  } catch {
    return { status: "wrong_password" };
  }
  // 常量时间比对（定稿的「HMAC 比对」）：两侧校验值**各算一次 HMAC** 再比摘要——
  // 直接 memcmp 会把派生值的时序侧漏给攻击者；比 HMAC 摘要则无此问题。
  // D1 的 BLOB 行读回来在不同运行时可能是 Uint8Array 或数字数组，统一收成 Uint8Array。
  const key = await shareSigningKey(env, ["sign"]);
  const stored = row.pw_verifier instanceof Uint8Array ? row.pw_verifier : new Uint8Array(row.pw_verifier);
  const storedDigest = await crypto.subtle.sign("HMAC", key, stored);
  const submittedDigest = await crypto.subtle.sign("HMAC", key, submitted);
  const matched = byteEquals(new Uint8Array(storedDigest), new Uint8Array(submittedDigest));
  if (!matched) {
    recordUnlockFailure(limitKey, now);
    return { status: "wrong_password" };
  }
  unlockFailures.delete(limitKey);
  return { status: "ok", token: await issueShareToken(env, sid, now) };
}

/** 令牌 + 实时有效性一次过：content / att 两个公开接口共用的守门 */
async function assertShareAccessible(
  env: EnvBindings,
  db: D1Database,
  sid: string,
  token: string,
  now: number,
): Promise<ShareFullRow> {
  if (!(await verifyShareToken(env, token, sid, now))) {
    throw new DomainError("invalid", "访问凭据无效，请重新打开链接");
  }
  const row = await loadShare(db, sid);
  if (!row || !isShareLive(row, now)) {
    throw new DomainError("not_found", "链接已失效");
  }
  return row;
}

export interface ShareAttachmentBlob {
  body: ReadableStream | null;
  size: number;
  mime: string;
  filename: string;
}

export async function getShareContent(
  env: EnvBindings,
  db: D1Database,
  sid: string,
  token: string,
  now: number,
): Promise<ShareContent> {
  const row = await assertShareAccessible(env, db, sid, token, now);
  // 首期只做单条分享（用户 2026-10-02 拍板合集后置）；share_items 表已建、接口随合集开工再放
  if (row.kind !== "item" || row.item_id === null) {
    throw new DomainError("invalid", "该分享形态暂未开放");
  }
  const body = await db.prepare(SQL_SELECT_SHARE_BODY).bind(row.item_id).first<{
    body: string;
    item_id: string;
    type: string;
    title: string | null;
    updated_at: number;
    user_id: string;
  }>();
  // 正文行缺失或归属对不上（理论上不可能，防御到底）：当作失效，不回内容
  if (!body || body.user_id !== row.user_id) {
    throw new DomainError("not_found", "链接已失效");
  }
  return {
    kind: "item",
    item: {
      id: body.item_id,
      type: body.type,
      title: body.title,
      body: body.body,
      updated_at: body.updated_at,
    },
  };
}

export async function getShareAttachment(
  env: EnvBindings,
  db: D1Database,
  sid: string,
  sha256: string,
  token: string,
  now: number,
): Promise<ShareAttachmentBlob> {
  const row = await assertShareAccessible(env, db, sid, token, now);
  if (row.kind !== "item" || row.item_id === null) {
    throw new DomainError("invalid", "该分享形态暂未开放");
  }
  // 只放行「当前稿正文里真的引用了」的附件：以正文为准，不查引用表（引用集合对齐是 M6 遗留）
  const bodyRow = await db.prepare(SQL_SELECT_SHARE_BODY).bind(row.item_id).first<{
    body: string;
    user_id: string;
  }>();
  const refs = extractAttachmentRefs(bodyRow?.body ?? "");
  if (!refs.includes(sha256.toLowerCase())) {
    throw new DomainError("not_found", "附件不在分享内容里");
  }

  const attachment = await db
    .prepare(SQL_SELECT_ATTACHMENT_FOR_SHARE)
    .bind(row.user_id, sha256.toLowerCase())
    .first<{ r2_key: string; mime: string | null; filename: string | null }>();
  if (!attachment) throw new DomainError("not_found", "附件不存在");

  const blob = await getBlob(env, attachment.r2_key);
  if (!blob || !blob.body) throw new DomainError("not_found", "附件不存在");
  return {
    body: blob.body,
    size: blob.size,
    mime: attachment.mime ?? "application/octet-stream",
    filename: attachment.filename ?? "attachment",
  };
}

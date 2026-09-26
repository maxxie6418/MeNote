/**
 * 认证服务：prelogin / 注册 / 登录 / 改密（口径见 `docs/modules/Menote-认证与会话设计-v1.md` §2、§3）。
 *
 * 分工：慢哈希（PBKDF2）在浏览器；服务端只做一次 HMAC 比对。
 * 所有对外错误都抛 `DomainError`，由入口统一转成架构 §4.3 的错误体。
 */
import {
  LOGIN_KDF_DEFAULT,
  newUlid,
  type AuthKdfParams,
  type PreloginResponse,
  type UserRole,
} from "@menote/shared";
import {
  SQL_DELETE_THROTTLE,
  SQL_INSERT_USER,
  SQL_SELECT_THROTTLE,
  SQL_SELECT_USER_BY_ID,
  SQL_SELECT_USER_BY_USERNAME,
  SQL_UPDATE_USER_PASSWORD,
  SQL_UPSERT_THROTTLE,
} from "../db/tables";
import { DomainError } from "../errors";
import type { SessionUser } from "../types";
import { createSession, invalidateOtherSessions } from "./sessions";
import {
  deriveAuthVerifier,
  deriveFakeSalt,
  generateSalt,
  timingSafeEqual,
  toBase64Url,
} from "./tokens";

/** 第 5 次失败开始冷却；此后每次翻倍，上限 15 分钟（设计稿 §3.2） */
const THROTTLE_FREE_ATTEMPTS = 5;
const THROTTLE_BASE_LOCK_MS = 30_000;
const THROTTLE_MAX_LOCK_MS = 900_000;

interface UserRow {
  id: string;
  username: string;
  role: string;
  auth_salt: ArrayBuffer;
  auth_kdf: string;
  auth_verifier: ArrayBuffer;
  status: string;
}

interface ThrottleRow {
  window_start: number;
  failures: number;
  locked_until: number | null;
}

export interface AuthResult {
  token: string;
  user: SessionUser;
}

function roleOf(value: string): UserRole {
  return value === "owner" ? "owner" : "member";
}

/** `auth_kdf` 存的是 JSON；内容不可信时退回默认参数（老用户字段格式变更也不会锁死账号） */
function parseKdf(json: string): AuthKdfParams {
  try {
    const parsed = JSON.parse(json) as Partial<AuthKdfParams>;
    if (
      parsed.alg === LOGIN_KDF_DEFAULT.alg &&
      typeof parsed.iterations === "number" &&
      typeof parsed.saltBytes === "number" &&
      typeof parsed.dkLen === "number"
    ) {
      return {
        alg: parsed.alg,
        iterations: parsed.iterations,
        saltBytes: parsed.saltBytes,
        dkLen: parsed.dkLen,
      };
    }
  } catch {
    // 落到默认参数
  }
  return { ...LOGIN_KDF_DEFAULT };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE");
}

function throttleKeys(username: string, clientIp: string): string[] {
  return [`login:${username.toLowerCase()}`, `login-ip:${clientIp}`];
}

async function assertNotThrottled(db: D1Database, keys: string[], now: number): Promise<void> {
  let retryAfterMs = 0;
  for (const key of keys) {
    const row = await db.prepare(SQL_SELECT_THROTTLE).bind(key).first<ThrottleRow>();
    if (row?.locked_until && row.locked_until > now) {
      retryAfterMs = Math.max(retryAfterMs, row.locked_until - now);
    }
  }
  if (retryAfterMs > 0) {
    const seconds = Math.ceil(retryAfterMs / 1000);
    throw new DomainError("rate_limited", `尝试过于频繁，请 ${seconds} 秒后再试`, {
      retry_after: seconds,
    });
  }
}

async function recordFailure(db: D1Database, keys: string[], now: number): Promise<void> {
  for (const key of keys) {
    const row = await db.prepare(SQL_SELECT_THROTTLE).bind(key).first<ThrottleRow>();
    const failures = (row?.failures ?? 0) + 1;
    const lockedUntil =
      failures >= THROTTLE_FREE_ATTEMPTS
        ? now +
          Math.min(
            THROTTLE_BASE_LOCK_MS * 2 ** (failures - THROTTLE_FREE_ATTEMPTS),
            THROTTLE_MAX_LOCK_MS,
          )
        : null;
    await db
      .prepare(SQL_UPSERT_THROTTLE)
      .bind(key, row?.window_start ?? now, failures, lockedUntil)
      .run();
  }
}

async function clearFailures(db: D1Database, keys: string[]): Promise<void> {
  for (const key of keys) {
    await db.prepare(SQL_DELETE_THROTTLE).bind(key).run();
  }
}

/** `POST /api/auth/prelogin`：返回盐与 KDF 参数；不存在的用户名返回确定性假盐 */
export async function prelogin(db: D1Database, pepper: string, username: string): Promise<PreloginResponse> {
  const row = await db
    .prepare(SQL_SELECT_USER_BY_USERNAME)
    .bind(username)
    .first<UserRow>();

  if (row) {
    return { auth_salt: toBase64Url(row.auth_salt), auth_kdf: parseKdf(row.auth_kdf) };
  }

  const kdf = { ...LOGIN_KDF_DEFAULT };
  const fakeSalt = await deriveFakeSalt(pepper, username, kdf.saltBytes);
  return { auth_salt: toBase64Url(fakeSalt), auth_kdf: kdf };
}

/**
 * `POST /api/auth/register`：单条语句同时判定"库中无用户"或"注册开关开启且未到期"，
 * 并在库中无用户时写 `role = 'owner'`（架构 §13.1）。成功后自动登录。
 */
export async function register(
  db: D1Database,
  pepper: string,
  input: { username: string; loginKey: string },
  now: number,
): Promise<AuthResult> {
  const salt = generateSalt(LOGIN_KDF_DEFAULT.saltBytes);
  const verifier = await deriveAuthVerifier(pepper, input.loginKey);
  const kdfJson = JSON.stringify(LOGIN_KDF_DEFAULT);
  const id = newUlid(now);

  // catch 分支一律抛错，因此这里不需要初始化值
  let changes: number;
  try {
    const result = await db
      .prepare(SQL_INSERT_USER)
      .bind(id, input.username, salt.raw, kdfJson, verifier, now, now, now)
      .run();
    changes = result.meta.changes ?? 0;
  } catch (error) {
    // username 有 UNIQUE COLLATE NOCASE：重名会抛约束异常，而不是"影响 0 行"
    if (isUniqueViolation(error)) throw new DomainError("invalid", "用户名已被占用");
    throw error;
  }

  if (changes !== 1) {
    const existing = await db
      .prepare(SQL_SELECT_USER_BY_USERNAME)
      .bind(input.username)
      .first<{ id: string }>();
    if (existing) throw new DomainError("invalid", "用户名已被占用");
    throw new DomainError("forbidden", "注册未开放");
  }

  const created = await db.prepare(SQL_SELECT_USER_BY_ID).bind(id).first<UserRow>();
  const user: SessionUser = {
    id,
    username: created?.username ?? input.username,
    role: roleOf(created?.role ?? "member"),
  };
  const session = await createSession(db, id, null, now);
  return { token: session.token, user };
}

/** `POST /api/auth/login`：错误一律回同一文案，不区分"用户不存在/密码错"（需求 §5.3） */
export async function login(
  db: D1Database,
  pepper: string,
  input: { username: string; loginKey: string },
  clientIp: string,
  now: number,
): Promise<AuthResult> {
  const keys = throttleKeys(input.username, clientIp);
  await assertNotThrottled(db, keys, now);

  const row = await db
    .prepare(SQL_SELECT_USER_BY_USERNAME)
    .bind(input.username)
    .first<UserRow>();
  // 无论用户是否存在都算一次 verifier，避免靠响应耗时区分用户名是否存在
  const verifier = await deriveAuthVerifier(pepper, input.loginKey);
  const ok = row !== null && row.status === "active" && timingSafeEqual(row.auth_verifier, verifier);

  if (!ok || row === null) {
    await recordFailure(db, keys, now);
    throw new DomainError("unauthenticated", "用户名或密码错误");
  }

  await clearFailures(db, keys);
  const session = await createSession(db, row.id, null, now);
  return {
    token: session.token,
    user: { id: row.id, username: row.username, role: roleOf(row.role) },
  };
}

/**
 * `POST /api/auth/password`：先按旧登录密钥校验，再写新盐 / 新 KDF 参数 / 新校验值；
 * 保留当前设备会话，其他设备会话全部失效（拆解 M01-05 的建议）。
 */
export async function changePassword(
  db: D1Database,
  pepper: string,
  user: SessionUser,
  tokenHash: ArrayBuffer,
  input: { loginKey: string; newLoginKey: string; newKdf?: AuthKdfParams },
  now: number,
): Promise<{ invalidatedSessions: number }> {
  const row = await db.prepare(SQL_SELECT_USER_BY_ID).bind(user.id).first<UserRow>();
  if (!row || row.status !== "active") {
    throw new DomainError("unauthenticated", "登录已失效，请重新登录");
  }

  const verifier = await deriveAuthVerifier(pepper, input.loginKey);
  if (!timingSafeEqual(row.auth_verifier, verifier)) {
    throw new DomainError("unauthenticated", "当前登录密码不正确");
  }

  const kdf = input.newKdf ?? { ...LOGIN_KDF_DEFAULT };
  const salt = generateSalt(kdf.saltBytes);
  const newVerifier = await deriveAuthVerifier(pepper, input.newLoginKey);

  await db
    .prepare(SQL_UPDATE_USER_PASSWORD)
    .bind(salt.raw, JSON.stringify(kdf), newVerifier, now, user.id)
    .run();

  const invalidatedSessions = await invalidateOtherSessions(db, user.id, tokenHash);
  return { invalidatedSessions };
}

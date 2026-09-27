/**
 * 隐私锁的门禁材料服务（架构 §2.3.2：`routes/crypto.ts` + `services/crypto.ts`；《隐私锁设计》§4）。
 *
 * 服务端在这里只做三件事：
 * 1. 存取材料（`user_crypto` 一行，四个端点）；
 * 2. **校验材料形状**（BLOB 长度、KDF 白名单），不合格一律 `invalid`——防住"客户端写坏后再也解不开"；
 * 3. "重置隐私密码"时用 `BACKUP_CRED_KEY` 解出内容密钥 K 交给浏览器（这是服务端**唯一**碰密钥的地方）。
 *
 * 服务端**不参与**日常的密码校验：解锁是浏览器本地对照 `verifier`，服务端连明文密码都见不到。
 */
import {
  BACKUP_CRED_KEY_SECRET,
  CRYPTO_IV_BYTES,
  CRYPTO_KEY_BYTES,
  CRYPTO_SALT_BYTES,
  CRYPTO_TAG_BYTES,
  CRYPTO_VERIFIER_BYTES,
  CRYPTO_WRAPPED_BYTES,
  cryptoBlobFromBase64Url,
  cryptoBlobToBase64Url,
  packCryptoBlob,
  unpackCryptoBlob,
  type CryptoMaterials,
  type CryptoResetResponse,
  type CryptoState,
  type CryptoWrite,
} from "@menote/shared";
import {
  SQL_COUNT_PRIVACY_ITEMS,
  SQL_DELETE_USER_CRYPTO,
  SQL_SELECT_USER_CRYPTO,
  SQL_UPSERT_USER_CRYPTO,
} from "../db/tables";
import { DomainError } from "../errors";
import type { EnvBindings } from "../types";

interface CryptoRow {
  kdf: string;
  kdf_iterations: number;
  kdf_salt: ArrayBuffer;
  verifier: ArrayBuffer;
  k_wrapped_pw: ArrayBuffer;
  k_wrapped_backup: ArrayBuffer;
  rev: number;
  updated_at: number;
}

function toBase64Url(value: ArrayBuffer): string {
  return cryptoBlobToBase64Url(new Uint8Array(value));
}

function toMaterials(row: CryptoRow): CryptoMaterials {
  return {
    kdf: row.kdf as CryptoMaterials["kdf"],
    kdf_iterations: row.kdf_iterations,
    kdf_salt: toBase64Url(row.kdf_salt),
    verifier: toBase64Url(row.verifier),
    k_wrapped_pw: toBase64Url(row.k_wrapped_pw),
    k_wrapped_backup: toBase64Url(row.k_wrapped_backup),
  };
}

/** 逐项校验 BLOB 长度与 KDF 参数；任何一处不对都拒绝写入（宁可不存，也不存坏） */
function assertMaterials(materials: CryptoMaterials): {
  salt: Uint8Array<ArrayBuffer>;
  verifier: Uint8Array<ArrayBuffer>;
  wrappedPw: Uint8Array<ArrayBuffer>;
  wrappedBackup: Uint8Array<ArrayBuffer>;
} {
  let salt: Uint8Array<ArrayBuffer>;
  let verifier: Uint8Array<ArrayBuffer>;
  let wrappedPw: Uint8Array<ArrayBuffer>;
  let wrappedBackup: Uint8Array<ArrayBuffer>;
  try {
    salt = cryptoBlobFromBase64Url(materials.kdf_salt);
    verifier = cryptoBlobFromBase64Url(materials.verifier);
    wrappedPw = cryptoBlobFromBase64Url(materials.k_wrapped_pw);
    wrappedBackup = cryptoBlobFromBase64Url(materials.k_wrapped_backup);
  } catch {
    throw new DomainError("invalid", "门禁材料的编码不合法");
  }

  if (salt.length !== CRYPTO_SALT_BYTES) {
    throw new DomainError("invalid", "KDF 盐长度不合法");
  }
  if (verifier.length !== CRYPTO_VERIFIER_BYTES) {
    throw new DomainError("invalid", "校验块长度不合法");
  }
  if (wrappedPw.length !== CRYPTO_WRAPPED_BYTES || wrappedBackup.length !== CRYPTO_WRAPPED_BYTES) {
    throw new DomainError("invalid", "内容密钥包裹长度不合法");
  }
  // 提前解一次包：版本号不对时现在就拒绝，别等到用户重置密码才发现
  for (const blob of [verifier, wrappedPw, wrappedBackup]) {
    try {
      unpackCryptoBlob(blob);
    } catch {
      throw new DomainError("invalid", "门禁材料的格式版本不受支持");
    }
  }
  return { salt, verifier, wrappedPw, wrappedBackup };
}

/** `GET /api/crypto`：未启用时 `materials` 为 null */
export async function getCryptoState(db: D1Database, userId: string): Promise<CryptoState> {
  const row = await db.prepare(SQL_SELECT_USER_CRYPTO).bind(userId).first<CryptoRow>();
  if (!row) return { enabled: false, materials: null, rev: 0, updated_at: 0 };
  return { enabled: true, materials: toMaterials(row), rev: row.rev, updated_at: row.updated_at };
}

/**
 * `PUT /api/crypto`：启用 / 改密 / 重置后的整体覆盖（后写为准，`rev + 1`）。
 *
 * `input.k` 只在**首次启用**时提供——见 `wrapContentKeyWithBackupSecret` 的说明；
 * 改密 / 重置时把 `GET` 拿到的旧备份包裹原样带回来即可。
 */
export async function putCryptoMaterials(
  env: EnvBindings,
  db: D1Database,
  userId: string,
  input: CryptoWrite,
  now: number,
): Promise<CryptoState> {
  const existing = await db.prepare(SQL_SELECT_USER_CRYPTO).bind(userId).first<CryptoRow>();

  let backupWrap = input.materials.k_wrapped_backup;
  if (input.k !== undefined) {
    const secret = env[BACKUP_CRED_KEY_SECRET];
    if (!secret) {
      throw new DomainError(
        "retry_later",
        "实例未配置 BACKUP_CRED_KEY 机密，无法启用隐私锁（请联系实例管理员）",
      );
    }
    let contentKey: Uint8Array<ArrayBuffer>;
    try {
      contentKey = cryptoBlobFromBase64Url(input.k);
    } catch {
      throw new DomainError("invalid", "内容密钥的编码不合法");
    }
    if (contentKey.length !== CRYPTO_KEY_BYTES) {
      throw new DomainError("invalid", "内容密钥长度不合法");
    }
    backupWrap = await wrapContentKeyWithBackupSecret(secret, contentKey);
  } else if (backupWrap === undefined) {
    throw new DomainError(
      "invalid",
      existing ? "缺少备份包裹" : "首次启用隐私锁必须随请求提供内容密钥",
    );
  }

  const materials: CryptoMaterials = {
    kdf: input.materials.kdf,
    kdf_iterations: input.materials.kdf_iterations,
    kdf_salt: input.materials.kdf_salt,
    verifier: input.materials.verifier,
    k_wrapped_pw: input.materials.k_wrapped_pw,
    k_wrapped_backup: backupWrap,
  };
  const { salt, verifier, wrappedPw, wrappedBackup } = assertMaterials(materials);
  await db
    .prepare(SQL_UPSERT_USER_CRYPTO)
    .bind(
      userId,
      materials.kdf,
      materials.kdf_iterations,
      salt,
      verifier,
      wrappedPw,
      wrappedBackup,
      now,
      now,
    )
    .run();
  return getCryptoState(db, userId);
}

/**
 * `DELETE /api/crypto`：关闭隐私锁。
 *
 * **有隐私内容时不允许关闭**（含回收站里的条目）——否则那些标记会变成"看不见也管不着"的悬挂状态。
 * 退出码用 422 `invalid` + `detail.reason`：现有错误码表里没有"状态冲突"这一类，
 * 新增错误码属 API 契约变更，留到需要时统一加（见《隐私锁设计》§4.2 的说明）。
 */
export async function deleteCryptoMaterials(db: D1Database, userId: string): Promise<CryptoState> {
  const counted = await db
    .prepare(SQL_COUNT_PRIVACY_ITEMS)
    .bind(userId)
    .first<{ count: number }>();
  const count = counted?.count ?? 0;
  if (count > 0) {
    throw new DomainError("invalid", "还有隐私内容，不能关闭隐私锁", {
      reason: "privacy_content_exists",
      count,
    });
  }
  await db.prepare(SQL_DELETE_USER_CRYPTO).bind(userId).run();
  return { enabled: false, materials: null, rev: 0, updated_at: 0 };
}

/** `BACKUP_CRED_KEY` 是任意字符串机密，用 SHA-256 归一成 32 字节 AES-GCM 密钥 */
async function deriveBackupCredKey(
  secret: string,
  usages: Array<"decrypt" | "encrypt"> = ["decrypt"],
): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, usages);
}

/**
 * 用备份凭据把内容密钥 K 包起来（**只在首次启用时走这条路**）。
 *
 * 为什么服务端要做这一步：`BACKUP_CRED_KEY` 是 Worker 机密，浏览器拿不到也不该拿到；
 * 而"重置隐私密码"要求服务端能解出 K。所以启用时浏览器把 K 交给服务端包一次
 * （内容本来就是明文存储，服务端知道 K 不改变保护边界，见《隐私锁设计》§1 的 P1/P3）。
 */
async function wrapContentKeyWithBackupSecret(
  secret: string,
  contentKey: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const wrapKey = await deriveBackupCredKey(secret, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(CRYPTO_IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, wrapKey, contentKey),
  );
  return cryptoBlobToBase64Url(
    packCryptoBlob({
      iv,
      ciphertext: sealed.slice(0, sealed.length - CRYPTO_TAG_BYTES),
      tag: sealed.slice(sealed.length - CRYPTO_TAG_BYTES),
    }),
  );
}

/**
 * `POST /api/crypto/reset`：忘记隐私密码时用备份凭据解出内容密钥 K。
 *
 * 缺机密时**只让这一条路失败**（503 + 明确文案），不拦其它端点——否则一个没配的机密
 * 会让整个隐私锁功能全灭，用户还看不到原因。
 */
export async function resetContentKey(
  env: EnvBindings,
  db: D1Database,
  userId: string,
): Promise<CryptoResetResponse> {
  const secret = env[BACKUP_CRED_KEY_SECRET];
  if (!secret) {
    throw new DomainError(
      "retry_later",
      "实例未配置 BACKUP_CRED_KEY 机密，重置隐私密码暂不可用（其它功能不受影响）",
    );
  }

  const row = await db.prepare(SQL_SELECT_USER_CRYPTO).bind(userId).first<CryptoRow>();
  if (!row) throw new DomainError("not_found", "尚未启用隐私锁");

  const wrapKey = await deriveBackupCredKey(secret);
  const blob = unpackCryptoBlob(new Uint8Array(row.k_wrapped_backup));
  const payload = new Uint8Array(blob.ciphertext.length + blob.tag.length);
  payload.set(blob.ciphertext, 0);
  payload.set(blob.tag, blob.ciphertext.length);

  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: blob.iv, tagLength: 128 },
      wrapKey,
      payload,
    );
  } catch {
    // 只有"机密换过"会走到这里；不要把细节回给客户端（可能被用来探测机密）
    throw new DomainError("invalid", "无法解开内容密钥：实例的 BACKUP_CRED_KEY 可能已更换");
  }

  return { k: cryptoBlobToBase64Url(new Uint8Array(plain)) };
}

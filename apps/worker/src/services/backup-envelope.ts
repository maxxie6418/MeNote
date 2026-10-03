/**
 * 出站信封的加解密（M7 第 4 项 批 2；架构 §7.3 / §7.4；设计 §五）。
 *
 * **服务端造得出来这个信封吗？** 定稿 §7.3 的 K 包裹块是 `AES-GCM(KEK, K)`，
 * 而 KEK 由**隐私密码**经 PBKDF2 派生——服务端没有密码、也就没有 KEK。
 * 解法是：那个块**从库里那份 `k_wrapped_pw` 逐字节取**（它本来就是同一种东西），
 * 随信封原样带走。**逐字节取，不是重算**：重算需要密码，服务端没有。
 *
 * 这么做的结果与定稿 §7.3 的意图一致、且**不弱化保护边界**：
 * - 备份因此是**自足**的——换一台机器、服务器没了，只要有隐私密码就能解开（§6.4
 *   「用隐私密码解开即可，**不需要离线解密小工具**」要的正是这个）；
 * - 光有备份、没有密码，解不开（K 包裹块就是密码的强度）；
 * - 逐文件的随机量是**内容 IV**（偏移 87），那个由服务端每次现生成。
 *
 * ## 与「出站包不含 `user_crypto` 任何字段」的关系
 *
 * 那条底线（M5 §六）防的是「备份里出现**明文**密钥，于是备份本身就是一份可直接解密
 * 的资产」。信封里的 K 包裹块是**密码包裹**的密文，与 `k_wrapped_pw` 同一个东西，
 * 保护强度等于隐私密码本身——**不带密码的备份仍然解不开**。底线未被突破。
 */
import {
  ENVELOPE_VERSION,
  cryptoBlobToBase64Url,
  packBackupEnvelope,
  unpackCryptoBlob,
  type EnvelopeParts,
} from "@menote/shared";
import { DomainError } from "../errors";
import { SQL_SELECT_USER_CRYPTO } from "../db/tables";
import { openWithBackupKey, requirePepper } from "./crypto";
import type { EnvBindings } from "../types";

interface UserCryptoRow {
  kdf_iterations: number;
  kdf_salt: ArrayBuffer;
  k_wrapped_pw: ArrayBuffer;
  k_wrapped_backup: ArrayBuffer;
}

/** 一份用户已解包、**可立即用于出站加密**的密钥材料 */
export interface OutgoingKeyMaterial {
  /** 内容密钥 K（32 字节）。**用完即弃**，不进日志、不进错误消息 */
  contentKey: Uint8Array<ArrayBuffer>;
  kdfIterations: number;
  kdfSalt: Uint8Array<ArrayBuffer>;
  /** K 包裹块的三段（`k_wrapped_pw` 拆出来的那份） */
  kWrapIv: Uint8Array<ArrayBuffer>;
  kWrapCiphertext: Uint8Array<ArrayBuffer>;
  kWrapTag: Uint8Array<ArrayBuffer>;
}

/**
 * 取并解开出站要用的密钥材料。
 *
 * 步骤与架构 §7.4 一致：K 用**备份包裹键**（`AUTH_PEPPER` 域分离派生）从
 * `k_wrapped_backup` 解出来。**没有 `user_crypto` 行 = 隐私锁没启用**，
 * 那时不该有任何隐私条目可加密，调用方据 `null` 走"全明文"路径。
 */
export async function loadOutgoingKeyMaterial(
  env: EnvBindings,
  db: D1Database,
  userId: string,
): Promise<OutgoingKeyMaterial | null> {
  const row = await db.prepare(SQL_SELECT_USER_CRYPTO).bind(userId).first<UserCryptoRow>();
  if (!row) return null;

  // 缺根机密时不拿空串凑：空密钥算出来的东西"看起来能用"，实则谁都能复算
  requirePepper(env);

  const contentKey = await openWithBackupKey(
    env,
    cryptoBlobToBase64Url(new Uint8Array(row.k_wrapped_backup)),
  );

  const blob = unpackCryptoBlob(new Uint8Array(row.k_wrapped_pw));
  if (blob.ciphertext.length !== 32) {
    throw new DomainError("invalid", "门禁材料不合法：K 包裹块长度异常");
  }
  return {
    contentKey,
    kdfIterations: row.kdf_iterations,
    kdfSalt: new Uint8Array(row.kdf_salt),
    kWrapIv: blob.iv,
    kWrapCiphertext: blob.ciphertext,
    kWrapTag: blob.tag,
  };
}

/**
 * 把一段正文封进出站信封（架构 §7.3）。
 *
 * `contentIv` 由调用方给——它必须**每次现生成**，是逐文件的随机量。
 */
export async function sealOutgoingBody(
  material: OutgoingKeyMaterial,
  plain: Uint8Array,
  contentIv: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  if (plain.length === 0) {
    // 空正文没有可加密的内容。造一个空信封会让"这条是空的"和"这条丢了"看起来一样
    throw new Error("正文为空，不套信封（空内容按明文空文件出站）");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    material.contentKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: contentIv, tagLength: 128 }, key, plain),
  );
  const parts: EnvelopeParts = {
    version: ENVELOPE_VERSION,
    kdfIterations: material.kdfIterations,
    kdfSalt: material.kdfSalt,
    kWrapIv: material.kWrapIv,
    kWrapCiphertext: material.kWrapCiphertext,
    kWrapTag: material.kWrapTag,
    contentIv: contentIv as Uint8Array<ArrayBuffer>,
    contentCiphertext: sealed.slice(0, sealed.length - 16) as Uint8Array<ArrayBuffer>,
    contentTag: sealed.slice(sealed.length - 16) as Uint8Array<ArrayBuffer>,
  };
  return packBackupEnvelope(parts);
}

/** 是不是隐私条目（单篇加密或加密空间内）——出站要不要套信封就看这一个判定 */
export function needsOutgoingEnvelope(encSelf: number, inEncSpace: number): boolean {
  return encSelf === 1 || inEncSpace === 1;
}

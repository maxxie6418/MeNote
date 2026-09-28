/**
 * 门禁材料契约的用例：BLOB 打包/解包的往返与边界、长度常量、schema 形状。
 */
import { describe, expect, it } from "vitest";
import {
  BACKUP_WRAP_CONTEXT,
  backupWrapKeyInput,
  CRYPTO_BLOB_HEADER_BYTES,
  CRYPTO_BLOB_VERSION,
  CRYPTO_IV_BYTES,
  CRYPTO_KEY_BYTES,
  CRYPTO_SALT_BYTES,
  CRYPTO_TAG_BYTES,
  CRYPTO_VERIFIER_BYTES,
  CRYPTO_VERIFIER_PLAINTEXT,
  CRYPTO_WRAPPED_BYTES,
  CryptoMaterialsSchema,
  CryptoStateSchema,
  cryptoBlobFromBase64Url,
  cryptoBlobToBase64Url,
  derivedKeyInput,
  packCryptoBlob,
  unpackCryptoBlob,
} from "../src/crypto";
import * as v from "valibot";

function bytes(length: number, seed = 7): Uint8Array {
  return new Uint8Array(Array.from({ length }, (_, i) => (i * seed + 3) % 256));
}

const MATERIALS = {
  kdf: "PBKDF2-SHA-256" as const,
  kdf_iterations: 600_000,
  kdf_salt: cryptoBlobToBase64Url(bytes(CRYPTO_SALT_BYTES)),
  verifier: cryptoBlobToBase64Url(bytes(CRYPTO_VERIFIER_BYTES)),
  k_wrapped_pw: cryptoBlobToBase64Url(bytes(CRYPTO_WRAPPED_BYTES)),
  k_wrapped_backup: cryptoBlobToBase64Url(bytes(CRYPTO_WRAPPED_BYTES, 11)),
};

describe("长度常量", () => {
  it("包裹块 = 1 + 12 + 32 + 16 = 61 字节", () => {
    expect(CRYPTO_WRAPPED_BYTES).toBe(61);
    expect(CRYPTO_BLOB_HEADER_BYTES).toBe(13);
    expect(CRYPTO_KEY_BYTES).toBe(32);
  });

  it("verifier = 1 + 12 + 常量长度 + 16", () => {
    expect(CRYPTO_VERIFIER_BYTES).toBe(
      1 + CRYPTO_IV_BYTES + CRYPTO_VERIFIER_PLAINTEXT.length + CRYPTO_TAG_BYTES,
    );
    expect(CRYPTO_VERIFIER_BYTES).toBe(47);
  });
});

describe("BLOB 打包与解包", () => {
  it("往返一致（IV / 密文 / 标签各归各位）", () => {
    const iv = bytes(CRYPTO_IV_BYTES, 1);
    const ciphertext = bytes(CRYPTO_KEY_BYTES, 2);
    const tag = bytes(CRYPTO_TAG_BYTES, 3);

    const packed = packCryptoBlob({ iv, ciphertext, tag });
    expect(packed.length).toBe(CRYPTO_WRAPPED_BYTES);
    expect(packed[0]).toBe(CRYPTO_BLOB_VERSION);

    const unpacked = unpackCryptoBlob(packed);
    expect([...unpacked.iv]).toEqual([...iv]);
    expect([...unpacked.ciphertext]).toEqual([...ciphertext]);
    expect([...unpacked.tag]).toEqual([...tag]);
  });

  it("IV 或标签长度不对时拒绝打包", () => {
    expect(() => packCryptoBlob({ iv: bytes(8), ciphertext: bytes(4), tag: bytes(16) })).toThrow();
    expect(() => packCryptoBlob({ iv: bytes(12), ciphertext: bytes(4), tag: bytes(8) })).toThrow();
  });

  it("长度不足或版本不支持时拒绝解包", () => {
    expect(() => unpackCryptoBlob(bytes(10))).toThrow();
    const wrongVersion = packCryptoBlob({
      iv: bytes(CRYPTO_IV_BYTES),
      ciphertext: bytes(4),
      tag: bytes(CRYPTO_TAG_BYTES),
    });
    wrongVersion[0] = 9;
    expect(() => unpackCryptoBlob(wrongVersion)).toThrow(/版本/);
  });

  it("base64url 与字节互转无损（含非法字符报错）", () => {
    const packed = packCryptoBlob({
      iv: bytes(CRYPTO_IV_BYTES),
      ciphertext: bytes(CRYPTO_KEY_BYTES),
      tag: bytes(CRYPTO_TAG_BYTES),
    });
    const text = cryptoBlobToBase64Url(packed);
    expect(text).not.toMatch(/[+/=]/);
    expect([...cryptoBlobFromBase64Url(text)]).toEqual([...packed]);
    expect(() => cryptoBlobFromBase64Url("not valid!")).toThrow();
  });
});

describe("schema", () => {
  it("合法材料通过；kdf 只接受 PBKDF2-SHA-256", () => {
    expect(v.safeParse(CryptoMaterialsSchema, MATERIALS).success).toBe(true);
    expect(
      v.safeParse(CryptoMaterialsSchema, { ...MATERIALS, kdf: "Argon2id" }).success,
    ).toBe(false);
    expect(
      v.safeParse(CryptoMaterialsSchema, { ...MATERIALS, kdf_iterations: 1000 }).success,
    ).toBe(false);
  });

  it("状态：未启用时 materials 为 null", () => {
    const state = { enabled: false, materials: null, rev: 0, updated_at: 0 };
    expect(v.safeParse(CryptoStateSchema, state).success).toBe(true);
    expect(
      v.safeParse(CryptoStateSchema, { ...state, enabled: true, materials: MATERIALS }).success,
    ).toBe(true);
  });
});

describe("根机密的域分离派生（2026-09-28 起实例只配一个机密）", () => {
  const decoder = new TextDecoder();

  it("备份包裹键的派生输入 = 根机密 ＋ 用途后缀；同输入稳定", () => {
    expect(decoder.decode(backupWrapKeyInput("pepper-abc"))).toBe(`pepper-abc${BACKUP_WRAP_CONTEXT}`);
    // 同样的输入必须字节一致（否则每次重启都换钥匙，已存的包裹全解不开）
    expect(Array.from(backupWrapKeyInput("pepper-abc"))).toEqual(
      Array.from(backupWrapKeyInput("pepper-abc")),
    );
  });

  it("同一根机密 + 不同用途 → 不同派生输入（域分离，不是复用同一把钥匙）", () => {
    const forBackup = derivedKeyInput("pepper-abc", BACKUP_WRAP_CONTEXT);
    const forSomethingElse = derivedKeyInput("pepper-abc", "menote-share-token-v1");
    expect(decoder.decode(forBackup)).not.toBe(decoder.decode(forSomethingElse));
    // 也**不等于**"直接拿根机密当钥匙"——后缀必须真的参与派生
    expect(decoder.decode(forBackup)).not.toBe("pepper-abc");
  });

  it("不同根机密 → 不同派生输入", () => {
    expect(decoder.decode(backupWrapKeyInput("pepper-a"))).not.toBe(
      decoder.decode(backupWrapKeyInput("pepper-b")),
    );
  });
});

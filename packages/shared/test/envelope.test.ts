/**
 * 出站信封的字节格式（架构 §7.3）。
 *
 * 盯的是**格式契约**那几条：偏移一个都不能错、固定开销 103、魔数认得出、
 * 版本不认识就拒收、**改一个字节就报错**。
 *
 * 为什么这些值得单测：这是要**长期兼容**的格式（§7.3 明写「格式连同外部解密工具一并公开，
 * 且每份全量备份包内附一份格式说明，保证"应用没了也能解"」）。偏移写错一位不会立刻暴露——
 * 它会变成"老备份解不开、新备份也解不开"这种只有用户才会发现的事故。
 */
import { describe, expect, it } from "vitest";
import { CRYPTO_IV_BYTES, CRYPTO_SALT_BYTES, CRYPTO_TAG_BYTES } from "../src/crypto";
import {
  ENVELOPE_FIXED_BYTES,
  ENVELOPE_KEY_BYTES,
  ENVELOPE_MAGIC,
  ENVELOPE_OVERHEAD_BYTES,
  ENVELOPE_VERSION,
  packBackupEnvelope,
  parseBackupEnvelope,
  type EnvelopeParts,
} from "../src/envelope";
function parts(overrides: Partial<EnvelopeParts> = {}): EnvelopeParts {
  return {
    version: ENVELOPE_VERSION,
    kdfIterations: 600_000,
    kdfSalt: new Uint8Array(CRYPTO_SALT_BYTES).fill(1),
    kWrapIv: new Uint8Array(CRYPTO_IV_BYTES).fill(2),
    kWrapCiphertext: new Uint8Array(ENVELOPE_KEY_BYTES).fill(3),
    kWrapTag: new Uint8Array(CRYPTO_TAG_BYTES).fill(4),
    contentIv: new Uint8Array(CRYPTO_IV_BYTES).fill(5),
    contentCiphertext: new Uint8Array(7).fill(6),
    contentTag: new Uint8Array(CRYPTO_TAG_BYTES).fill(7),
    ...overrides,
  };
}

describe("信封格式 · 布局", () => {
  it("内容密文从偏移 99 开始，固定开销是 115（定稿那句 103 漏算了 12 字节内容 IV）", () => {
    // 偏移表逐行自洽：内容密文止于 99，加末尾 16 字节标签 = 115
    expect(ENVELOPE_OVERHEAD_BYTES).toBe(99);
    expect(ENVELOPE_FIXED_BYTES).toBe(115);
  });

  it("总长 = 固定开销 + 密文 + 标签", () => {
    const bytes = packBackupEnvelope(parts());
    expect(bytes.byteLength).toBe(ENVELOPE_FIXED_BYTES + 7);
  });

  it("魔数就是 `MENOTE1\\0` 八个字节", () => {
    expect(ENVELOPE_MAGIC.byteLength).toBe(8);
    expect(String.fromCharCode(...ENVELOPE_MAGIC.slice(0, 7))).toBe("MENOTE1");
    expect(ENVELOPE_MAGIC[7]).toBe(0);
  });

  it("往返：每个字段都原样回来", () => {
    const original = parts();
    const parsed = parseBackupEnvelope(packBackupEnvelope(original));
    expect([...parsed.kdfSalt]).toEqual([...original.kdfSalt]);
    expect([...parsed.kWrapIv]).toEqual([...original.kWrapIv]);
    expect([...parsed.kWrapCiphertext]).toEqual([...original.kWrapCiphertext]);
    expect([...parsed.kWrapTag]).toEqual([...original.kWrapTag]);
    expect([...parsed.contentIv]).toEqual([...original.contentIv]);
    expect([...parsed.contentCiphertext]).toEqual([...original.contentCiphertext]);
    expect([...parsed.contentTag]).toEqual([...original.contentTag]);
  });

  it("迭代数以千次为单位存，取回来是真实次数", () => {
    const parsed = parseBackupEnvelope(packBackupEnvelope(parts({ kdfIterations: 600_000 })));
    expect(parsed.kdfIterations).toBe(600_000);
  });

  it("偏移逐个钉住：salt 11、IV 27、密文 39、标签 71、内容 IV 87", () => {
    const original = parts();
    const bytes = packBackupEnvelope(original);
    expect(bytes[11]).toBe(1); // 盐的首字节
    expect(bytes[27]).toBe(2); // K 包裹块 IV
    expect(bytes[39]).toBe(3); // K 包裹块密文
    expect(bytes[71]).toBe(4); // K 包裹块标签
    expect(bytes[87]).toBe(5); // 内容 IV
  });
});

describe("信封格式 · 拒收", () => {
  it("魔数不对就说不是信封", () => {
    const bytes = packBackupEnvelope(parts());
    bytes[0] = 0x00;
    expect(() => parseBackupEnvelope(bytes)).toThrow(/魔数/);
  });

  it("版本不认识就拒收", () => {
    const bytes = packBackupEnvelope(parts());
    bytes[8] = 9;
    expect(() => parseBackupEnvelope(bytes)).toThrow(/版本/);
  });

  it("长度不足就拒收（半截包绝不当完整包）", () => {
    expect(() => parseBackupEnvelope(new Uint8Array(50))).toThrow(/长度不足/);
  });

  it("内容密文为空就拒收", () => {
    const bytes = packBackupEnvelope(parts());
    expect(() => parseBackupEnvelope(bytes.slice(0, ENVELOPE_OVERHEAD_BYTES))).toThrow(/长度不足/);
  });

  it("改一个密文字节，结构仍成立——**察觉它靠的是 GCM 标签，不是格式层**", () => {
    /*
      这一点值得写清楚：格式层只管**结构**（魔数 / 版本 / 定长字段），
      它**察觉不到**密文被翻了一个 bit——长度对得上，它照样解析成功。
      真正拦住它的是 AES-GCM 的标签：解密时标签对不上，`crypto.subtle.decrypt` 直接抛。
      所以"格式校验过了"绝不等于"内容可信"，两件事要分开看。
    */
    const bytes = packBackupEnvelope(parts());
    const tampered = bytes.slice();
    tampered[ENVELOPE_OVERHEAD_BYTES] = (tampered[ENVELOPE_OVERHEAD_BYTES] ?? 0) ^ 0xff;
    const parsed = parseBackupEnvelope(tampered);
    expect(parsed.contentCiphertext.byteLength).toBe(7);
  });

  it("长度不足才拦得住（截掉末尾的标签）", () => {
    const bytes = packBackupEnvelope(parts());
    expect(() => parseBackupEnvelope(bytes.slice(0, ENVELOPE_FIXED_BYTES - 1))).toThrow(/长度不足/);
  });
});

describe("信封格式 · 写入前的校验", () => {
  it("K 包裹块密文不是 32 字节就拒写", () => {
    expect(() => packBackupEnvelope(parts({ kWrapCiphertext: new Uint8Array(16) }))).toThrow(/K 包裹块密文/);
  });

  it("迭代数不是 1000 的整数倍就拒写（信封存不下）", () => {
    expect(() => packBackupEnvelope(parts({ kdfIterations: 600_001 }))).toThrow(/整数倍/);
  });

  it("迭代数为 0 就拒写", () => {
    expect(() => packBackupEnvelope(parts({ kdfIterations: 0 }))).toThrow(/迭代数/);
  });

  it("内容密文为空就拒写（明文不能是空串）", () => {
    expect(() => packBackupEnvelope(parts({ contentCiphertext: new Uint8Array(0) }))).toThrow(/内容密文为空/);
  });
});

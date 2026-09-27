/**
 * 隐私门禁判定契约的用例（设计 §3.2 的规则表逐行）。
 *
 * 这个文件是"门禁只有一处"的守门人：任何视图（列表、搜索、Memo、回收站）都能被
 * 这里的断言追溯。规则若有争议，先改这里再改实现。
 */
import { describe, expect, it } from "vitest";
import {
  canReadBody,
  canShowInList,
  isInPrivacyScope,
  isMemoVisible,
  isSearchVisible,
  isSpaceUnlocked,
  privacyGateFrom,
  searchFields,
  type PrivacyGate,
  type PrivacyItemFlags,
} from "../src/privacy";

const NOTE: PrivacyItemFlags = {
  id: "n1",
  type: "note",
  enc_self: 0,
  in_enc_space: 0,
  deleted_at: null,
};
const SPACE_NOTE: PrivacyItemFlags = { ...NOTE, id: "s1", in_enc_space: 1 };
const SINGLE: PrivacyItemFlags = { ...NOTE, id: "e1", enc_self: 1 };
/** 空间内 + 单篇标记：两层门禁叠加 */
const BOTH: PrivacyItemFlags = { ...NOTE, id: "b1", in_enc_space: 1, enc_self: 1 };
const MEMO: PrivacyItemFlags = { ...NOTE, id: "m1", type: "memo" };
const TRASHED: PrivacyItemFlags = { ...NOTE, id: "t1", deleted_at: 1_700_000_000_000 };

const CONFIG = { scope: { memo: true }, search_bodies_when_unlocked: true };

function gate(
  lockState: PrivacyGate["lockState"],
  unlocked: string[] = [],
  overrides: Partial<PrivacyGate> = {},
): PrivacyGate {
  return {
    ...privacyGateFrom(CONFIG, lockState, new Set(unlocked)),
    ...overrides,
  };
}

const DISABLED = gate("disabled");
const LOCKED = gate("locked");
const UNLOCKED = gate("unlocked");
const UNLOCKED_DECRYPTED = gate("unlocked", ["e1"]);
const LOCKED_DECRYPTED = gate("locked", ["e1"]);
const LOCKED_SWITCH_OFF = gate("locked", [], { searchBodiesWhenUnlocked: false });
const UNLOCKED_SWITCH_OFF = gate("unlocked", ["e1"], { searchBodiesWhenUnlocked: false });
const MEMO_OUT_OF_SCOPE = gate("locked", [], { scope: { memo: false } });

describe("范围成员与空间解锁", () => {
  it("加密空间恒在范围内；Memo 看配置", () => {
    expect(isInPrivacyScope("space", { memo: false })).toBe(true);
    expect(isInPrivacyScope("memo", { memo: true })).toBe(true);
    expect(isInPrivacyScope("memo", { memo: false })).toBe(false);
  });

  it("未启用与已解锁都算门禁打开；只有 locked 关着", () => {
    expect(isSpaceUnlocked(DISABLED)).toBe(true);
    expect(isSpaceUnlocked(UNLOCKED)).toBe(true);
    expect(isSpaceUnlocked(LOCKED)).toBe(false);
  });

  it("Memo 视图：范围内且锁定时不可见；未启用或不在范围内可见", () => {
    expect(isMemoVisible(LOCKED)).toBe(false);
    expect(isMemoVisible(UNLOCKED)).toBe(true);
    expect(isMemoVisible(DISABLED)).toBe(true);
    expect(isMemoVisible(MEMO_OUT_OF_SCOPE)).toBe(true);
  });
});

describe("问题 1：列表可见性", () => {
  it("普通内容：任何状态都列出（未启用时也一样）", () => {
    for (const g of [DISABLED, LOCKED, UNLOCKED]) {
      expect(canShowInList(NOTE, g)).toBe(true);
    }
  });

  it("空间内条目：锁定时不出现，解锁期间出现（未启用时也无门禁）", () => {
    expect(canShowInList(SPACE_NOTE, LOCKED)).toBe(false);
    expect(canShowInList(SPACE_NOTE, UNLOCKED)).toBe(true);
    expect(canShowInList(SPACE_NOTE, DISABLED)).toBe(true);
  });

  it("单篇加密条目：留在原位，任何状态都列出（标题明文）", () => {
    for (const g of [LOCKED, UNLOCKED, LOCKED_DECRYPTED]) {
      expect(canShowInList(SINGLE, g)).toBe(true);
    }
  });

  it("Memo：范围内且锁定时不列出；移出范围后照常列出", () => {
    expect(canShowInList(MEMO, LOCKED)).toBe(false);
    expect(canShowInList(MEMO, UNLOCKED)).toBe(true);
    expect(canShowInList(MEMO, MEMO_OUT_OF_SCOPE)).toBe(true);
  });

  it("回收站里的条目不进普通列表", () => {
    for (const g of [DISABLED, LOCKED, UNLOCKED]) {
      expect(canShowInList(TRASHED, g)).toBe(false);
    }
  });
});

describe("问题 2：正文可读性", () => {
  it("空间内条目：只有解锁后可读", () => {
    expect(canReadBody(SPACE_NOTE, LOCKED)).toBe(false);
    expect(canReadBody(SPACE_NOTE, UNLOCKED)).toBe(true);
    expect(canReadBody(SPACE_NOTE, DISABLED)).toBe(true);
  });

  it("单篇加密：不受隐私锁解锁影响，只看该篇是否已解密", () => {
    expect(canReadBody(SINGLE, UNLOCKED)).toBe(false);
    expect(canReadBody(SINGLE, LOCKED)).toBe(false);
    expect(canReadBody(SINGLE, LOCKED_DECRYPTED)).toBe(true);
    expect(canReadBody(SINGLE, UNLOCKED_DECRYPTED)).toBe(true);
  });

  it("两层叠加（空间内 + 单篇）：两个条件都要满足", () => {
    const unlockedAndDecrypted = gate("unlocked", ["b1"]);
    const lockedButDecrypted = gate("locked", ["b1"]);
    expect(canReadBody(BOTH, UNLOCKED)).toBe(false); // 空间开了但没解密
    expect(canReadBody(BOTH, lockedButDecrypted)).toBe(false); // 解密了但空间锁着
    expect(canReadBody(BOTH, unlockedAndDecrypted)).toBe(true);
  });

  it("Memo 与待办：范围内锁定时不可读", () => {
    expect(canReadBody(MEMO, LOCKED)).toBe(false);
    expect(canReadBody(MEMO, UNLOCKED)).toBe(true);
  });
});

describe("问题 3：搜索字段（标题 / 正文）", () => {
  it("普通内容：两个字段都命中，且不受'解锁时可搜索'开关影响", () => {
    expect(searchFields(NOTE, LOCKED_SWITCH_OFF)).toEqual({ title: true, body: true });
  });

  it("空间内条目：标题要解锁；正文要解锁且开关开", () => {
    expect(searchFields(SPACE_NOTE, LOCKED)).toEqual({ title: false, body: false });
    expect(searchFields(SPACE_NOTE, UNLOCKED)).toEqual({ title: true, body: true });
    expect(searchFields(SPACE_NOTE, UNLOCKED_SWITCH_OFF)).toEqual({ title: true, body: false });
  });

  it("单篇加密：标题任何状态可搜；正文要已解密且开关开", () => {
    expect(searchFields(SINGLE, LOCKED)).toEqual({ title: true, body: false });
    expect(searchFields(SINGLE, LOCKED_DECRYPTED)).toEqual({ title: true, body: true });
    expect(searchFields(SINGLE, UNLOCKED_DECRYPTED)).toEqual({ title: true, body: true });
    expect(searchFields(SINGLE, LOCKED_SWITCH_OFF)).toEqual({ title: true, body: false });
  });

  it("单篇已解密但开关关闭：正文搜不到", () => {
    const decryptedSwitchOff = gate("unlocked", ["e1"], { searchBodiesWhenUnlocked: false });
    expect(searchFields(SINGLE, decryptedSwitchOff)).toEqual({ title: true, body: false });
  });

  it("未启用隐私锁：一律可搜（无门禁）", () => {
    expect(searchFields(SINGLE, DISABLED)).toEqual({ title: true, body: true });
  });

  it("Memo：范围内锁定时连标题（标签）都不命中", () => {
    expect(searchFields(MEMO, LOCKED)).toEqual({ title: false, body: false });
    expect(searchFields(MEMO, UNLOCKED)).toEqual({ title: true, body: true });
    expect(searchFields(MEMO, MEMO_OUT_OF_SCOPE)).toEqual({ title: true, body: true });
  });

  it("回收站里的条目两个字段都不命中", () => {
    expect(searchFields(TRASHED, UNLOCKED)).toEqual({ title: false, body: false });
    expect(isSearchVisible(TRASHED, UNLOCKED)).toBe(false);
  });

  it("便利函数：标题命中也算可搜（未解密的单篇）", () => {
    expect(isSearchVisible(SINGLE, LOCKED)).toBe(true);
    expect(isSearchVisible(SPACE_NOTE, LOCKED)).toBe(false);
  });
});

describe("组装 gate", () => {
  it("缺省 unlockedItems 为空集，且不共享可变状态", () => {
    const a = privacyGateFrom(CONFIG, "unlocked");
    const b = privacyGateFrom(CONFIG, "unlocked");
    expect(a.unlockedItems.size).toBe(0);
    expect(a.unlockedItems).not.toBe(b.unlockedItems);
  });

  it("把设置里的正文开关原样带进 gate", () => {
    expect(privacyGateFrom({ ...CONFIG, search_bodies_when_unlocked: false }, "unlocked"))
      .toMatchObject({ searchBodiesWhenUnlocked: false });
  });
});

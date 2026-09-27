// @vitest-environment node
/**
 * 隐私锁运行时的用例（M3）：档位语义、正交的两道门、计时与"锁全部 / 只锁范围"的差别。
 */
import { describe, expect, it } from "vitest";
import {
  changeTier,
  expiryFor,
  gateFrom,
  initialRuntime,
  isExpired,
  lockAll,
  lockAllItems,
  lockItem,
  lockScope,
  needsDeviceFlag,
  remainingMs,
  tick,
  unlock,
  unlockItem,
  type PrivacyRuntime,
} from "../src/features/privacy/model";
import { canReadBody, canShowInList, type PrivacyItemFlags } from "@menote/shared";

const NOW = 1_700_000_000_000;
const CONFIG = { scope: { memo: true }, search_bodies_when_unlocked: true };

const SPACE_NOTE: PrivacyItemFlags = {
  id: "s1",
  type: "note",
  enc_self: 0,
  in_enc_space: 1,
  deleted_at: null,
};
const SINGLE: PrivacyItemFlags = {
  id: "e1",
  type: "note",
  enc_self: 1,
  in_enc_space: 0,
  deleted_at: null,
};

function enabled(): PrivacyRuntime {
  return initialRuntime(true, "minutes");
}

describe("初始状态", () => {
  it("未启用就是 disabled，已启用一律从 locked 开始（刷新不自动解锁）", () => {
    expect(initialRuntime(false).lockState).toBe("disabled");
    expect(initialRuntime(true).lockState).toBe("locked");
    expect(initialRuntime(true).unlockedItems.size).toBe(0);
  });
});

describe("解锁与档位", () => {
  it("N 分钟档：到期时刻 = 现在 + N 分钟", () => {
    const runtime = unlock(enabled(), "minutes", NOW, 5);
    expect(runtime.lockState).toBe("unlocked");
    expect(runtime.expiresAt).toBe(NOW + 5 * 60_000);
    expect(remainingMs(runtime, NOW)).toBe(5 * 60_000);
  });

  it("本次会话与设备长期档没有到期时刻", () => {
    for (const tier of ["session", "device"] as const) {
      const runtime = unlock(enabled(), tier, NOW, 5);
      expect(runtime.expiresAt).toBeNull();
      expect(remainingMs(runtime, NOW)).toBeNull();
      expect(expiryFor(tier, NOW, 5)).toBeNull();
    }
  });

  it("未启用时解锁不改变状态（无门禁可解）", () => {
    const runtime = initialRuntime(false);
    expect(unlock(runtime, "minutes", NOW, 5)).toBe(runtime);
  });

  it("改档位：已解锁时从「现在」重新计时", () => {
    const runtime = unlock(enabled(), "minutes", NOW, 5);
    const changed = changeTier(runtime, "minutes", NOW + 60_000, 15);
    expect(changed.expiresAt).toBe(NOW + 60_000 + 15 * 60_000);
    expect(changed.tier).toBe("minutes");
  });

  it("未解锁时改档位只记偏好，不产生到期时刻", () => {
    const changed = changeTier(enabled(), "session", NOW, 5);
    expect(changed.lockState).toBe("locked");
    expect(changed.expiresAt).toBeNull();
  });
});

describe("两道门正交", () => {
  it("解锁隐私锁不会解开单篇", () => {
    const runtime = unlock(enabled(), "minutes", NOW, 5);
    expect(canShowInList(SINGLE, gateFrom(runtime, CONFIG))).toBe(true); // 标题明文，列表里一直有
    expect(canReadBody(SINGLE, gateFrom(runtime, CONFIG))).toBe(false); // 但仍要逐篇解密
  });

  it("逐篇解密后，锁定隐私锁默认也把它清掉（锁全部）", () => {
    let runtime = unlock(enabled(), "minutes", NOW, 5);
    runtime = unlockItem(runtime, "e1");
    expect(canReadBody(SINGLE, gateFrom(runtime, CONFIG))).toBe(true);

    const locked = lockAll(runtime);
    expect(locked.lockState).toBe("locked");
    expect(locked.unlockedItems.size).toBe(0);
  });

  it("只锁范围（档位到期）保留单篇已解密集合", () => {
    let runtime = unlock(enabled(), "minutes", NOW, 1);
    runtime = unlockItem(runtime, "e1");

    const ticked = tick(runtime, NOW + 60_000);
    expect(ticked.lockState).toBe("locked");
    expect(ticked.unlockedItems.has("e1")).toBe(true);
    // 空间内条目随范围门禁锁上，单篇仍可读
    expect(canShowInList(SPACE_NOTE, gateFrom(ticked, CONFIG))).toBe(false);
    expect(canReadBody(SINGLE, gateFrom(ticked, CONFIG))).toBe(true);
  });

  it("锁上某篇 / 锁上全部单篇不影响范围门禁", () => {
    let runtime = unlock(enabled(), "minutes", NOW, 5);
    runtime = unlockItem(unlockItem(runtime, "e1"), "e2");

    const one = lockItem(runtime, "e1");
    expect(one.unlockedItems.has("e1")).toBe(false);
    expect(one.unlockedItems.has("e2")).toBe(true);
    expect(one.lockState).toBe("unlocked");

    const none = lockAllItems(one);
    expect(none.unlockedItems.size).toBe(0);
    expect(none.lockState).toBe("unlocked");
  });

  it("lockItem 对没解密的条目是空操作（返回同一个对象）", () => {
    const runtime = unlock(enabled(), "minutes", NOW, 5);
    expect(lockItem(runtime, "不存在")).toBe(runtime);
  });
});

describe("计时", () => {
  it("没到期时 tick 返回同一个对象（避免无谓重渲染）", () => {
    const runtime = unlock(enabled(), "minutes", NOW, 5);
    expect(tick(runtime, NOW + 1_000)).toBe(runtime);
  });

  it("到期判定与剩余时间", () => {
    const runtime = unlock(enabled(), "minutes", NOW, 1);
    expect(isExpired(runtime, NOW + 59_999)).toBe(false);
    expect(isExpired(runtime, NOW + 60_000)).toBe(true);
    expect(remainingMs(runtime, NOW + 30_000)).toBe(30_000);
    expect(remainingMs(runtime, NOW + 90_000)).toBe(0);
  });

  it("锁定后没有剩余时间", () => {
    const runtime = lockScope(unlock(enabled(), "minutes", NOW, 5));
    expect(remainingMs(runtime, NOW)).toBeNull();
  });
});

describe("gate 组装与设备长期标记", () => {
  it("gateFrom 把范围配置与解锁态传进判定", () => {
    const runtime = unlock(enabled(), "minutes", NOW, 5);
    const gate = gateFrom(runtime, { scope: { memo: false }, search_bodies_when_unlocked: false });
    expect(gate.lockState).toBe("unlocked");
    expect(gate.scope.memo).toBe(false);
    expect(gate.searchBodiesWhenUnlocked).toBe(false);
    expect(gate.unlockedItems).toBe(runtime.unlockedItems);
  });

  it("只有「设备长期 + 已解锁」需要持久标记", () => {
    expect(needsDeviceFlag(unlock(enabled(), "device", NOW, 5))).toBe(true);
    expect(needsDeviceFlag(unlock(enabled(), "session", NOW, 5))).toBe(false);
    expect(needsDeviceFlag(enabled())).toBe(false);
  });
});

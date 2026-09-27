/**
 * 隐私锁的**组装层**（M3-4；《隐私锁设计》§5）。
 *
 * 把三样东西接到一起：纯状态机（`model.ts`）、浏览器端原语（`crypto.ts`）、
 * 服务端材料与本地缓存（`cryptoApi` / `data/db/privacy`），再补上多标签一致性与档位计时。
 *
 * 三条工程口径：
 * 1. **不保管密钥到磁盘**：解锁时派生的 KEK 只放内存 ref，锁定即清；没有任何持久化密钥材料。
 * 2. **门禁只有一处**：本 hook 产出 `gate`（来自 `model.gateFrom`），其它 feature 只接收它，
 *    不自己拼判定（`packages/shared/privacy.ts` 是唯一判定实现）。
 * 3. **广播只带状态**：跨标签只同步"解锁了 / 锁上了 / 哪一篇解密了"，从不带内容。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CRYPTO_KDF,
  CRYPTO_KDF_ITERATIONS,
  base64UrlEncode,
  cryptoBlobFromBase64Url,
  type PrivacyGate,
  type PrivacySettings,
} from "@menote/shared";
import { cryptoApi } from "../../data/api/endpoints";
import { cacheCryptoState, clearCachedCrypto, cachedMaterials } from "../../data/db/privacy";
import { createSyncChannel, type SyncChannel } from "../../data/sync/broadcast";
import { deriveKek, makeVerifier, randomContentKey, randomSalt, verifyPassword, wrapContentKey } from "./crypto";
import {
  DEVICE_UNLOCK_KEY,
  changeTier as changeTierIn,
  expiryFor,
  gateFrom,
  initialRuntime,
  lockAll as lockAllIn,
  lockAllItems as lockAllItemsIn,
  lockItem as lockItemIn,
  lockScope as lockScopeIn,
  needsDeviceFlag,
  tick,
  unlock as unlockIn,
  unlockItem as unlockItemIn,
  type PrivacyRuntime,
  type PrivacyTier,
} from "./model";

export interface PrivacyLockState {
  /** 服务端/缓存里记着"已启用隐私锁" */
  enabled: boolean;
  runtime: PrivacyRuntime;
  /** 判定用门禁：交给各视图（列表 / 搜索 / Memo / 编辑器） */
  gate: PrivacyGate;
  /** 材料缓存已就绪（离线也能解锁） */
  ready: boolean;
  /** 正在跑一次写操作（启用 / 改密 / 关闭） */
  busy: boolean;
  unlock: (password: string, tier: PrivacyTier) => Promise<boolean>;
  enable: (password: string) => Promise<void>;
  disable: () => Promise<void>;
  lockAll: () => void;
  lockScope: () => void;
  unlockItem: (itemId: string) => void;
  lockItem: (itemId: string) => void;
  lockAllItems: () => void;
  setTier: (tier: PrivacyTier) => void;
  /** 重新拉一次服务端材料（登录后、同步后、跨设备改密后） */
  refresh: () => Promise<void>;
}

export interface UsePrivacyLockOptions {
  /** 未登录时不拉材料、不装广播（材料要会话） */
  authenticated: boolean;
  /** 用户设置里的隐私锁配置 */
  config: PrivacySettings;
}

function readDeviceFlag(): boolean {
  try {
    return globalThis.localStorage?.getItem(DEVICE_UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDeviceFlag(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.setItem(DEVICE_UNLOCK_KEY, "1");
    else globalThis.localStorage?.removeItem(DEVICE_UNLOCK_KEY);
  } catch {
    // 隐私模式 / 无 localStorage：设备长期档退化成"本次会话"
  }
}

export function usePrivacyLock(options: UsePrivacyLockOptions): PrivacyLockState {
  const { authenticated, config } = options;
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runtime, setRuntime] = useState<PrivacyRuntime>(() =>
    initialRuntime(false, config.tier),
  );

  /** 本次解锁派生的 KEK：只在内存，锁定即清（改密/解包 K 时才需要） */
  const kekRef = useRef<CryptoKey | null>(null);
  const channelRef = useRef<SyncChannel | null>(null);
  /** 最新 runtime 的镜像：广播回调里要读它，但不能在 setState 更新器里做副作用 */
  const runtimeRef = useRef(runtime);

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  const publishUnlocked = useCallback((tier: PrivacyTier, expiresAt: number | null) => {
    channelRef.current?.post({ kind: "privacy-unlocked", tier, expiresAt });
  }, []);

  // —— 广播：订阅 + 新标签页握手 ——
  useEffect(() => {
    if (!authenticated) return undefined;
    const channel = createSyncChannel();
    channelRef.current = channel;

    const unsubscribe = channel.subscribe((event) => {
      switch (event.kind) {
        case "privacy-unlocked":
          // 别的标签页已解锁：跟着开（KEK 不共享——本页要读隐私内容时仍需自己解锁单篇）
          setRuntime((current) =>
            current.lockState === "disabled"
              ? current
              : {
                  ...current,
                  lockState: "unlocked",
                  tier: event.tier,
                  expiresAt: event.expiresAt,
                },
          );
          break;
        case "privacy-locked":
          setRuntime((current) =>
            current.lockState === "disabled" ? current : lockAllIn(current),
          );
          kekRef.current = null;
          break;
        case "privacy-item-unlocked":
          setRuntime((current) => unlockItemIn(current, event.itemId));
          break;
        case "privacy-item-locked":
          setRuntime((current) => lockItemIn(current, event.itemId));
          break;
        case "privacy-state-request": {
          // 有标签页在问"现在解锁着吗"：只有确实解锁着才回，避免把锁态广播成解锁
          const current = runtimeRef.current;
          if (current.lockState === "unlocked") {
            publishUnlocked(current.tier, current.expiresAt);
          }
          break;
        }
        default:
          break;
      }
    });

    // 加入时问一次：没人回就说明本次会话还没解锁（与"所有标签页关闭即锁"一致）
    channel.post({ kind: "privacy-state-request" });

    return () => {
      unsubscribe();
      channel.close();
      channelRef.current = null;
    };
  }, [authenticated, publishUnlocked]);

  // —— 材料：先读缓存（离线可用），再拉服务端（rev 变高就清解锁态）——
  const refresh = useCallback(async () => {
    if (!authenticated) return;

    const cached = await cachedMaterials();
    if (cached) {
      // 有缓存就先把门禁装上——**离线时这是唯一的保护**（服务端拉不到也要能锁住）
      setEnabled(true);
      setReady(true);
      setRuntime((current) => {
        if (current.lockState !== "disabled") return current;
        const base = initialRuntime(true, config.tier);
        return readDeviceFlag()
          ? unlockIn(base, "device", Date.now(), config.minutes)
          : base;
      });
    }

    try {
      const state = await cryptoApi.get();
      const result = await cacheCryptoState(state);
      setEnabled(state.enabled);
      setRuntime((current) => {
        if (!state.enabled) {
          kekRef.current = null;
          writeDeviceFlag(false);
          return initialRuntime(false, config.tier);
        }
        if (result.invalidatesUnlock) {
          // 密码在别处改过（或重置过）：旧解锁态一律作废，设备标记也清掉
          kekRef.current = null;
          writeDeviceFlag(false);
          return initialRuntime(true, config.tier);
        }
        if (current.lockState === "disabled") {
          // 刚知道"已启用"：若本设备此前选了长期解锁，就按设备档恢复门禁
          // （只是门禁状态，没有任何密钥落盘）
          const base = initialRuntime(true, config.tier);
          return readDeviceFlag()
            ? unlockIn(base, "device", Date.now(), config.minutes)
            : base;
        }
        return current;
      });
    } catch {
      // 离线：保持缓存状态（有缓存就能解锁）
    } finally {
      setReady(true);
    }
  }, [authenticated, config.tier, config.minutes]);

  useEffect(() => {
    // 走一个微任务再拉：避免在 effect 体内同步 setState（React 会判定为级联渲染），
    // 也让"读缓存 → 拉服务端"这条链与手动 `refresh()` 复用同一份实现。
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  // —— 设备长期档：只放一个设备级标记（不是密钥）；恢复在 refresh 的状态更新里做 ——
  useEffect(() => {
    if (!enabled) return;
    writeDeviceFlag(needsDeviceFlag(runtime));
  }, [enabled, runtime]);

  // —— 档位计时：只有 minutes 档需要；到期只锁范围门禁 ——
  useEffect(() => {
    if (runtime.lockState !== "unlocked" || runtime.expiresAt === null) return undefined;
    const timer = setInterval(() => {
      setRuntime((current) => {
        const next = tick(current, Date.now());
        if (next !== current) {
          kekRef.current = null;
          channelRef.current?.post({ kind: "privacy-locked" });
        }
        return next;
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [runtime.lockState, runtime.expiresAt]);

  // —— 动作 ——

  const unlock = useCallback(
    async (password: string, tier: PrivacyTier): Promise<boolean> => {
      const materials = await cachedMaterials();
      if (!materials) {
        throw new Error("本地没有校验材料，请联网后重试");
      }
      const kek = await deriveKek(
        password,
        cryptoBlobFromBase64Url(materials.kdf_salt),
        materials.kdf_iterations,
      );
      if (!(await verifyPassword(kek, materials.verifier))) return false;

      kekRef.current = kek;
      const now = Date.now();
      const expiresAt = expiryFor(tier, now, config.minutes);
      setRuntime((current) => unlockIn(current, tier, now, config.minutes));
      publishUnlocked(tier, expiresAt);
      return true;
    },
    [config.minutes, publishUnlocked],
  );

  const enable = useCallback(
    async (password: string): Promise<void> => {
      setBusy(true);
      try {
        const salt = randomSalt();
        const kek = await deriveKek(password, salt);
        const verifier = await makeVerifier(kek);
        const contentKey = randomContentKey();
        const wrapped = await wrapContentKey(contentKey, kek);

        const state = await cryptoApi.put({
          materials: {
            kdf: CRYPTO_KDF,
            kdf_iterations: CRYPTO_KDF_ITERATIONS,
            kdf_salt: base64UrlEncode(salt),
            verifier,
            k_wrapped_pw: wrapped,
          },
          // 第二份包裹由服务端用 BACKUP_CRED_KEY 包（浏览器拿不到该机密）
          k: base64UrlEncode(contentKey),
        });

        await cacheCryptoState(state);
        kekRef.current = kek;
        setEnabled(true);
        // 刚输过密码、也刚派生出 KEK：直接开门禁，用户接着就能给内容打标记（M08-01 的流程）
        setRuntime(() => {
          const base = initialRuntime(true, config.tier);
          return unlockIn(base, config.tier, Date.now(), config.minutes);
        });
        publishUnlocked(config.tier, expiryFor(config.tier, Date.now(), config.minutes));
      } finally {
        setBusy(false);
      }
    },
    [config.tier, config.minutes, publishUnlocked],
  );

  const disable = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await cryptoApi.remove();
      await clearCachedCrypto();
      kekRef.current = null;
      writeDeviceFlag(false);
      setEnabled(false);
      setRuntime(initialRuntime(false, config.tier));
      channelRef.current?.post({ kind: "privacy-locked" });
    } finally {
      setBusy(false);
    }
  }, [config.tier]);

  const lockAll = useCallback((): void => {
    kekRef.current = null;
    writeDeviceFlag(false);
    setRuntime((current) => lockAllIn(current));
    channelRef.current?.post({ kind: "privacy-locked" });
  }, []);

  const lockScope = useCallback((): void => {
    setRuntime((current) => lockScopeIn(current));
  }, []);

  const unlockItem = useCallback((itemId: string): void => {
    setRuntime((current) => unlockItemIn(current, itemId));
    channelRef.current?.post({ kind: "privacy-item-unlocked", itemId });
  }, []);

  const lockItem = useCallback((itemId: string): void => {
    setRuntime((current) => lockItemIn(current, itemId));
    channelRef.current?.post({ kind: "privacy-item-locked", itemId });
  }, []);

  const lockAllItems = useCallback((): void => {
    setRuntime((current) => {
      const next = lockAllItemsIn(current);
      if (next !== current) {
        channelRef.current?.post({ kind: "privacy-locked" });
      }
      return next;
    });
  }, []);

  const setTier = useCallback(
    (tier: PrivacyTier): void => {
      const now = Date.now();
      setRuntime((current) => changeTierIn(current, tier, now, config.minutes));
      if (tier === "device" && runtime.lockState === "unlocked") {
        publishUnlocked(tier, null);
      }
    },
    [config.minutes, publishUnlocked, runtime.lockState],
  );

  const gate = useMemo(() => gateFrom(runtime, config), [runtime, config]);

  return {
    enabled,
    runtime,
    gate,
    ready,
    busy,
    unlock,
    enable,
    disable,
    lockAll,
    lockScope,
    unlockItem,
    lockItem,
    lockAllItems,
    setTier,
    refresh,
  };
}

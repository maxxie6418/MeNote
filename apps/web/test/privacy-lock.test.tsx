// @vitest-environment jsdom
import "fake-indexeddb/auto";
/**
 * 隐私锁组装层（M3-4）的用例。
 *
 * 这里**不 mock 网络**：hook 拉服务端材料会失败（jsdom 里没有后端），于是正好验证
 * 最重要的那条路径——**有本地缓存时离线也能解锁**；服务端那一侧的行为在 worker 用例里测。
 */
import { renderHook, waitFor, act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CRYPTO_KDF,
  DEFAULT_PRIVACY_SETTINGS,
  base64UrlEncode,
  type CryptoState,
} from "@menote/shared";
import { usePrivacyLock } from "../src/features/privacy/usePrivacyLock";
import { useUserSettings } from "../src/features/settings/useUserSettings";
import {
  deriveKek,
  makeVerifier,
  randomContentKey,
  randomSalt,
  wrapContentKey,
} from "../src/features/privacy/crypto";
import { db } from "../src/data/db";
import { cacheCryptoState, readCachedCrypto } from "../src/data/db/privacy";

const PASSWORD = "隐私密码-测试用";
const ITERATIONS = 1_000; // 用例里不用 600k，参数从材料读，代码路径一致

async function seedCache(): Promise<CryptoState> {
  const salt = randomSalt();
  const kek = await deriveKek(PASSWORD, salt, ITERATIONS);
  const state: CryptoState = {
    enabled: true,
    materials: {
      kdf: CRYPTO_KDF,
      kdf_iterations: ITERATIONS,
      kdf_salt: base64UrlEncode(salt),
      verifier: await makeVerifier(kek),
      k_wrapped_pw: await wrapContentKey(randomContentKey(), kek),
      k_wrapped_backup: base64UrlEncode(new Uint8Array(61).fill(7)),
    },
    rev: 1,
    updated_at: 1,
  };
  await cacheCryptoState(state, 1);
  return state;
}

function mount() {
  return renderHook(() =>
    usePrivacyLock({ authenticated: true, config: DEFAULT_PRIVACY_SETTINGS }),
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  window.localStorage.clear();
});

describe("材料与初始状态", () => {
  it("没有缓存、也连不上服务端：保持未启用，但 ready 会置位", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.enabled).toBe(false);
    expect(result.current.runtime.lockState).toBe("disabled");
    // 未启用 = 无门禁：判定一律放行
    expect(result.current.gate.lockState).toBe("disabled");
  });

  it("有缓存（离线）：认得「已启用」，并保持锁定态", async () => {
    await seedCache();
    const { result } = mount();

    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(result.current.runtime.lockState).toBe("locked");
    expect(result.current.runtime.unlockedItems.size).toBe(0);
  });
});

describe("解锁（离线靠本地 verifier）", () => {
  it("密码正确则开门禁；错误则不开", async () => {
    await seedCache();
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));

    let wrong = true;
    await act(async () => {
      wrong = await result.current.unlock("不是这个密码", "minutes");
    });
    expect(wrong).toBe(false);
    expect(result.current.runtime.lockState).toBe("locked");

    let ok = false;
    await act(async () => {
      ok = await result.current.unlock(PASSWORD, "minutes");
    });
    expect(ok).toBe(true);
    expect(result.current.runtime.lockState).toBe("unlocked");
    expect(result.current.runtime.expiresAt).not.toBeNull();
  });

  it("没有本地材料时给出可操作的错误（提示联网）", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));

    await expect(
      act(async () => {
        await result.current.unlock(PASSWORD, "minutes");
      }),
    ).rejects.toThrow(/联网/);
  });

  it("锁全部会清掉单篇已解密集合；锁单篇只影响那一篇", async () => {
    await seedCache();
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    await act(async () => {
      await result.current.unlock(PASSWORD, "session");
    });

    act(() => {
      result.current.unlockItem("e1");
      result.current.unlockItem("e2");
    });
    expect(result.current.runtime.unlockedItems.size).toBe(2);

    act(() => {
      result.current.lockItem("e1");
    });
    expect([...result.current.runtime.unlockedItems]).toEqual(["e2"]);
    // 范围门禁没被动
    expect(result.current.runtime.lockState).toBe("unlocked");

    act(() => {
      result.current.lockAll();
    });
    expect(result.current.runtime.lockState).toBe("locked");
    expect(result.current.runtime.unlockedItems.size).toBe(0);
  });
});

describe("设备长期档", () => {
  it("选设备档会写设备标记；锁全部则清掉，且缓存仍在（下次仍能离线解锁）", async () => {
    await seedCache();
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => {
      await result.current.unlock(PASSWORD, "device");
    });
    await waitFor(() =>
      expect(window.localStorage.getItem("menote:privacy:device-unlocked")).toBe("1"),
    );

    act(() => {
      result.current.lockAll();
    });
    expect(window.localStorage.getItem("menote:privacy:device-unlocked")).toBeNull();
    // 材料缓存不因锁定而删（离线解锁要用）
    expect(await readCachedCrypto()).toBeDefined();
  });
});

/**
 * **组合回归**（2026-09-27 线上整站白屏）：库里的设置行缺 `privacy` 时，整棵应用会被卸载。
 *
 * 这里按真实装配走一遍：`useUserSettings` 读盘 → 把 `settings.privacy` 交给 `usePrivacyLock`。
 * 修复前这条链路会在 `usePrivacyLock` 的渲染期抛 TypeError（读 `config.tier`），
 * 于是 `#root` 被清空——只有 CSS 底色、没有任何内容。
 */
describe("旧设置行的组合回归", () => {
  it("行里缺 privacy 时，加载器补齐后隐私锁照常装配", async () => {
    await db.settings.put({
      key: "user",
      json: {
        start_view: "home",
        timezone: "Asia/Shanghai",
        editor_mode: "split",
        quick_menu: ["theme", "lock"],
      } as never,
      rev: 7,
      updated_at: 7,
      pending: null,
    });

    function Harness() {
      const settings = useUserSettings();
      const lock = usePrivacyLock({ authenticated: false, config: settings.settings.privacy });
      // 必须等 `loaded`：读盘是异步的，崩溃发生在"读到旧行之后的那次渲染"，
      // 断言早于它就会变成假通过（本轮实测踩过）。
      return <span data-testid="gate">{settings.loaded ? lock.gate.lockState : "loading"}</span>;
    }

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("gate").textContent).toBe("disabled"));
    // 走到这里说明"读到旧行 → 重新渲染"这一跳没有把整棵树带走
    expect(screen.getByTestId("gate")).toBeTruthy();
  });

  it("消费端兜底：即便拿到的配置是 undefined，hook 也按默认值装起来（不崩）", async () => {
    function Harness() {
      // 故意绕过类型：模拟"某个上游没补齐"的极端情况
      const lock = usePrivacyLock({ authenticated: false, config: undefined });
      return <span data-testid="tier">{lock.runtime.tier}</span>;
    }

    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId("tier").textContent).toBe(DEFAULT_PRIVACY_SETTINGS.tier),
    );
  });
});

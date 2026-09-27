// @vitest-environment jsdom
/**
 * 设置的乐观更新必须"失败能回滚、能报出来"（2026-09-27 修）。
 *
 * **发现经过**（"被丢弃的 Promise"审计）：`patch` 是乐观更新（先改界面再落盘），
 * 唯一调用方是 `void userSettings.patch(partial)`——**写盘一旦失败，rejection 被丢弃**，
 * 界面继续显示"已生效"的假象（本地存储配额满、IndexedDB 被禁用/隐私模式都会走到这里），
 * 刷新后才悄悄变回去。同批还发现 `patch` 里的 `setPending(true)` **设了从不复位、也没人读**
 * （`pending` 的真实来源是本地库的 `local.pending`）。
 */
import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, getLocalSettings, saveLocalSettings } from "../src/data/db";
import { useUserSettings } from "../src/features/settings/useUserSettings";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("设置的乐观更新", () => {
  it("成功：界面立即生效并真的落盘", async () => {
    const onWrite = vi.fn();
    const { result } = renderHook(() => useUserSettings({ onWrite }));

    await act(async () => {
      await result.current.patch({ start_view: "home" });
    });

    expect(result.current.settings.start_view).toBe("home");
    expect((await getLocalSettings()).settings.start_view).toBe("home");
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("**落盘失败：回滚到改动前 + 报出来**（否则界面说改了、刷新后变回去）", async () => {
    // 先落一个已知状态，再让下一次写入失败
    await saveLocalSettings({ start_view: "home" } as never, 1000);
    const onError = vi.fn();
    const onWrite = vi.fn();
    const { result } = renderHook(() => useUserSettings({ onError, onWrite }));

    // 等首次读盘（settings 变成 home）
    await waitFor(() => {
      expect(result.current.settings.start_view).toBe("home");
    });

    // 直接让底层写盘抛错：把 db.settings 的 put 换掉
    const put = db.settings.put.bind(db.settings);
    (db.settings as unknown as { put: unknown }).put = () => Promise.reject(new Error("配额满了"));

    await act(async () => {
      await result.current.patch({ start_view: "recent" });
    });

    // 回到改动前（home），而不是停在乐观值（notes）
    expect(result.current.settings.start_view).toBe("home");
    expect(onError).toHaveBeenCalledWith("配额满了");
    // 没落盘就不该通知"本地有写入"（否则同步引擎会空跑一轮）
    expect(onWrite).not.toHaveBeenCalled();

    (db.settings as unknown as { put: unknown }).put = put;
  });

  it("`pending` 如实来自本地库：patch 不再自己置位，`reload()` 后才是最新值", async () => {
    const { result } = renderHook(() => useUserSettings());
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    expect(result.current.pending).toBe(false);

    await act(async () => {
      await result.current.patch({ start_view: "home" });
    });
    // 落盘把本地那一位标成"待上传"（真实来源），而 hook 里的值是**读盘时取的快照**
    expect((await getLocalSettings()).pending).toBe(true);
    expect(result.current.pending).toBe(false);

    // 同步跑完后 reload → 快照刷新
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.pending).toBe(true);
  });
});

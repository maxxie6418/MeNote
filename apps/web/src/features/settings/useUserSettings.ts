/**
 * 用户设置的读写（M2-7）。
 *
 * 口径：**即时生效**（需求 §7.5 的保存方式建议）——改一下就落本地并排进 outbox，
 * 界面不用等服务器；离线时照常生效，联网后由 outbox 补传。
 *
 * 主题不在这里：它是**设备级**偏好（同一账号在手机与桌面可以不同），M1 起存在 `localStorage`，
 * 由 `app/theme/useTheme` 管。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "@menote/shared";
import { getLocalSettings, saveLocalSettings } from "../../data/db";

export interface UserSettingsState {
  settings: UserSettings;
  /** 本地有未上传的改动 */
  pending: boolean;
  /** 首次读盘是否完成（读之前用默认值） */
  loaded: boolean;
  /** 改一部分设置：立即生效 + 入队上传 */
  patch: (partial: Partial<UserSettings>) => Promise<void>;
  /** 同步跑完后重新读盘（服务端可能带下来新值） */
  reload: () => Promise<void>;
}

export function useUserSettings(
  options: { onWrite?: () => void; onLoaded?: (settings: UserSettings) => void } = {},
): UserSettingsState {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const onWrite = options.onWrite;
  const onLoaded = options.onLoaded;
  /**
   * 回调放进 ref：调用方通常传内联箭头（要闭包最新的 workspace 等），若直接进 effect 依赖，
   * 每次渲染都会重新读盘。用 ref 保证"只在首次读盘时通知一次"。
   */
  const onLoadedRef = useRef(onLoaded);
  // 在 effect 里同步 ref（渲染期写 ref 违反 React 规则）
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  const reload = useCallback(async () => {
    const local = await getLocalSettings();
    setSettings(local.settings);
    setPending(local.pending);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let alive = true;
    void getLocalSettings().then((local) => {
      if (!alive) return;
      setSettings(local.settings);
      setPending(local.pending);
      setLoaded(true);
      // 首次读盘后回调一次：调用方据此决定"启动视图"（设置是异步读出来的，
      // 在 effect 体内同步 setState 会触发级联渲染，所以走这个回调）
      onLoadedRef.current?.(local.settings);
    });
    return () => {
      alive = false;
    };
  }, []);

  const patch = useCallback(
    async (partial: Partial<UserSettings>) => {
      const next = { ...settings, ...partial };
      // 乐观：先更新界面，再落盘
      setSettings(next);
      setPending(true);
      await saveLocalSettings(next, Date.now());
      onWrite?.();
    },
    [onWrite, settings],
  );

  return { settings, pending, loaded, patch, reload };
}

/**
 * 认证与会话的前端状态（拆解 M01-01~05）。
 *
 * 流程要点：**先 prelogin 取盐 → 浏览器派生登录密钥 → 提交**；注册用同一个盐，
 * 因此注册后再次登录派生出的是同一个密钥（服务端的盐与 prelogin 一致，见 `services/auth.ts` 注释）。
 * 登出**不清除本机缓存**（Q22 已定·用户确认 2026-09-26），只清会话态。
 */
import type { MeResponse } from "@menote/shared";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../data/api/client";
import { authApi } from "../../data/api/endpoints";
import { deriveLoginKey } from "./kdf";

export type AuthStatus = "loading" | "anonymous" | "authenticated";

export interface AuthSnapshot {
  status: AuthStatus;
  user: MeResponse | null;
  /** 注册开关是否开放（公开状态接口，无需登录） */
  registrationOpen: boolean;
  /** 库中是否已有用户：false 时必须直接进注册页 */
  hasUsers: boolean;
}

export interface AuthController {
  snapshot: AuthSnapshot;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<MeResponse>;
  register: (username: string, password: string) => Promise<MeResponse>;
  logout: () => Promise<void>;
}

export function useAuth(): AuthController {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>({
    status: "loading",
    user: null,
    registrationOpen: false,
    hasUsers: true,
  });

  /**
   * 读一次真实状态。**不在这里 setState**：调用方决定何时应用，
   * 这样 effect 里只做"发起 + 在 then 里应用"，不会同步触发级联渲染
   * （react-hooks/set-state-in-effect）。
   */
  const buildSnapshot = useCallback(async (): Promise<AuthSnapshot> => {
    let user: MeResponse | null;
    try {
      user = await authApi.me();
    } catch {
      user = null; // 401 或网络失败都按未登录处理
    }

    let registrationOpen = false;
    let hasUsers = true;
    try {
      const state = await authApi.registrationState();
      registrationOpen = state.open;
      hasUsers = state.has_users;
    } catch {
      // 取不到就按"已有关闭、无注册入口"处理，不阻塞登录
    }

    return { status: user ? "authenticated" : "anonymous", user, registrationOpen, hasUsers };
  }, []);

  useEffect(() => {
    let alive = true;
    void buildSnapshot().then((next) => {
      if (alive) setSnapshot(next);
    });
    return () => {
      alive = false;
    };
  }, [buildSnapshot]);

  const refresh = useCallback(async () => {
    setSnapshot(await buildSnapshot());
  }, [buildSnapshot]);

  const authenticate = useCallback(
    async (mode: "login" | "register", username: string, password: string) => {
      const prelogin = await authApi.prelogin(username);
      const loginKey = await deriveLoginKey(password, prelogin.auth_salt, prelogin.auth_kdf);
      const session =
        mode === "login"
          ? await authApi.login(username, loginKey)
          : await authApi.register(username, loginKey);

      setSnapshot((prev) => ({ ...prev, status: "authenticated", user: session.user, hasUsers: true }));
      return session.user;
    },
    [],
  );

  return {
    snapshot,
    refresh,
    login: (username, password) => authenticate("login", username, password),
    register: (username, password) => authenticate("register", username, password),
    logout: async () => {
      try {
        await authApi.logout();
      } catch {
        // 会话可能已经失效：本地照常退出
      }
      setSnapshot((prev) => ({ ...prev, status: "anonymous", user: null }));
    },
  };
}

/** 把错误转成界面文案：服务端已经给了统一中文文案，网络类错误在传输层也给了中文 */
export function authErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "操作失败，请稍后重试";
}

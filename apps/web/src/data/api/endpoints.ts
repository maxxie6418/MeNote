/**
 * 后端端点封装：路径、请求头与响应类型的唯一出处。
 *
 * 传输细节（超时、CSRF、错误映射）在 `client.ts`；这里只描述"有哪些接口、带什么参数"。
 */
import {
  ITEM_BASE_REV_HEADER,
  ITEM_HASH_HEADER,
  ITEM_META_HEADER,
  SearchResponseSchema,
  SyncResponseSchema,
  UserSettingsPayloadSchema,
  encodeItemWriteMeta,
  type AuthKdfParams,
  type AuthSessionResponse,
  type ChangePasswordResponse,
  type FolderCreate,
  type SearchResponse,
  type UserSettingsPayload,
  type UserSettingsWrite,
  type FolderPatch,
  type FolderWriteResponse,
  type ItemBodyWriteResponse,
  type ItemMetaPatch,
  type ItemMetaWriteResponse,
  type ItemWriteMeta,
  type MeResponse,
  type PreloginResponse,
  type PublicRegistrationState,
  type RegistrationState,
  type SyncResponse,
} from "@menote/shared";
import * as v from "valibot";
import { apiFetch, apiRequest } from "./client";

export const authApi = {
  prelogin: (username: string) =>
    apiRequest<PreloginResponse>("/api/auth/prelogin", { method: "POST", body: { username } }),

  login: (username: string, loginKey: string) =>
    apiRequest<AuthSessionResponse>("/api/auth/login", {
      method: "POST",
      body: { username, login_key: loginKey },
    }),

  register: (username: string, loginKey: string) =>
    apiRequest<AuthSessionResponse>("/api/auth/register", {
      method: "POST",
      body: { username, login_key: loginKey },
    }),

  logout: () => apiRequest<void>("/api/auth/logout", { method: "POST" }),

  me: () => apiRequest<MeResponse>("/api/auth/me"),

  changePassword: (loginKey: string, newLoginKey: string, newKdf?: AuthKdfParams) =>
    apiRequest<ChangePasswordResponse>("/api/auth/password", {
      method: "POST",
      body: { login_key: loginKey, new_login_key: newLoginKey, new_kdf: newKdf },
    }),

  /** 公开状态：登录页据此决定是否显示注册入口 */
  registrationState: () => apiRequest<PublicRegistrationState>("/api/auth/registration-state"),
};

export const itemsApi = {
  /** 新建：正文走请求体原文，元数据走 `X-Menote-Meta`（架构 §6.1） */
  create: (id: string, meta: ItemWriteMeta, body: string) =>
    apiRequest<ItemBodyWriteResponse>(`/api/items/${encodeURIComponent(id)}`, {
      method: "PUT",
      body,
      headers: { [ITEM_META_HEADER]: encodeItemWriteMeta(meta) },
    }),

  /** 取正文：已知哈希时带 `If-None-Match`，命中 304 返回 null（本地缓存仍有效） */
  getBody: async (
    id: string,
    knownHash?: string,
  ): Promise<{ body: string; contentHash: string } | null> => {
    const headers: Record<string, string> = {};
    if (knownHash) headers["If-None-Match"] = `"${knownHash}"`;
    const response = await apiFetch(`/api/items/${encodeURIComponent(id)}/body`, { headers });
    if (response.status === 304) return null;
    return {
      body: await response.text(),
      contentHash: (response.headers.get("ETag") ?? "").replaceAll('"', ""),
    };
  },

  saveBody: (id: string, baseRev: number, contentHash: string, body: string) =>
    apiRequest<ItemBodyWriteResponse>(`/api/items/${encodeURIComponent(id)}/body`, {
      method: "PUT",
      body,
      headers: {
        [ITEM_BASE_REV_HEADER]: String(baseRev),
        [ITEM_HASH_HEADER]: contentHash,
      },
    }),

  patchMeta: (id: string, patch: ItemMetaPatch) =>
    apiRequest<ItemMetaWriteResponse>(`/api/items/${encodeURIComponent(id)}/meta`, {
      method: "PATCH",
      body: patch,
    }),
};

export const foldersApi = {
  create: (input: FolderCreate) =>
    apiRequest<FolderWriteResponse>("/api/folders", { method: "POST", body: input }),

  patch: (id: string, patch: FolderPatch) =>
    apiRequest<FolderWriteResponse>(`/api/folders/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
    }),
};

export const syncApi = {
  /** 拉取增量；响应过一遍共享 schema——喂本地库的数据不做无条件信任 */
  pull: async (cursor: number): Promise<SyncResponse> => {
    const raw = await apiRequest<unknown>(`/api/sync?cursor=${cursor}`);
    return v.parse(SyncResponseSchema, raw);
  },
};

/** 搜索的服务端兜底（M2-6）：只在本地索引还没建完时调用 */
export const searchApi = {
  query: async (params: {
    q: string;
    type?: string;
    folder?: string;
    tag?: string;
    from?: number;
    to?: number;
  }): Promise<SearchResponse> => {
    const query = new URLSearchParams({ q: params.q });
    if (params.type !== undefined && params.type !== "all") query.set("type", params.type);
    if (params.folder !== undefined) query.set("folder", params.folder);
    if (params.tag !== undefined && params.tag !== null) query.set("tag", params.tag);
    if (params.from !== undefined && params.from !== null) query.set("from", String(params.from));
    if (params.to !== undefined && params.to !== null) query.set("to", String(params.to));

    // 响应同样过一遍共享 schema（喂界面的数据不做无条件信任）
    const raw = await apiRequest<unknown>(`/api/search?${query.toString()}`);
    return v.parse(SearchResponseSchema, raw);
  },
};

/** 用户设置（M2-7）：整份覆盖、后写为准 */
export const settingsApi = {
  get: async (): Promise<UserSettingsPayload> => {
    const raw = await apiRequest<unknown>("/api/settings");
    return v.parse(UserSettingsPayloadSchema, raw);
  },

  put: async (input: UserSettingsWrite): Promise<UserSettingsPayload> => {
    const raw = await apiRequest<unknown>("/api/settings", {
      method: "PUT",
      body: input,
    });
    return v.parse(UserSettingsPayloadSchema, raw);
  },
};

export const adminApi = {  getRegistration: () => apiRequest<RegistrationState>("/api/admin/registration"),

  setRegistration: (open: boolean, closeAt?: number) =>
    apiRequest<RegistrationState>("/api/admin/registration", {
      method: "PUT",
      body: closeAt === undefined ? { open } : { open, close_at: closeAt },
    }),
};

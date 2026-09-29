/**
 * 后端端点封装：路径、请求头与响应类型的唯一出处。
 *
 * 传输细节（超时、CSRF、错误映射）在 `client.ts`；这里只描述"有哪些接口、带什么参数"。
 */
import {
  BatchResponseSchema,
  CryptoResetResponseSchema,
  CryptoStateSchema,
  ITEM_BASE_REV_HEADER,
  ITEM_DEVICE_HEADER,
  ITEM_HASH_HEADER,
  ITEM_META_HEADER,
  SearchResponseSchema,
  SyncResponseSchema,
  TrashFolderResponseSchema,
  TrashItemResponseSchema,
  UserSettingsPayloadSchema,
  encodeItemWriteMeta,
  type AuthKdfParams,
  type AuthSessionResponse,
  type BatchOp,
  type BatchResponse,
  type ChangePasswordResponse,
  type CryptoResetResponse,
  type CryptoState,
  type CryptoWrite,
  type FolderCreate,
  type SearchResponse,
  type TrashFolderResponse,
  type TrashItemResponse,
  type VersionMeta,
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

  saveBody: (id: string, baseRev: number, contentHash: string, body: string, deviceId?: string) =>
    apiRequest<ItemBodyWriteResponse>(`/api/items/${encodeURIComponent(id)}/body`, {
      method: "PUT",
      body,
      headers: {
        [ITEM_BASE_REV_HEADER]: String(baseRev),
        [ITEM_HASH_HEADER]: contentHash,
        /*
          上报设备标识（`items.last_device`）：服务端一直支持这个头，但客户端此前从没发过，
          于是那一列永远是 null、"另一台设备改过"无从判断（需求 §12.2-3）。
        */
        ...(deviceId ? { [ITEM_DEVICE_HEADER]: deviceId } : {}),
      },
    }),

  patchMeta: (id: string, patch: ItemMetaPatch) =>
    apiRequest<ItemMetaWriteResponse>(`/api/items/${encodeURIComponent(id)}/meta`, {
      method: "PATCH",
      body: patch,
    }),

  /** 批量写入（M2-9）：一串条目操作一次请求；服务端恒 200，逐条结果在 results 里 */
  batch: async (ops: BatchOp[]): Promise<BatchResponse> => {
    const raw = await apiRequest<unknown>("/api/batch", { method: "POST", body: { ops } });
    return v.parse(BatchResponseSchema, raw);
  },
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

/**
 * 回收站（M4-12；《M4 设计》§5.1/§5.2）。
 *
 * 四个动作都需要联网：软删/恢复要服务端算"原位置还在不在"、永久删除要在一个 D1 batch 里
 * 写墓碑并登记 R2 待删——这些都不是客户端能自己拍板的事，所以离线和"没配隐私锁"一样，
 * 界面把入口置灰并说明原因，而不是先本地改了再对账。
 */
export const trashApi = {
  /** 移入回收站（软删） */
  deleteItem: async (id: string): Promise<TrashItemResponse> => {
    const raw = await apiRequest<unknown>(`/api/items/${encodeURIComponent(id)}`, { method: "DELETE" });
    return v.parse(TrashItemResponseSchema, raw);
  },

  /** 恢复：回原位置；原文件夹没了会到根目录（响应里的 folder_id 是**实际**落点） */
  restoreItem: async (id: string): Promise<TrashItemResponse> => {
    const raw = await apiRequest<unknown>(`/api/items/${encodeURIComponent(id)}/restore`, {
      method: "POST",
      body: {},
    });
    return v.parse(TrashItemResponseSchema, raw);
  },

  /** 永久删除一批（**每批最多 10 条**，调用方按 `chunkIds` 切） */
  purge: (ids: readonly string[]) =>
    apiRequest<{ deleted: number; sync_seq: number }>("/api/trash/permanent", {
      method: "POST",
      body: { ids },
    }),

  /** 清空回收站（服务端自己分批） */
  empty: () => apiRequest<{ deleted: number; batches: number }>("/api/trash/empty", { method: "POST", body: {} }),

  deleteFolder: async (id: string): Promise<TrashFolderResponse> => {
    const raw = await apiRequest<unknown>(`/api/folders/${encodeURIComponent(id)}`, { method: "DELETE" });
    return v.parse(TrashFolderResponseSchema, raw);
  },

  restoreFolder: async (id: string): Promise<TrashFolderResponse> => {
    const raw = await apiRequest<unknown>(`/api/folders/${encodeURIComponent(id)}/restore`, {
      method: "POST",
      body: {},
    });
    return v.parse(TrashFolderResponseSchema, raw);
  },
};

/**
 * 附件（M4-10 的前端接线；服务端在 M4-4）。
 *
 * 上传是**两段**（设计 §3.2）：`putBlob` 把请求体直写对象存储，`finalize` 才落元数据与引用。
 * 中间隔着 `check`：命中已有文件就只跑 `finalize`（秒传，不发上传请求）。
 */
export const attachmentsApi = {
  check: (input: { sha256: string; size: number }) =>
    apiRequest<{ exists: boolean; pending: boolean }>("/api/attachments/check", {
      method: "POST",
      body: input,
    }),

  putBlob: (sha256: string, kind: "original" | "thumb", body: Blob, contentType: string) =>
    apiRequest<{ key: string; size: number }>(
      `/api/attachments/blob?sha256=${sha256}&kind=${kind}`,
      {
        method: "PUT",
        rawBody: body,
        headers: { "Content-Type": contentType },
      },
    ),

  finalize: (input: {
    sha256: string;
    size: number;
    mime: string | null;
    width: number | null;
    height: number | null;
    filename: string | null;
    thumb: { size: number; mime: string | null; width: number | null; height: number | null } | null;
    itemId: string | null;
  }) =>
    apiRequest<{ attachmentId: string; thumbId: string | null }>("/api/attachments/finalize", {
      method: "POST",
      body: input,
    }),

  refs: (itemId: string) =>
    apiRequest<{ refs: Array<{ attachmentId: string; versionId: string | null }> }>(
      `/api/attachments/refs/${encodeURIComponent(itemId)}`,
    ),
};

/**
 * 版本历史（M4-11 的前端接线；服务端在 M4-5）。
 *
 * 都需要联网：封存要写 R2、恢复要在一个 batch 里改正文与派生列、列表与正文都在服务端。
 */
export const versionsApi = {
  list: (itemId: string, options: { cursor?: number | null; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.cursor != null) params.set("cursor", String(options.cursor));
    if (options.limit != null) params.set("limit", String(options.limit));
    const query = params.toString();
    return apiRequest<{ versions: VersionMeta[]; next_cursor: number | null }>(
      `/api/items/${encodeURIComponent(itemId)}/versions${query ? `?${query}` : ""}`,
    );
  },

  body: (versionId: string) =>
    apiRequest<{ meta: VersionMeta; body: string }>(
      `/api/versions/${encodeURIComponent(versionId)}`,
    ),

  /** 手动「存为版本」（备注可空；落库即 `keep = 1`） */
  seal: (itemId: string, label: string | null) =>
    apiRequest<{ version: VersionMeta; created: boolean }>(
      `/api/items/${encodeURIComponent(itemId)}/versions`,
      { method: "POST", body: { label } },
    ),

  restore: (versionId: string) =>
    apiRequest<{ restored: VersionMeta; sealed: VersionMeta | null; item: { id: string; rev: number } }>(
      `/api/versions/${encodeURIComponent(versionId)}/restore`,
      { method: "POST", body: {} },
    ),

  setKeep: (versionId: string, keep: boolean) =>
    apiRequest<{ ok: boolean }>(`/api/versions/${encodeURIComponent(versionId)}/keep`, {
      method: "PUT",
      body: { keep },
    }),
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

/**
 * 隐私锁门禁材料（M3；《隐私锁设计》§4.2）。
 *
 * 四个端点都返回 `no-store` 的材料，响应过一遍共享 schema。
 * `put` 的 `k`：**首次启用**时必须给；改密 / 重置 / **重新包裹内容密钥**时也可以给——
 * 服务端只要收到 `k` 就用当前根机密（`AUTH_PEPPER` 派生）重包一次 `k_wrapped_backup`。
 */
export const cryptoApi = {
  get: async (): Promise<CryptoState> => {
    const raw = await apiRequest<unknown>("/api/crypto");
    return v.parse(CryptoStateSchema, raw);
  },

  put: async (input: CryptoWrite): Promise<CryptoState> => {
    const raw = await apiRequest<unknown>("/api/crypto", { method: "PUT", body: input });
    return v.parse(CryptoStateSchema, raw);
  },

  reset: async (): Promise<CryptoResetResponse> => {
    const raw = await apiRequest<unknown>("/api/crypto/reset", { method: "POST", body: {} });
    return v.parse(CryptoResetResponseSchema, raw);
  },

  remove: async (): Promise<CryptoState> => {
    const raw = await apiRequest<unknown>("/api/crypto", { method: "DELETE" });
    return v.parse(CryptoStateSchema, raw);
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

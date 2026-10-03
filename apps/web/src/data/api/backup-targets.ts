/**
 * 外部备份目标的端点封装（M7 第 4 项 批 1）。
 *
 * 单独一个文件而不是塞进 `endpoints.ts`：那份已经 489 行，`max-lines` 的 500 硬上限就在
 * 眼前，备份目标有 5 个接口 + 4 个 schema，一起放进去必炸。
 *
 * **凭据永不缓存**：本模块只把 `secret` 原样送出（创建 / 替换 / 测连接），
 * 读接口回来的 `has_secret` 只是一个布尔。不在这里做任何本地持久化。
 */
import {
  BackupRunResultSchema,
  BackupTargetListResponseSchema,
  BackupTargetSchema,
  BackupTestResultSchema,
  BackupTargetWriteResponseSchema,
  type BackupRunResult,
  type BackupTarget,
  type BackupTestResult,
  type CreateBackupTargetInput,
  type UpdateBackupTargetInput,
} from "@menote/shared";
import * as v from "valibot";
import { apiRequest } from "./client";

const BASE = "/api/backup/targets";

export const backupTargetsApi = {
  list: async (): Promise<BackupTarget[]> => {
    const raw = await apiRequest<unknown>(BASE);
    return v.parse(BackupTargetListResponseSchema, raw).targets;
  },

  create: async (input: CreateBackupTargetInput): Promise<BackupTarget> => {
    const raw = await apiRequest<unknown>(BASE, { method: "POST", body: input });
    return v.parse(BackupTargetWriteResponseSchema, raw).target;
  },

  update: async (id: string, input: UpdateBackupTargetInput): Promise<BackupTarget> => {
    const raw = await apiRequest<unknown>(`${BASE}/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: input,
    });
    return v.parse(BackupTargetWriteResponseSchema, raw).target;
  },

  /**
   * 删目标：**只清本机账本，远端文件一个都不动**（设计 §四）。
   * 界面必须把这句话说给用户听，否则会以为远端也被清了。
   */
  remove: async (id: string): Promise<void> => {
    await apiRequest<unknown>(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  /**
   * 测连接。`secret` 是**用户正在输入的那份明文**，只在这一次请求里用；
   * 缺省则让服务端用库里已存的那份（服务端不外传、不回显）。
   */
  test: async (id: string, input: { secret?: string; endpoint?: string } = {}): Promise<BackupTestResult> => {
    const raw = await apiRequest<unknown>(`${BASE}/${encodeURIComponent(id)}/test`, {
      method: "POST",
      body: input,
    });
    return v.parse(BackupTestResultSchema, raw);
  },

  /**
   * 推一次（手动触发）。
   *
   * **一轮就是一批**（架构 §14.3 的外部子请求限额），所以 `remaining` 通常不为 0 ——
   * 那是正常的，界面要把它当"还有 N 个没推"显示，而不是当失败。
   */
  run: async (id: string): Promise<BackupRunResult> => {
    const raw = await apiRequest<unknown>(`${BASE}/${encodeURIComponent(id)}/run`, { method: "POST" });
    return v.parse(BackupRunResultSchema, raw);
  },
};

/** 供界面复用：单条目标解析（服务端返回的形状统一过一遍 schema） */
export const parseBackupTarget = (raw: unknown): BackupTarget => v.parse(BackupTargetSchema, raw);

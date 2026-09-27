/**
 * `session` 封存触发（《M4 设计》§4.1 第 2 行；服务端自动判定）。
 *
 * 判定：「本次请求带的设备标识 ≠ 这条记录的 `last_device`」**或**「`now - last_edit_at` > 1 小时」，
 * 且这条**已有正文**（不给刚建的条目封空版本）。命中就在**写入新正文之前**把旧正文封成一条
 * `reason = 'session'`、`keep = 0`、无备注的版本。
 *
 * 为什么单独一份、不放进 `versions.ts`：那份管封存 / 列表 / 恢复的**语义**（且已顶到行数预算），
 * 这一份管**什么时候自动触发**——和 `version-retention.ts` 一样是另一条演进线。
 *
 * 两个口径值得记住：
 * 1. **判定必须读旧值**：`SQL_UPDATE_ITEM_BODY` 会顺手刷新 `last_edit_at` / `last_device`，
 *    所以这两列只能在写入前读（本模块由 `saveItemBody` 在预检通过后、batch 之前调用）；
 * 2. **去重交给 `sealVersion`**：它按 `content_hash` 与最近一个版本比对，重复调用不新增行，
 *    所以这里不需要自己维护"这条刚刚封过没有"的状态。
 */
import { SQL_SELECT_ITEM_VERSION_BASE } from "../db/tables";
import type { StorageEnv } from "../types";
import { sealVersion, type VersionMeta } from "./versions";

/** 距上次编辑超过这个时长，再改就算另一段会话（设计 §4.1 的「>1 小时」） */
export const SESSION_IDLE_MS = 60 * 60 * 1000;

interface SessionBaseRow {
  rev: number;
  title: string | null;
  content_hash: string;
  size_bytes: number;
  last_edit_at: number | null;
  last_device: string | null;
  body: string;
}

/**
 * 需要时封一条 `session` 版本；封了返回它的元数据，没封（不需要封 / 内容与最近版本相同）返回 null。
 *
 * `deviceLabel` 为 null（客户端没带 `X-Menote-Device`）时**不按设备判定**：头是可选上报的，
 * 缺失说明"服务端不知道这是哪台设备"，而不是"换了一台设备"——照样按 1 小时规则判定。
 * 同理，条目自己没记过 `last_device`（存量数据）时也无从比较。
 */
export async function sealSessionVersionIfNeeded(
  env: StorageEnv,
  userId: string,
  itemId: string,
  deviceLabel: string | null,
  now: number,
): Promise<VersionMeta | null> {
  const row = await env.DB.prepare(SQL_SELECT_ITEM_VERSION_BASE)
    .bind(itemId, userId)
    .first<SessionBaseRow>();
  // 没有正文行（刚建的条目）：封了也只是一条空版本，跳过
  if (!row) return null;

  const deviceChanged =
    deviceLabel !== null && row.last_device !== null && deviceLabel !== row.last_device;
  const idle = row.last_edit_at !== null && now - row.last_edit_at > SESSION_IDLE_MS;
  if (!deviceChanged && !idle) return null;

  const result = await sealVersion(
    env,
    userId,
    itemId,
    {
      reason: "session",
      keep: false,
      label: null,
      // 封的是**保存前**的正文与元数据（保存后 rev / content_hash / last_* 都会变）
      body: row.body,
      contentHash: row.content_hash,
      title: row.title,
      sizeBytes: row.size_bytes,
      rev: row.rev,
    },
    now,
  );
  return result.created ? result.version : null;
}

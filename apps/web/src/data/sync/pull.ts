/**
 * 拉取（架构 §6.1；客户端算法见设计稿《同步引擎设计》§4.5）。
 *
 * 循环推进游标直到 `has_more` 为假；`full_resync` 时清掉"已同步"的本地内容并从 0 重建
 * （未上传的改动保留）。
 */
import type { SyncResponse } from "@menote/shared";
import { syncApi } from "../api/endpoints";
import {
  applySyncFolders,
  applySyncItems,
  applySyncSettings,
  clearSyncedLocalContent,
  getSyncState,
  setSyncCursor,
} from "../db";

/** 单次同步最多拉多少页（防御性上限；正常几页内结束） */
const MAX_PAGES = 50;

export interface PullApi {
  pull(cursor: number): Promise<SyncResponse>;
}

export interface PullResult {
  /** 本次落库的条目 + 文件夹行数 */
  applied: number;
  cursor: number;
  pages: number;
  fullResync: boolean;
}

export async function pullOnce(
  api: PullApi = syncApi,
  now: () => number = Date.now,
): Promise<PullResult> {
  const state = await getSyncState();
  let cursor = state.cursor;
  let applied = 0;
  let pages = 0;
  let fullResync = false;

  while (pages < MAX_PAGES) {
    pages += 1;
    const page = await api.pull(cursor);

    if (page.full_resync) {
      // 仅清"已同步"的内容：pending 的条目与草稿是还没上传的改动，清掉就是丢数据
      await clearSyncedLocalContent();
      fullResync = true;
      cursor = 0;
      await setSyncCursor(0, now());
      continue;
    }

    await applySyncItems(page.items);
    await applySyncFolders(page.folders);
    // 用户设置（M2-7）：不参与游标，每页都带；本地有未上传改动或服务端 rev 不更新时会被跳过
    await applySyncSettings(page.settings);
    applied += page.items.length + page.folders.length;
    cursor = page.next_cursor;
    await setSyncCursor(cursor, now());

    if (!page.has_more) break;
  }

  return { applied, cursor, pages, fullResync };
}

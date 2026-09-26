/**
 * 本地搜索索引与检索（架构 §2.3.2 的 `data/db/`；M2-6、需求 §11）。
 *
 * **离线优先**：索引与检索全在本地（IndexedDB），默认不发网络请求。服务端兜底只在"索引还没建完"
 * 时由界面层调用，见 `isSearchIndexComplete()`。
 *
 * **增量**：以条目的 `sync_seq` 为版本号——同步后只重建版本变了的条目；已删除或不可见的条目
 * 连同索引行一起清掉。
 *
 * **隐私过滤位集中在一处**：`isSearchVisible()` 是**唯一**判断"这条能不能被搜到/进索引"的地方
 * （M2 阶段 = 明文且未删除；M3 接入隐私锁后只改这一个函数）。
 */
import { buildSearchText, searchRows, tokenize, type SearchHit } from "../../features/search/model";
import { db } from "./database";
import { getCachedBody, getDraft } from "./repository";
import type { LocalItem, SearchIndexRow } from "./schema";

/**
 * 隐私过滤位（M2 唯一一处）。
 *
 * M2 的所有条目都是明文（`in_enc_space = 0 && enc_self = 0`），所以这里等价于"未删除"；
 * **M3 引入隐私锁后只改这里**：加密空间的条目要在"已解锁"时才可见、跨空间内容不互相泄漏。
 */
export function isSearchVisible(item: LocalItem): boolean {
  return item.deleted_at === null && item.in_enc_space === 0 && item.enc_self === 0;
}

export interface SearchFilters {
  /** 条目类型；`all` = 不限 */
  type?: "note" | "table" | "memo" | "all";
  /** 文件夹；`all` = 不限，`null` = 根目录 */
  folderId?: string | null | "all";
  /** 标签（精确匹配，不带 `#`）；`null` = 不限 */
  tag?: string | null;
  /** 修改时间范围（毫秒，含端点）；`null` = 不限 */
  from?: number | null;
  to?: number | null;
}

export const EMPTY_SEARCH_FILTERS: SearchFilters = { type: "all", folderId: "all", tag: null };

/** 重建索引（增量）。返回本次新建/更新与删除的行数，便于测试与诊断 */
export async function refreshSearchIndex(): Promise<{ indexed: number; removed: number }> {
  const items = await db.items.toArray();
  const existing = new Map((await db.searchIndex.toArray()).map((row) => [row.item_id, row]));

  const visible = items.filter(isSearchVisible);
  const keep = new Set<string>();
  const upserts: SearchIndexRow[] = [];
  const now = Date.now();

  for (const item of visible) {
    keep.add(item.id);
    const cached = existing.get(item.id);
    // 版本没变就跳过——这是"按 sync_seq 增量"的落点
    if (cached && cached.sync_seq === item.sync_seq) continue;

    const draft = await getDraft(item.id);
    const body = draft?.body ?? (await getCachedBody(item.id))?.body ?? "";
    const text = buildSearchText({ title: item.title, tags: item.tags, body });
    upserts.push({
      item_id: item.id,
      sync_seq: item.sync_seq,
      text,
      haystack: text.toLowerCase(),
      tokens: tokenize(text).join(" "),
      updated_at: item.updated_at,
      indexed_at: now,
    });
  }

  const stale = [...existing.keys()].filter((id) => !keep.has(id));
  if (stale.length > 0) await db.searchIndex.bulkDelete(stale);
  if (upserts.length > 0) await db.searchIndex.bulkPut(upserts);

  return { indexed: upserts.length, removed: stale.length };
}

/** 索引是否已覆盖全部可见条目（没建完时界面层回退服务端并提示） */
export async function isSearchIndexComplete(): Promise<boolean> {
  const items = await db.items.toArray();
  const visible = items.filter(isSearchVisible);
  if (visible.length === 0) return true;

  const rows = new Map((await db.searchIndex.toArray()).map((row) => [row.item_id, row]));
  return visible.every((item) => rows.get(item.id)?.sync_seq === item.sync_seq);
}

/** 本地检索：先按索引命中，再按条目元数据过滤 */
export async function searchLocal(
  query: string,
  filters: SearchFilters = EMPTY_SEARCH_FILTERS,
): Promise<Array<{ item: LocalItem; snippet: SearchHit["snippet"]; score: number }>> {
  const hits = searchRows(query, await db.searchIndex.toArray());
  if (hits.length === 0) return [];

  const items = await db.items.bulkGet(hits.map((hit) => hit.itemId));
  const byId = new Map(items.filter(Boolean).map((item) => [(item as LocalItem).id, item as LocalItem]));

  const out: Array<{ item: LocalItem; snippet: SearchHit["snippet"]; score: number }> = [];
  for (const hit of hits) {
    const item = byId.get(hit.itemId);
    if (!item || !isSearchVisible(item)) continue;

    if (filters.type && filters.type !== "all" && item.type !== filters.type) continue;
    if (filters.folderId !== undefined && filters.folderId !== "all") {
      if ((item.folder_id ?? null) !== filters.folderId) continue;
    }
    if (filters.tag && !item.tags.includes(filters.tag)) continue;
    if (filters.from !== undefined && filters.from !== null && item.updated_at < filters.from) continue;
    if (filters.to !== undefined && filters.to !== null && item.updated_at > filters.to) continue;

    out.push({ item, snippet: hit.snippet, score: hit.score });
  }
  return out;
}

/** 清空索引（`full_resync` 或本地数据重置后用） */
export async function clearSearchIndex(): Promise<void> {
  await db.searchIndex.clear();
}

/**
 * 搜索的共享类型（架构 §2.3.2；M2-6）。
 *
 * 服务端只在"客户端本地索引还没建完"时被调用（见 `apps/worker/src/services/search.ts`），
 * 返回结果由客户端过一遍 valibot 再喂给界面——喂进来的数据不做无条件信任。
 */
import * as v from "valibot";

export const SearchResultItemSchema = v.object({
  id: v.string(),
  type: v.picklist(["note", "table", "memo"]),
  folder_id: v.nullable(v.string()),
  title: v.nullable(v.string()),
  tags: v.array(v.string()),
  memo_at: v.nullable(v.number()),
  is_task: v.picklist([0, 1]),
  task_status: v.nullable(v.string()),
  updated_at: v.number(),
  /** 正文里以首处命中为中心的一小段（客户端再做高亮精修） */
  snippet: v.string(),
});

export const SearchResponseSchema = v.object({
  results: v.array(SearchResultItemSchema),
});

export type SearchResultItem = v.InferOutput<typeof SearchResultItemSchema>;
export type SearchResponse = v.InferOutput<typeof SearchResponseSchema>;

/** 查询串长度上限（避免超长输入把子串扫描拖垮） */
export const SEARCH_QUERY_MAX_LENGTH = 100;

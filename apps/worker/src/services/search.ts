/**
 * 搜索服务（架构 §2.3.2 的 `services/search.ts`；M2-6 的服务端兜底）。
 *
 * **用在什么时候**：正常检索走客户端本地索引（离线优先）。只有"本地索引还没建完"时
 * 界面层才回退到这里，所以这条路径**不追求快**，只要求"能给出正确且不越权的候选"。
 *
 * 三条口径：
 * 1. **`instr()` 子串扫描，不用 `LIKE '%…%'`**：`LIKE` 前导通配符无法走索引、语义还受 `%` `_`
 *    转义困扰；`instr()` 是纯函数式的子串查找，输入里的 `%` 不会被当成通配符（安全性更好）。
 * 2. **隐私过滤与服务端同源**：`enc_self = 0 AND in_enc_space = 0 AND deleted_at IS NULL`——
 *    与客户端 `isSearchVisible()` 同一套条件（M3 接隐私锁时两边一起改）。
 * 3. **永远带 `user_id`**：多租户隔离是硬要求，不接受"上游已经过滤过"的假设。
 *
 * `lower()` 在 SQLite 只处理 ASCII；中文不受大小写影响，所以两边同时 `lower()` 即可正确匹配英文。
 */
import type { ItemType } from "@menote/shared";

export interface SearchQuery {
  text: string;
  type: ItemType | "all";
  /** `undefined` = 不限；`null` = 根目录；字符串 = 指定文件夹 */
  folderId: string | null | undefined;
  tag: string | null;
  from: number | null;
  to: number | null;
  limit: number;
}

export interface SearchResultRow {
  id: string;
  type: ItemType;
  folder_id: string | null;
  title: string | null;
  tags: string;
  memo_at: number | null;
  is_task: number;
  task_status: string | null;
  updated_at: number;
  snippet: string;
}

/** 结果行上限（本轮不做分页：个人量级够用，也让"回退"这条路径保持简单） */
export const SEARCH_RESULT_LIMIT = 50;

interface SearchSql {
  sql: string;
  params: Array<string | number>;
}

/** 组装 SQL（导出便于单测直接校验条件拼装，不必起 Worker） */
export function buildSearchSql(userId: string, query: SearchQuery): SearchSql {
  const needle = query.text.toLowerCase();
  const conditions = [
    "i.user_id = ?",
    "i.deleted_at IS NULL",
    "i.enc_self = 0",
    "i.in_enc_space = 0",
    "(instr(lower(COALESCE(i.title, '')), ?) > 0 OR instr(lower(i.tags), ?) > 0 OR instr(lower(b.body), ?) > 0)",
  ];
  const params: Array<string | number> = [userId, needle, needle, needle];

  if (query.type !== "all") {
    conditions.push("i.type = ?");
    params.push(query.type);
  }
  if (query.folderId !== undefined) {
    if (query.folderId === null) {
      conditions.push("i.folder_id IS NULL");
    } else {
      conditions.push("i.folder_id = ?");
      params.push(query.folderId);
    }
  }
  if (query.tag !== null) {
    // tags 是 JSON 数组文本（如 ["工作","dev"]）：用带引号的子串匹配，避免 "工作" 命中 "工作日志"
    conditions.push("instr(i.tags, ?) > 0");
    params.push(`"${query.tag}"`);
  }
  if (query.from !== null) {
    conditions.push("i.updated_at >= ?");
    params.push(query.from);
  }
  if (query.to !== null) {
    conditions.push("i.updated_at <= ?");
    params.push(query.to);
  }

  params.push(query.limit);

  return {
    sql: [
      "SELECT i.id, i.type, i.folder_id, i.title, i.tags, i.memo_at, i.is_task, i.task_status, i.updated_at,",
      // 片段：以正文里第一处命中为中心截一段（找不到命中就取开头），交给客户端再精修高亮
      "substr(b.body, max(1, instr(lower(b.body), ?) - 40), 120) AS snippet",
      "FROM items i JOIN item_bodies b ON b.item_id = i.id",
      `WHERE ${conditions.join(" AND ")}`,
      "ORDER BY i.updated_at DESC",
      "LIMIT ?",
    ].join(" "),
    // snippet 的参数排在 SELECT 里最前，所以插到 params 的最前面
    params: [needle, ...params],
  };
}

export async function searchItems(
  db: D1Database,
  userId: string,
  query: SearchQuery,
): Promise<SearchResultRow[]> {
  const { sql, params } = buildSearchSql(userId, query);
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<SearchResultRow>();
  return result.results ?? [];
}

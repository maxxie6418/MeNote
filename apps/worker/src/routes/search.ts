/**
 * 搜索路由（架构 §2.3.2 的 `routes/search.ts`；M2-6 的服务端兜底）。
 *
 * `GET /api/search`：只在客户端本地索引还没建完时被调用。参数都走白名单解析，
 * 非法输入按"忽略该筛选条件"处理而不是报错——这条路径是兜底，不该因为一个坏参数就整个失败。
 */
import {
  SEARCH_QUERY_MAX_LENGTH,
  type SearchResponse,
  type SearchResultItem,
} from "@menote/shared";
import { Hono } from "hono";
import { DomainError } from "../errors";
import { requireSession } from "../middleware/session";
import { SEARCH_RESULT_LIMIT, searchItems, type SearchQuery } from "../services/search";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

/** `tags` 在库里是 JSON 数组文本；解析失败按空数组处理（脏数据不至于让搜索 500） */
function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function numberParam(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

app.get("/search", requireSession, async (c) => {
  const text = (c.req.query("q") ?? "").trim();
  if (text === "") throw new DomainError("invalid", "缺少查询内容");
  if (text.length > SEARCH_QUERY_MAX_LENGTH) {
    throw new DomainError("invalid", `查询内容最多 ${SEARCH_QUERY_MAX_LENGTH} 个字符`);
  }

  const typeParam = c.req.query("type");
  const folderParam = c.req.query("folder");
  const tagParam = c.req.query("tag");

  const query: SearchQuery = {
    text,
    type: typeParam === "note" || typeParam === "table" || typeParam === "memo" ? typeParam : "all",
    // `folder=root` 表示根目录；缺省表示不限
    folderId: folderParam === undefined ? undefined : folderParam === "root" ? null : folderParam,
    tag: tagParam === undefined || tagParam === "" ? null : tagParam,
    from: numberParam(c.req.query("from")),
    to: numberParam(c.req.query("to")),
    limit: SEARCH_RESULT_LIMIT,
  };

  const rows = await searchItems(c.env.DB, c.get("user").id, query);

  const results: SearchResultItem[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    folder_id: row.folder_id,
    title: row.title,
    tags: parseTags(row.tags),
    memo_at: row.memo_at,
    is_task: row.is_task === 1 ? 1 : 0,
    task_status: row.task_status,
    updated_at: row.updated_at,
    snippet: row.snippet,
  }));

  const response: SearchResponse = { results };
  return c.json(response);
});

export default app;

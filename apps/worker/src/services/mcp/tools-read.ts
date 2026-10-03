/**
 * MCP 的 5 个只读工具（M6 批 2；设计 §六-2；工具清单与参数照《设计文档》§17.5）。
 *
 * 三条贯穿的取舍：
 * 1. **一律有界**（设计 §17.4）：正文默认 8000 字符、上限 20000，超出给游标；
 *    列表与搜索每页最多 50 条。目的是别让 agent 一次把整库灌进上下文。
 * 2. **可见性由 `scope.ts` 的那一个片段统一拼**，本文件不重写隐私条件——重写就一定有地方漏。
 *    `search` 更是直接复用界面兜底搜索的**同一段 SQL 组装**（`buildSearchSql` 的
 *    `extraConditions` 口子），不给「另一份搜索实现」留位置。
 * 3. **查不到与不可见同形**：都返回空结果 / 同一句提示，响应体一致，agent 探测不到存在性。
 *
 * 游标编解码、字符切片、参数夹取、条目元数据映射都在 `parts.ts`——批 3 的写类工具也要用它们。
 *
 * 五个工具的入参一律是 `(env: StorageEnv, principal, args)`，与 `registry.ts` 的 `run` 对齐。
 * `read_item` / `list_versions` 要读版本正文（在 R2），所以拿得到 `env` 比一个 `D1Database` 实用。
 *
 * 返回值一律是**普通对象**，由 `routes/mcp.ts` 统一 `JSON.stringify` 成 MCP 的 text 内容。
 */
import { MCP_SNIPPET } from "@menote/shared";
import type { StorageEnv } from "../../types";
import { buildSearchSql } from "../search";
import { listVersions as listItemVersions } from "../versions";
import type { McpPrincipal } from "./auth";
import {
  ITEM_META_COLUMNS,
  clampPageLimit,
  decodeListCursor,
  encodeListCursor,
  fail,
  isItemType,
  pickId,
  readTags,
  toItemMeta,
  type ItemMetaRow,
} from "./parts";
import { loadVisibleHead } from "./tools-read-item";
import { visibilityClause } from "./scope";

// ———————————————————————————————————————— 1. search

export interface SearchArgs {
  query?: unknown;
  type?: unknown;
  folder_id?: unknown;
  tag?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

export async function runSearch(
  env: StorageEnv,
  principal: McpPrincipal,
  args: SearchArgs,
): Promise<unknown> {
  const text = (typeof args.query === "string" ? args.query : "").trim();
  if (text === "") fail("query 不能为空");
  if (text.length > 200) fail("query 最长 200 个字符");

  const limit = clampPageLimit(args.limit);
  const cursor = decodeListCursor(args.cursor);
  const visibility = visibilityClause(principal);

  /*
    可见性与游标都作为**额外条件**塞进 `buildSearchSql`——那份 SQL 组装同时带着
    隐私过滤与命中判定，是唯一的一份实现。MCP 在外面再写一遍就会漂移，
    漏掉一个条件就是一次泄漏。
  */
  const extraConditions = [visibility.sql];
  const extraParams: Array<string | number> = [...visibility.params];
  if (cursor) {
    extraConditions.push("(i.updated_at < ? OR (i.updated_at = ? AND i.id < ?))");
    extraParams.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }

  const built = buildSearchSql(
    principal.userId,
    {
      text,
      type: isItemType(args.type) ? args.type : "all",
      // 范围限制由 `visibilityClause` 负责；这里的 `folder_id` 是「再精确筛一层」，两者是「与」
      folderId:
        args.folder_id === undefined
          ? undefined
          : args.folder_id === null
            ? null
            : String(args.folder_id),
      tag: typeof args.tag === "string" && args.tag !== "" ? args.tag : null,
      from: null,
      to: null,
      limit: limit + 1,
    },
    {
      snippet: MCP_SNIPPET,
      extraConditions,
      extraParams,
      // `(updated_at, id)` 兜底同毫秒——游标分页必须与排序严格一致
      orderBy: "i.updated_at DESC, i.id DESC",
    },
  );

  const rows = await env.DB.prepare(built.sql).bind(...built.params).all<ItemMetaRow & { snippet: string }>();
  const all = rows.results ?? [];
  const page = all.slice(0, limit);
  const last = page[page.length - 1];
  return {
    results: page.map((row) => ({ ...toItemMeta(row), snippet: row.snippet })),
    next_cursor:
      all.length > limit && last ? encodeListCursor({ updatedAt: last.updated_at, id: last.id }) : null,
  };
}

// ———————————————————————————————————————— 2. list_folders

export async function runListFolders(
  env: StorageEnv,
  principal: McpPrincipal,
): Promise<unknown> {
  const visibility = visibilityClause(principal);

  /*
    计数口径与条目可见性**完全一致**（同一套 `visibilityClause`）——这正是 M17-03 要求的
    「MCP 返回的条目数不含隐私内容」。界面侧的统计是另一套口径（计入全部内容），
    两套互不影响、不可互相推导（《隐私锁设计 v1.3》I4）。
  */
  const folders = await env.DB.prepare(
    `SELECT f.id, f.parent_id, f.name, f.depth, f.position,
            (SELECT COUNT(*) FROM items i WHERE i.folder_id = f.id AND ${visibility.sql}) AS item_count
     FROM folders f
     WHERE f.user_id = ? AND f.deleted_at IS NULL AND f.is_enc_space = 0 AND f.in_enc_space = 0
     ORDER BY f.depth, f.position, f.name`,
  )
    .bind(...visibility.params, principal.userId)
    .all<{ id: string; parent_id: string | null; name: string; depth: number; item_count: number }>();

  const tagRows = await env.DB.prepare(`SELECT i.tags FROM items i WHERE ${visibility.sql}`)
    .bind(...visibility.params)
    .all<{ tags: string }>();

  // 标签在库里是 JSON 数组文本、没有可 join 的表，只能数一次。个人量级下可接受。
  const counts = new Map<string, number>();
  for (const row of tagRows.results ?? []) {
    for (const tag of readTags(row.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }

  return {
    // 加密空间节点被 `is_enc_space = 0` 挡在外面，**不出现在文件夹树里**（M17-03）
    folders: (folders.results ?? []).map((row) => ({
      id: row.id,
      parent_id: row.parent_id,
      name: row.name,
      depth: row.depth,
      item_count: row.item_count,
    })),
    tags: [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count })),
  };
}

// ———————————————————————————————————————— 3. list_items

export interface ListItemsArgs {
  folder_id?: unknown;
  type?: unknown;
  tag?: unknown;
  task_status?: unknown;
  updated_after?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

export async function runListItems(
  env: StorageEnv,
  principal: McpPrincipal,
  args: ListItemsArgs,
): Promise<unknown> {
  const limit = clampPageLimit(args.limit);
  const cursor = decodeListCursor(args.cursor);
  const visibility = visibilityClause(principal);

  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (isItemType(args.type)) {
    conditions.push("i.type = ?");
    params.push(args.type);
  }
  if (args.folder_id === null) {
    conditions.push("i.folder_id IS NULL");
  } else if (typeof args.folder_id === "string" && args.folder_id !== "") {
    conditions.push("i.folder_id = ?");
    params.push(args.folder_id);
  }
  if (typeof args.tag === "string" && args.tag !== "") {
    // 带引号的子串匹配，避免「工作」命中「工作日志」（与界面兜底搜索同一手法）
    conditions.push("instr(i.tags, ?) > 0");
    params.push(`"${args.tag}"`);
  }
  if (typeof args.task_status === "string" && args.task_status !== "") {
    conditions.push("i.task_status = ?");
    params.push(args.task_status);
  }
  if (typeof args.updated_after === "number" && Number.isFinite(args.updated_after)) {
    conditions.push("i.updated_at > ?");
    params.push(args.updated_after);
  }
  if (cursor) {
    conditions.push("(i.updated_at < ? OR (i.updated_at = ? AND i.id < ?))");
    params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }
  const where = conditions.length > 0 ? ` AND ${conditions.join(" AND ")}` : "";

  const rows = await env.DB.prepare(
    `SELECT ${ITEM_META_COLUMNS} FROM items i WHERE ${visibility.sql}${where}
     ORDER BY i.updated_at DESC, i.id DESC LIMIT ?`,
  )
    .bind(...visibility.params, ...params, limit + 1)
    .all<ItemMetaRow>();

  const all = rows.results ?? [];
  const page = all.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toItemMeta),
    next_cursor:
      all.length > limit && last ? encodeListCursor({ updatedAt: last.updated_at, id: last.id }) : null,
  };
}

// ———————————————————————————————————————— 5. list_versions

export interface ListVersionsArgs {
  id?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

export async function runListVersions(
  env: StorageEnv,
  principal: McpPrincipal,
  args: ListVersionsArgs,
): Promise<unknown> {
  const itemId = pickId(args.id);
  // 先确认条目可见：否则「不可见条目」与「没有版本」会混成同一个空结果，agent 分不出
  await loadVisibleHead(env, principal, itemId);

  const limit = Math.min(clampPageLimit(args.limit), 200);
  const rawCursor = typeof args.cursor === "string" ? Number.parseInt(args.cursor, 10) : Number.NaN;
  const page = await listItemVersions(env.DB, principal.userId, itemId, {
    limit,
    cursor: Number.isFinite(rawCursor) ? rawCursor : null,
  });

  return {
    item_id: itemId,
    versions: page.versions.map((version) => ({
      id: version.id,
      rev: version.rev,
      reason: version.reason,
      label: version.label,
      size_bytes: version.size_bytes,
      created_at: version.created_at,
    })),
    next_cursor: page.next_cursor === null ? null : String(page.next_cursor),
  };
}

/**
 * `edit_table_rows` 一个工具（M6 批 3；设计 §六-3 第 9 项）。
 *
 * 单独成文件是因为表格那一摊有它自己的边界：行 ID 稳定性、列 id 与列名的宽容读入、
 * 256 KB 门槛（比普通小节的 512 KB 严一档，因为解析整张表的代价是数量级的）。
 * 这些规则只服务于这一个工具，混进 `tools-write-edit.ts` 会把那边的叙事也搅乱。
 *
 * ## 两条校验先于任何写入
 *
 * 1. **行 ID 必须真的存在**——写一个不存在的行 ID 时"静默不生效"是最坏的失败方式，
 *    agent 会以为改成功了；
 * 2. **列名必须真的存在**（按**列 id** 认，与解析器同一套口径）——手写表里列名对不上很常见，
 *    报「没有名为 X 的列」比写进去一列没人认的垃圾数据好。
 */
import { MCP_PERM_EDIT, MCP_PERM_LABELS, MCP_TABLE_MAX_BYTES } from "@menote/shared";
import { parseTableDocument, renderTableDocument } from "@menote/mdcore";
import type { StorageEnv } from "../../types";
import { assertMcpPerm, type McpPrincipal } from "./auth";
import { fail, pickId } from "./parts";
import { checkRev, commitBody, requireExpectedRev, requireVisibleWrite } from "./write-parts";

/** 表格正文；读不到按「不可见」处理（与「不存在」同一句提示） */
async function loadBody(env: StorageEnv, itemId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT body FROM item_bodies WHERE item_id = ?")
    .bind(itemId)
    .first<{ body: string }>();
  if (!row) fail("条目不存在或不在可见范围内");
  return row.body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function runEditTableRows(
  env: StorageEnv,
  principal: McpPrincipal,
  args: Record<string, unknown>,
): Promise<unknown> {
  assertMcpPerm(principal, MCP_PERM_EDIT, MCP_PERM_LABELS[MCP_PERM_EDIT]!);

  const itemId = pickId(args.id);
  const head = await requireVisibleWrite(env, principal, itemId);
  if (head.type !== "table") fail("只有表格条目能按行编辑");
  if (head.size_bytes > MCP_TABLE_MAX_BYTES) {
    fail(`表格超过 ${MCP_TABLE_MAX_BYTES / 1024} KB，请在应用中编辑`);
  }
  checkRev(head.rev, requireExpectedRev(args, "expected_rev"), args.on_conflict);
  // 冲突副本对按行编辑没有意义（副本是新条目，而这里要改的是原条目的某几行）
  if (args.on_conflict === "copy") fail("edit_table_rows 不支持 on_conflict: copy");

  const updates = isRecord(args.updates) ? args.updates : null;
  const deletes = Array.isArray(args.deletes)
    ? args.deletes.filter((id): id is string => typeof id === "string")
    : [];
  if (updates === null && deletes.length === 0) fail("edit_table_rows 需要 updates 或 deletes");

  const parsed = parseTableDocument(await loadBody(env, itemId));
  if (!parsed.ok) fail(`表格结构有问题：${parsed.reason}`);

  const { rowIdColumn, columns, rows } = parsed.doc;
  const columnIds = new Set(columns.map((column) => column.id));
  const exists = (rowId: string): boolean => rows.some((row) => (row[rowIdColumn] ?? "") === rowId);

  if (updates !== null) {
    for (const [rowId, cells] of Object.entries(updates)) {
      if (!exists(rowId)) fail(`没有找到行 ID 为 ${rowId} 的行`);
      if (!isRecord(cells)) fail(`updates.${rowId} 必须是「列名 → 单元格值」的对象`);
      for (const column of Object.keys(cells)) {
        if (!columnIds.has(column)) fail(`没有名为「${column}」的列`);
      }
    }
  }
  for (const rowId of deletes) {
    if (!exists(rowId)) fail(`没有找到行 ID 为 ${rowId} 的行`);
  }

  const nextRows = rows
    .map((row) => ({ row, rowId: row[rowIdColumn] ?? "" }))
    .filter(({ rowId }) => !deletes.includes(rowId))
    .map(({ row, rowId }) => {
      const cells = updates?.[rowId];
      return isRecord(cells) ? { ...row, ...(cells as Record<string, string>) } : row;
    });

  const now = Date.now();
  const written = await commitBody(
    env,
    principal,
    "edit_table_rows",
    head,
    renderTableDocument({ ...parsed.doc, rows: nextRows }),
    null,
    "",
    now,
  );
  return { id: itemId, rev: written.rev, rows: nextRows.length, changed: true };
}

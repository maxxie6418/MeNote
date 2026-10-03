/**
 * MCP 的可见性与范围过滤（M6 批 2；架构 §十一 的第 6 步、功能拆解 M17-03）。
 *
 * ## 两条不变式（架构 §十一 逐字照抄，实现时按它们反推）
 *
 * - **I1**：MCP 可见集合 ＝ 令牌范围 ∩ 非隐私内容 ∩（Memo 需令牌勾选「包含 Memo」）∩ 非回收站，
 *   **与隐私锁是否解锁无关**。
 * - **I2**：界面矩阵与 MCP 矩阵**互不联动**——改隐私范围配置不动令牌，改令牌不动范围。
 *
 * ## 为什么每一处查询都必须带这四条
 *
 * 漏掉任何一条都对应一类具体的泄漏：
 * - 漏 `user_id` → 跨租户（owner 也只能看自己的，这是硬要求，架构 §13.2）；
 * - 漏 `deleted_at IS NULL` → 回收站里的内容被 agent 读到，用户以为它已经删了；
 * - 漏隐私条件 → 加密内容泄漏，这条由 `db/privacy.ts` 那个字面量守着（那边有断言测试防漂移）；
 * - 漏 Memo 条件 → 令牌没勾「包含 Memo」却读到了 Memo。
 *
 * 所以可见性是**一个函数拼出来的固定片段**，不是每处手写——手写就一定有地方忘。
 */
import { SQL_FOLDER_SCOPE_CLAUSE, itemVisibilitySql } from "../../db/mcp-tables";
import { SQL_SELECT_FOLDER_BY_ID } from "../../db/tables";
import { DomainError } from "../../errors";
import type { McpPrincipal } from "./auth";

export interface VisibilityClause {
  /** 直接接在 `WHERE` 后面（不含 `WHERE` 本身） */
  sql: string;
  /** 与 `sql` 里 `?` 一一对应的参数，顺序也一致 */
  params: Array<string | number>;
}

/**
 * 可见性条件片段。`params` 的第一个一定是 `user_id` —— 调用方把它接在别的前置条件后面时，
 * 要靠这个顺序对齐，所以**追加别的条件只能加在 `params` 末尾**。
 */
export function visibilityClause(principal: McpPrincipal): VisibilityClause {
  const params: Array<string | number> = [principal.userId];
  let sql = itemVisibilitySql(principal.includeMemos);

  if (principal.folderScope !== null) {
    // 文件夹最多两层（需求 §4.5）：选中的文件夹 + 它们的直接子文件夹。
    // 同一份 JSON 绑两次——第一层选中的，和 parent_id 命中的。
    const scope = JSON.stringify(principal.folderScope);
    sql += SQL_FOLDER_SCOPE_CLAUSE;
    params.push(principal.userId, scope, scope);
  }
  return { sql, params };
}

/**
 * 判定某个文件夹是否是"可以往里放东西"的目标（`create_item` / `organize_item` 用）。
 *
 * 三条拒绝，理由各不相同：
 * 1. **不属于该用户** —— 越权，连查都不该查（404 形状）；
 * 2. **是加密空间** —— MCP 看不见加密内容，就**不该有能力改变内容的加密归属**（设计 §6.8）。
 *    把一条笔记塞进加密空间，会让用户在界面上再也找不到它；
 * 3. **不在令牌范围内** —— 设计 §17.3 明写"不能把内容移出或移入范围"。
 */
export async function assertWritableFolder(
  db: D1Database,
  principal: McpPrincipal,
  folderId: string | null,
): Promise<void> {
  if (folderId === null) {
    // 移到根目录：限定文件夹的令牌不允许"移出范围"，那等于把它挪到看不见的地方
    if (principal.folderScope !== null) {
      throw new DomainError("forbidden", "该令牌限定了文件夹范围，不能移到根目录");
    }
    return;
  }

  const folder = await db
    .prepare(SQL_SELECT_FOLDER_BY_ID)
    .bind(folderId, principal.userId)
    .first<{ id: string; is_enc_space: number; parent_id: string | null }>();
  if (!folder) throw new DomainError("not_found", "文件夹不存在");
  if (folder.is_enc_space === 1) {
    throw new DomainError("forbidden", "不能通过 MCP 移动到加密空间");
  }

  if (principal.folderScope === null) return;
  const scope = principal.folderScope;
  // 选中的文件夹，或它的父文件夹在选中集合里（含子文件夹的那一层）
  if (scope.includes(folder.id)) return;
  if (folder.parent_id !== null && scope.includes(folder.parent_id)) return;
  throw new DomainError("forbidden", "目标文件夹不在该令牌的范围内");
}

/**
 * 按 `id` 取一条**可见**条目；查不到就是 `null`。
 *
 * 调用方**不要**区分"不存在"与"不可见"——两者都返回同一个 `null`，
 * 于是响应体也一样，agent 探测不到"这条 id 存在但你看不到"。
 */
export async function loadVisibleItem(
  db: D1Database,
  principal: McpPrincipal,
  itemId: string,
  columns = "i.id, i.type, i.folder_id, i.title, i.tags, i.memo_at, i.is_task, i.task_status, i.updated_at, i.rev, i.meta_rev, i.size_bytes, i.enc_self, i.in_enc_space, i.deleted_at",
): Promise<Record<string, unknown> | null> {
  const visibility = visibilityClause(principal);
  return (
    (await db
      .prepare(`SELECT ${columns} FROM items i WHERE i.id = ? AND ${visibility.sql}`)
      .bind(itemId, ...visibility.params)
      .first<Record<string, unknown>>()) ?? null
  );
}

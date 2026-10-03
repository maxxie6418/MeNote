/**
 * MCP 的三个修改类工具：`edit_item` / `edit_table_rows` / `organize_item`（M6 批 3；设计 §六-3）。
 *
 * 三个共用同一套机制（在 `write-parts.ts`）：**乐观锁必带**、查不到与不可见同形、
 * 审计与幂等跟写入同批（修改类的 `operation_id` 是可选的——乐观锁已经保证重试安全）。
 *
 * ## `edit_item` 的五种模式（设计 §17.5）
 *
 * | mode | 做什么 | 门槛 |
 * |---|---|---|
 * | `replace_text` | 唯一精确文本替换，出现 ≠1 次即报错 | 512 KB（更大的走 SQL，见下） |
 * | `replace_section` | 替换某个 Markdown 小节 | 512 KB |
 * | `replace_all` | 整篇替换 | 写入内容 ≤256 KB |
 * | `merge_properties` | 合并 YAML 属性（含清单字段），走 mdcore `updateMenoteKeys` | 512 KB |
 * | `restore_version` | 恢复到某个历史版本 | 复用既有恢复服务 |
 *
 * **大条目为什么只能区间读**：`replace_text` 对 ≤512 KB 在 Worker 里做，
 * 更大的条目设计 §17.4 说「在 SQL 中完成」——本批**没有实现那条 SQL 路径**，
 * 统一按"超过 512 KB 就拒绝并提示改用区间 / 游标"处理。这是本批的已知未实现项，
 * 记在设计稿 §十一。
 */
import {
  MCP_PERM_EDIT,
  MCP_PERM_LABELS,
  MCP_SECTION_MAX_BYTES,
  MCP_WRITE_MAX_BYTES,
  newUlid,
  sha256Hex,
  utf8ByteLength,
  type ItemType,
} from "@menote/shared";
import { findSectionRange, updateMenoteKeys } from "@menote/mdcore";
import { createItem } from "../items";
import { patchItemMeta } from "../item-meta";
import { restoreVersion } from "../versions";
import type { StorageEnv } from "../../types";
import { assertMcpPerm, type McpPrincipal } from "./auth";
import { auditStatement, writeAudit } from "./audit";
import { fail, pickId } from "./parts";
import { assertWritableFolder } from "./scope";
import {
  beginIdempotent,
  checkRev,
  commitBody,
  deviceLabel,
  isReplay,
  pickOperationId,
  requireExpectedRev,
  requireVisibleWrite,
  type WriteItemBase,
} from "./write-parts";

const NOT_VISIBLE = "条目不存在或不在可见范围内";

/** 表格正文；读不到按「不可见」处理（与「不存在」同一句提示） */
async function loadBody(env: StorageEnv, itemId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT body FROM item_bodies WHERE item_id = ?")
    .bind(itemId)
    .first<{ body: string }>();
  if (!row) fail(NOT_VISIBLE);
  return row.body;
}

const EDIT_MODES = [
  "replace_text",
  "replace_section",
  "replace_all",
  "merge_properties",
  "restore_version",
] as const;
type EditMode = (typeof EDIT_MODES)[number];

// ———————————————————————————————————————— 8. edit_item

export async function runEditItem(
  env: StorageEnv,
  principal: McpPrincipal,
  args: Record<string, unknown>,
): Promise<unknown> {
  assertMcpPerm(principal, MCP_PERM_EDIT, MCP_PERM_LABELS[MCP_PERM_EDIT]!);

  const itemId = pickId(args.id);
  const mode = args.mode as EditMode;
  if (!EDIT_MODES.includes(mode)) {
    fail(`mode 必须是 ${EDIT_MODES.join(" / ")}`);
  }

  const operationId = pickOperationId(args, false);
  const started = await beginIdempotent(env, principal, operationId, args);
  if (isReplay(started)) return started.replay;

  const now = Date.now();
  const head = await requireVisibleWrite(env, principal, itemId);

  if (mode === "restore_version") {
    const versionId = pickId(args.version_id);
    checkRev(head.rev, requireExpectedRev(args, "expected_rev"), args.on_conflict);
    if (args.on_conflict === "copy") {
      fail("restore_version 不支持 on_conflict: copy；请先用 read_item 读出内容，再用 create_item 建新条目");
    }
    // `restoreVersion` 内部没有 expected_rev 守卫（它直接 rev + 1），所以上面那次判定是**唯一**的守卫
    const result = await restoreVersion(env, principal.userId, versionId, now);
    if (result.item.id !== head.id) fail("该版本不属于这条目");
    await writeAudit(env.DB, {
      userId: principal.userId,
      tokenId: principal.tokenId,
      tool: "edit_item",
      itemId,
      revBefore: head.rev,
      revAfter: result.item.rev,
      result: "ok",
      operationId,
      now,
    });
    return { id: itemId, rev: result.item.rev, mode, version_id: versionId, changed: true };
  }

  checkRev(head.rev, requireExpectedRev(args, "expected_rev"), args.on_conflict);
  if (head.size_bytes > MCP_SECTION_MAX_BYTES) {
    fail(
      `条目超过 ${MCP_SECTION_MAX_BYTES / 1024} KB，无法整篇处理；请改用区间 / 游标操作，或在应用中编辑`,
    );
  }

  const body = await loadBody(env, itemId);
  const nextBody = applyEditMode(mode, body, args);

  const currentHash = await sha256Hex(body);
  if ((await sha256Hex(nextBody)) === currentHash) {
    return { id: itemId, rev: head.rev, mode, changed: false };
  }

  if (args.on_conflict === "copy") {
    return makeConflictCopy(env, principal, head, nextBody, now);
  }

  const written = await commitBody(env, principal, "edit_item", head, nextBody, operationId, started.hash, now);
  return { id: itemId, rev: written.rev, mode, changed: true };
}

function applyEditMode(mode: EditMode, body: string, args: Record<string, unknown>): string {
  switch (mode) {
    case "replace_all": {
      const next = typeof args.content === "string" ? args.content : "";
      if (utf8ByteLength(next) > MCP_WRITE_MAX_BYTES) {
        fail(`单次写入不超过 ${MCP_WRITE_MAX_BYTES / 1024} KB`);
      }
      return next;
    }

    case "replace_text": {
      const from = args.from;
      const to = args.to;
      if (typeof from !== "string" || from === "") fail("replace_text 需要 from 与 to");
      if (typeof to !== "string") fail("replace_text 需要 from 与 to");
      /*
        **唯一精确替换**：出现次数 ≠ 1 直接报错。
        两段一模一样的段落时让 agent 自己消歧（用更长的上下文、或改用 replace_section），
        而不是替它挑第一个——那会改错地方且 agent 无从察觉。
      */
      const first = body.indexOf(from);
      if (first < 0) fail("没有找到待替换的文本");
      if (body.indexOf(from, first + 1) >= 0) {
        fail("待替换的文本出现了多次，无法确定改哪一处；请用更长的上下文，或改用 replace_section");
      }
      return body.slice(0, first) + to + body.slice(first + from.length);
    }

    case "replace_section": {
      const section = typeof args.section === "string" ? args.section : "";
      const replacement = typeof args.content === "string" ? args.content : "";
      if (section === "" || replacement === "") fail("replace_section 需要 section 与 content");
      const range = findSectionRange(body, section);
      if (!range) fail(`没有找到标题为「${section}」的小节`);
      // 缩回尾随换行，让节间分隔留在原地（理由同 mdcore 的 replaceSection）
      let end = range.end;
      while (end > range.start && (body[end - 1] === "\n" || body[end - 1] === "\r")) end -= 1;
      return body.slice(0, range.start) + replacement + body.slice(end);
    }

    case "merge_properties": {
      // 属性就是 md 的 YAML，不必单独成工具（设计 §17.6 的取舍：砍掉 get/update_note_properties）
      const patch = args.properties;
      if (typeof patch !== "object" || patch === null) fail("merge_properties 需要 properties");
      const props = patch as Record<string, unknown>;
      return updateMenoteKeys(body, {
        tags: Array.isArray(props.tags)
          ? props.tags.filter((tag): tag is string => typeof tag === "string")
          : undefined,
        task: (props.task as never) ?? undefined,
      });
    }

    default:
      return fail(`不支持的 mode：${String(mode)}`);
  }
}

/** `on_conflict: "copy"`：生成**新条目**当副本，原条目一个字都不动 */
async function makeConflictCopy(
  env: StorageEnv,
  principal: McpPrincipal,
  head: WriteItemBase,
  nextBody: string,
  now: number,
): Promise<unknown> {
  const original = await env.DB.prepare("SELECT type, title, folder_id, tags FROM items WHERE id = ?")
    .bind(head.id)
    .first<{ type: ItemType; title: string | null; folder_id: string | null; tags: string }>();
  if (!original) fail(NOT_VISIBLE);

  const id = newUlid();
  await createItem(
    env.DB,
    principal.userId,
    {
      id,
      type: original.type,
      title: original.title === null ? null : `${original.title}（冲突副本）`,
      folderId: original.folder_id,
      tags: JSON.parse(original.tags) as string[],
      memoAt: original.type === "memo" ? now : null,
      isTask: 0,
      taskStatus: null,
      taskDue: null,
      taskPriority: null,
      contentHash: await sha256Hex(nextBody),
      body: nextBody,
      deviceLabel: deviceLabel(principal),
    },
    now,
  );
  return { id, rev: 1, conflict_copy: true, source_id: head.id };
}

// ———————————————————————————————————————— 10. organize_item

export async function runOrganizeItem(
  env: StorageEnv,
  principal: McpPrincipal,
  args: Record<string, unknown>,
): Promise<unknown> {
  assertMcpPerm(principal, MCP_PERM_EDIT, MCP_PERM_LABELS[MCP_PERM_EDIT]!);

  const itemId = pickId(args.id);
  const head = await requireVisibleWrite(env, principal, itemId);
  const baseMetaRev = requireExpectedRev(args, "expected_meta_rev");
  const now = Date.now();

  /*
    MCP **只做减法**（设计 §六-8）：不提供置 `enc_self`、不提供改 `type`，
    移动目标也不能是加密空间。理由是 MCP 看不见加密内容，就同样不该有改变
    内容加密归属的能力——否则一个被诱导的 agent 可以把笔记塞进加密空间，
    让用户在界面上再也找不到它。
  */
  const patch: Record<string, unknown> = { base_meta_rev: baseMetaRev };
  if (typeof args.title === "string") patch.title = args.title;
  if (typeof args.pinned === "boolean") patch.pinned = args.pinned ? 1 : 0;
  if (typeof args.starred === "boolean") patch.starred = args.starred ? 1 : 0;
  if (Array.isArray(args.add_tags) || Array.isArray(args.remove_tags)) {
    const current = await env.DB.prepare("SELECT tags FROM items WHERE id = ?")
      .bind(itemId)
      .first<{ tags: string }>();
    const tags = JSON.parse(current?.tags ?? "[]") as string[];
    for (const tag of (args.add_tags ?? []) as string[]) {
      if (typeof tag === "string" && tag !== "" && !tags.includes(tag)) tags.push(tag);
    }
    for (const tag of (args.remove_tags ?? []) as string[]) {
      const at = tags.indexOf(tag);
      if (at >= 0) tags.splice(at, 1);
    }
    patch.tags = tags;
  }
  if (args.folder_id !== undefined) {
    const target = typeof args.folder_id === "string" && args.folder_id !== "" ? args.folder_id : null;
    await assertWritableFolder(env.DB, principal, target);
    patch.folder_id = target;
  }
  if (Object.keys(patch).length === 1) fail("至少要给一个要改的字段");

  try {
    // 审计与元数据写入**同一次 batch**（架构 §十一）：写成功但审计丢失，正是审计要防的事
    const result = await patchItemMeta(env.DB, principal.userId, itemId, patch as never, now, [
      auditStatement(env.DB, {
        userId: principal.userId,
        tokenId: principal.tokenId,
        tool: "organize_item",
        itemId,
        revBefore: head.meta_rev,
        revAfter: baseMetaRev + 1,
        result: "ok",
        operationId: null,
        now,
      }),
    ]);
    return { id: itemId, meta_rev: result.meta_rev, changed: true };
  } catch (error) {
    // `denied` / `conflict` 都要留痕：`conflict` 正是「agent 撞上了并发」的证据
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "meta_conflict") {
      await writeAudit(env.DB, {
        userId: principal.userId,
        tokenId: principal.tokenId,
        tool: "organize_item",
        itemId,
        revBefore: head.meta_rev,
        revAfter: null,
        result: "conflict",
        operationId: null,
        now,
      });
    }
    throw error;
  }
}

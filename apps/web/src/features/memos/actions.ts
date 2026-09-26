/**
 * Memo 的数据层动作（feature 内，直接用 `data/db`；由 `App` 组装到界面上）。
 *
 * 放在这里而不是塞进 `features/notes` 的 hook：转笔记是 Memo 自己的领域动作，
 * 两个 feature 之间不互相 import（架构 §2.3.3 的依赖方向）。
 */
import {
  createLocalNote,
  enqueueBodySave,
  getCachedBody,
  getDraft,
  getLocalItem,
  saveDraft,
} from "../../data/db";
import { newUlid } from "@menote/shared";
import { parseMenoteMeta, stripFrontmatter, updateMenoteKeys } from "@menote/mdcore";
import { buildNoteFromMemo } from "./model";

/**
 * Memo 转笔记（Q10）。
 *
 * - 新笔记落**根目录**（`createLocalNote` 不设 folder）；
 * - 标题取正文第一行（≤50 字），正文为其余内容；
 * - **清单字段从 YAML 去掉**，标签原样带走；
 * - 原 Memo **保留**：只在它的 md 里加 `converted_to: <新笔记 id>`，正文一字不动（避免时间线出现缺口）；
 * - 已转过则**幂等**返回原笔记 id（不重复生成第二篇）。
 *
 * 调用方负责"打开新笔记"与刷新（那是界面层的编排）。
 */
export async function convertMemoToNote(memoId: string): Promise<string> {
  const memo = await getLocalItem(memoId);
  if (!memo) throw new Error("Memo 不存在");

  // 取正文以未上传的草稿优先（正在编辑的内容也该被带走）
  const draft = await getDraft(memoId);
  const cached = await getCachedBody(memoId);
  const raw = draft?.body ?? cached?.body ?? "";

  const existing = parseMenoteMeta(raw).meta.convertedTo ?? null;
  if (existing !== null) return existing;

  const { title, body } = buildNoteFromMemo(stripFrontmatter(raw), memo.tags);

  const noteId = newUlid();
  const now = Date.now();
  await createLocalNote(noteId, title, body, now);

  // 原 Memo：只加关联键（保留其它 front matter 键与正文）
  const nextMemoBody = updateMenoteKeys(raw, { convertedTo: noteId });
  await saveDraft(memoId, nextMemoBody, now);
  await enqueueBodySave(memoId, memo.rev, now);

  return noteId;
}

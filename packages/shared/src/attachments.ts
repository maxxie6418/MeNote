/**
 * 附件引用的内容契约（正文里的 `/api/attachments/h/<sha256>` 链接）。
 *
 * 放在 shared 是因为**两端都要认同一条语法**：
 * - web 侧（备份 / 附件面板）从正文里取引用清单；
 * - Worker 侧（M5 分享的公开附件接口）要校验「请求的附件属于被分享条目**当前稿**的引用」，
 *   以正文为准，不用 `attachment_refs` 表——那表的引用集合对齐是 M6 的遗留项，可能有陈旧行。
 *
 * 同一个 sha 出现多次只算一次（**去重且保序**：上报给服务端的 `attachment_refs` 也用它）。
 */
/** 附件 URL 的引用（图片或链接，**任意出现都算引用**——与 web 侧上报口径同一条正则） */
const ATTACHMENT_REF_PATTERN = /\/api\/attachments\/h\/([0-9a-f]{64})/gi;

/** 从正文里抽出所有引用的哈希（去重且保序） */
export function extractAttachmentRefs(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(ATTACHMENT_REF_PATTERN)) {
    const sha = (match[1] ?? "").toLowerCase();
    if (sha && !found.includes(sha)) found.push(sha);
  }
  return found;
}

/**
 * 同 {@link extractAttachmentRefs}，但连文件名一起给（备份打包用）。
 * 同一个 sha 多次出现时取第一次出现的文件名；文件名缺失退回 `attachment`（不编造，也不让导出失败）。
 */
export function extractAttachmentRefsWithNames(
  body: string,
): Array<{ sha256: string; filename: string }> {
  const withNames: Array<{ sha256: string; filename: string }> = [];
  const pattern = /!\[([^\]]*)\]\(\/api\/attachments\/h\/([0-9a-f]{64})\)|\[([^\]]*)\]\(\/api\/attachments\/h\/([0-9a-f]{64})\)/gi;
  for (const match of body.matchAll(pattern)) {
    const sha = (match[2] ?? match[4] ?? "").toLowerCase();
    if (!sha) continue;
    if (withNames.some((item) => item.sha256 === sha)) continue;
    withNames.push({ sha256: sha, filename: (match[1] ?? match[3] ?? "").trim() || "attachment" });
  }
  return withNames;
}

/**
 * M5 备份包的格式契约（设计见 `docs/modules/Menote-M5-备份与导出-设计-v1.md`）。
 *
 * 放共享包的理由与 `content.ts` 一样：格式一旦发版就要**长期兼容**，导出方与导入方
 * 必须是同一份定义。本包不得依赖浏览器或 Worker 专有 API（架构 §2.3）——sha256 走
 * 共用的 `sha256Hex`，它内部用 WebCrypto，两端都有。
 *
 * 三条贯穿全文的原则：
 *
 * 1. **`COMPLETE` 是提交标记，不是装饰**。备份是用户唯一的救命资产，半截包被当成完整
 *    快照恢复的代价远大于"这次恢复失败"。所以校验失败一律**抛**，绝不静默跳过、
 *    绝不读一半。
 * 2. **路径必须在读盘之前归一化并校验**。备份包是外部输入；`../` 与绝对路径要在这里
 *    就死掉，不能指望解包库替我们兜。
 * 3. **元数据分两层**：`.md` 里的 front matter 原样不动（那篇笔记本身就是笔记），
 *    库侧状态集中在 `manifest.json`。详见设计 §2.1。
 */
import * as v from "valibot";
import { sha256Hex } from "./hash";

/** 备份格式标识与版本。改版本号 = 声明"旧包仍要能读"，不是"重写格式"。 */
export const BACKUP_FORMAT = "menote-backup" as const;
export const BACKUP_VERSION = 1;

/** 包内的固定名字。**改动会让所有已产出的备份失效**，所以它们是契约不是常量。 */
export const SNAPSHOT_DIR = "snapshot";
export const MANIFEST_NAME = "manifest.json";
export const COMPLETE_NAME = "COMPLETE";
export const NOTES_DIR = "notes";
export const ATTACHMENTS_DIR = "attachments";
export const FOLDERS_NAME = "folders.json";
export const SETTINGS_NAME = "settings.json";

const IntSchema = v.pipe(v.number(), v.integer());
/** 时间在包里一律是 **UTC ISO 字符串**；库里是毫秒数，边界处显式转换，不混着存。 */
const IsoDateTimeSchema = v.pipe(
  v.string(),
  v.check((value) => !Number.isNaN(Date.parse(value)), "必须是可解析的 UTC ISO 时间"),
);

/** 64 位十六进制：sha256 */
const Sha256Schema = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/, "必须是 64 位小写十六进制"));

/**
 * 是否含 C0 控制字符或 DEL。
 *
 * 逐字符看码位而不是写正则：`/[\x00-\x1f]/` 这种源码里带**字面控制字节**的写法既难读
 * 又会触发 eslint 的 `no-control-regex`，还得靠 disable 注释压着——用码位判断就没有
 * 这些麻烦。
 */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** 能否作为路径的**一段**（文件名 / id）：不许含分隔符、`.`/`..` 或控制字符 */
export function isSafeSegment(value: string): boolean {
  if (value === "") return false;
  if (value === "." || value === "..") return false;
  if (value.includes("/") || value.includes("\\")) return false;
  return !hasControlChar(value);
}

const SafeSegmentSchema = v.pipe(
  v.string(),
  v.check(isSafeSegment, "不能是空的，也不能含路径分隔符、`.`/`..` 或控制字符"),
);

/**
 * 附件在包内的路径：`snapshot/attachments/<sha256>--<原文件名>`。
 *
 * 内容寻址的好处是同一张图被十篇引用只存一份，改名也不影响去重（设计 §2.3）。
 *
 * **带 `snapshot/` 前缀**：manifest 里的 `path` 必须是**包内相对路径**，而
 * `normalizeSnapshotPath` 要求它落在 `snapshot/` 内。两边必须由同一个函数产出，
 * 否则清单里的路径会和包里的实际条目对不上——往返测试就是盯这条的。
 */
export function attachmentPath(sha256: string, filename: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(`附件 sha256 不合法：${sha256}`);
  }
  // 文件名会被拼进路径，是路径穿越的第二条入口——和 id 同样把关
  if (!isSafeSegment(filename)) {
    throw new Error(`附件文件名不合法：${filename}`);
  }
  return `${SNAPSHOT_DIR}/${ATTACHMENTS_DIR}/${sha256}--${filename}`;
}

/** 条目正文在包内的路径。一篇一个文件，id 即文件名。 */
export function notePath(itemId: string): string {
  if (!isSafeSegment(itemId)) {
    throw new Error(`条目 id 不合法：${itemId}`);
  }
  return `${SNAPSHOT_DIR}/${NOTES_DIR}/${itemId}.md`;
}

/** 文件夹树在包内的路径 */
export function foldersPath(): string {
  return `${SNAPSHOT_DIR}/${FOLDERS_NAME}`;
}

/** `COMPLETE` 标记在包内的路径 */
export function completePath(): string {
  return `${SNAPSHOT_DIR}/${COMPLETE_NAME}`;
}

/** `manifest.json` 在包内的路径 */
export function manifestPath(): string {
  return `${SNAPSHOT_DIR}/${MANIFEST_NAME}`;
}

/**
 * 归一化并校验包内相对路径。
 *
 * 拒绝：空串、绝对路径、Windows 盘符、反斜杠、任何 `..` 段、控制字符。
 * 允许 `.` 段（归一化时去掉）——它不是穿越，只是冗余。
 */
export function normalizeSnapshotPath(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") {
    throw new Error("路径为空");
  }
  if (hasControlChar(raw)) {
    throw new Error("路径含控制字符");
  }
  if (raw.includes("\\")) {
    throw new Error(`路径不许用反斜杠：${raw}`);
  }
  if (raw.startsWith("/")) {
    throw new Error(`路径不许是绝对路径：${raw}`);
  }
  if (/^[a-zA-Z]:/.test(raw)) {
    throw new Error(`路径不许带盘符：${raw}`);
  }

  const segments: string[] = [];
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      throw new Error(`路径不许含 \`..\`：${raw}`);
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    throw new Error(`路径归一化后为空：${raw}`);
  }
  const normalized = segments.join("/");
  // 归一化之后仍必须落在 snapshot/ 内——最后一道闸
  if (normalized !== SNAPSHOT_DIR && !normalized.startsWith(`${SNAPSHOT_DIR}/`)) {
    throw new Error(`路径必须位于 ${SNAPSHOT_DIR}/ 内：${raw}`);
  }
  return normalized;
}

/** 包内相对路径的 schema：过 `normalizeSnapshotPath`，归一化后的形态入 schema */
const SnapshotPathSchema = v.pipe(
  v.string(),
  v.transform((raw) => normalizeSnapshotPath(raw)),
);

export const BackupItemEntrySchema = v.object({
  path: SnapshotPathSchema,
  id: SafeSegmentSchema,
  type: v.string(),
  folder_id: v.nullable(SafeSegmentSchema),
  title: v.nullable(v.string()),
  tags: v.array(v.string()),
  memo_at: v.nullable(IntSchema),
  is_task: IntSchema,
  task_status: v.nullable(v.string()),
  task_due: v.nullable(v.string()),
  task_priority: v.nullable(v.string()),
  pinned: IntSchema,
  starred: IntSchema,
  enc_self: IntSchema,
  in_enc_space: IntSchema,
  /** 服务端认这个正文的凭据；导入时用它核对，不一致要报出来而不是悄悄覆盖 */
  content_hash: Sha256Schema,
  size_bytes: v.pipe(IntSchema, v.minValue(0)),
  rev: IntSchema,
  created_at: IntSchema,
  updated_at: IntSchema,
  /** 回收站条目照常导出（用户 2026-10-01 确认）：误删后能从备份找回 */
  deleted_at: v.nullable(IntSchema),
});
export type BackupItemEntry = v.InferOutput<typeof BackupItemEntrySchema>;

export const BackupAttachmentEntrySchema = v.object({
  path: SnapshotPathSchema,
  sha256: Sha256Schema,
  size_bytes: v.pipe(IntSchema, v.minValue(0)),
});
export type BackupAttachmentEntry = v.InferOutput<typeof BackupAttachmentEntrySchema>;

export const BackupManifestSchema = v.object({
  format: v.literal(BACKUP_FORMAT),
  version: v.pipe(IntSchema, v.minValue(1)),
  /** 产出这个包的 app 版本，便于将来判断"这份备份是哪个版本导出的" */
  app_version: v.string(),
  /** 导出时刻（UTC ISO） */
  exported_at: IsoDateTimeSchema,
  items: v.array(BackupItemEntrySchema),
  attachments: v.array(BackupAttachmentEntrySchema),
  /** 是否含回收站条目；本次导出的选择，导入时可据此提示 */
  include_trashed: v.boolean(),
  /** 是否含历史版本；首期默认 false（用户 2026-10-01 确认：版本是 2000 条上限的大头） */
  include_versions: v.boolean(),
});
export type BackupManifest = v.InferOutput<typeof BackupManifestSchema>;

/**
 * `COMPLETE` 的内容：一行格式标识、一行 manifest 的 sha256。
 *
 * 刻意做成**纯文本**、且放在被校验文件**之外**——提交标记如果自己也要被谁保护，
 * 就成了循环。
 */
export function renderComplete(version: number, manifestSha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(manifestSha256)) {
    throw new Error(`manifest 的 sha256 不合法：${manifestSha256}`);
  }
  return `${BACKUP_FORMAT} v${version}\nmanifest-sha256 ${manifestSha256}\n`;
}

/** 解析 `COMPLETE`；不认识就返回 `null`（调用方据此判"这不是我们的备份"） */
export function parseComplete(text: string): { version: number; manifestSha256: string } | null {
  const match = new RegExp(
    `^${BACKUP_FORMAT} v(\\d+)\\r?\\nmanifest-sha256 ([0-9a-f]{64})\\r?\\n?$`,
  ).exec(text);
  if (!match?.[1] || !match[2]) return null;
  return { version: Number(match[1]), manifestSha256: match[2] };
}

/**
 * 整包校验：`COMPLETE` 认得吗 → 版本不比程序新吧 → manifest 解析得过吗 → 哈希对得上吗。
 *
 * **哈希算的是读到的原始字节**，不是把 JSON 重新序列化一遍——换行或缩进的差异
 * 会让"重新序列化再算"假失败（实施计划 §三-1）。
 *
 * 任何一步不过都抛错：半截包当完整包恢复，比恢复失败糟糕得多。
 */
export async function verifySnapshot(input: {
  completeText: string;
  manifestText: string;
}): Promise<BackupManifest> {
  const complete = parseComplete(input.completeText);
  if (!complete) {
    throw new Error("缺少可识别的 COMPLETE 标记，这个包不是完整的备份快照");
  }
  if (complete.version > BACKUP_VERSION) {
    throw new Error(
      `备份版本 v${complete.version} 比当前程序（v${BACKUP_VERSION}）新，请先升级 Menote`,
    );
  }

  const actual = await sha256Hex(new TextEncoder().encode(input.manifestText));
  if (actual !== complete.manifestSha256) {
    throw new Error("manifest 校验不通过：这个备份包不完整（哈希对不上），已拒收");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(input.manifestText);
  } catch {
    throw new Error("manifest 不是合法 JSON，已拒收");
  }
  const parsed = v.safeParse(BackupManifestSchema, raw);
  if (!parsed.success) {
    throw new Error(`manifest 结构不合法：${parsed.issues[0]?.message ?? "未知原因"}`);
  }
  /*
    上面那道版本检查读的是 `COMPLETE` 里的版本——但**标记是可以被单独改过的**，
    所以 manifest 自己的 `version` 必须再查一遍：一份声称 `version: 99` 的包哪怕
    标记写 v1，也不能按 v1 的规则去读那些我们不认识的字段。
    两处版本号不一致同样说明包被动过手，直接拒收。
  */
  if (parsed.output.version > BACKUP_VERSION) {
    throw new Error(
      `manifest 声称的版本 v${parsed.output.version} 比当前程序（v${BACKUP_VERSION}）新，请先升级 Menote`,
    );
  }
  if (parsed.output.version !== complete.version) {
    throw new Error(
      `manifest 版本（v${parsed.output.version}）与 COMPLETE 标记（v${complete.version}）不一致，这个包被动过`,
    );
  }
  return parsed.output;
}

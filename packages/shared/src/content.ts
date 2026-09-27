/**
 * 内容完整性的上限与默认值（M4；《M4 设计》§八【本文定稿】）。
 *
 * **放共享包**是因为这些值两端都要用，而且必须一致：
 * - 客户端要按它们**校验与压缩**（缩略图最长边、目标体积、附件大小）；
 * - 服务端要按它们**复核与裁剪**（DB CHECK、版本条数、保留期、每批删除量）；
 * - 设置页要按它们**给出可选范围**（版本条数 20–500）。
 *
 * 服务端**不信任**客户端传来的尺寸与体积，但两边算的是同一套阈值——不一致会导致"客户端说行、
 * 服务端说不行"这种最难查的问题，所以只有这一处。
 */
import * as v from "valibot";

/** 单附件硬上限（与 `attachments.size_bytes` 的 CHECK 一致） */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** 缩略图最长边（浏览器端生成，WebP） */
export const THUMBNAIL_MAX_EDGE = 400;

/**
 * 缩略图目标体积：超了就**降质量**再编码，**不拒绝上传**（设计 §八）。
 * 真压不下去也照传——宁可大一点，也不要让用户"传不上去"。
 */
export const THUMBNAIL_TARGET_BYTES = 40 * 1024;

/** 每条笔记保留的版本数：默认值 + **可选范围**（契约校验与设置页同源，不再各写一份） */
export const VERSIONS_DEFAULT = 100;
export const VERSIONS_KEEP_MIN = 20;
export const VERSIONS_KEEP_MAX = 500;

/** 版本正文超过这个体积就用 `codec='none'`（不再 gzip——大文件再压收益低、耗 CPU） */
export const VERSION_GZIP_MAX_BYTES = 256 * 1024;

/** 回收站保留天数（默认，设置可改） */
export const TRASH_RETENTION_DAYS_DEFAULT = 30;

/** 附件被标为孤儿后保留多少天再删（设计 §八） */
export const ATTACHMENT_ORPHAN_RETENTION_DAYS = 30;

/** 上传登记的有效期：超过它还没落元数据，就视为孤儿（设计 §六 表 6） */
export const PENDING_UPLOAD_TTL_HOURS = 24;

/** 墓碑保留天数：到期清理并推进 `users.tombstone_floor`（架构 §12.3） */
export const TOMBSTONE_RETENTION_DAYS = 180;

/** 永久删除每批条数（客户端；单请求 ≤45 语句的约束下取 10） */
export const PERMANENT_DELETE_BATCH = 10;

/** 每日维护里 R2 GC 与快照队列的单轮配额（架构 §12.1 的任务顺序与配额） */
export const JOB_R2_GC_BATCH = 20;
export const JOB_SWEEP_BATCH = 10;
export const JOB_IDLE_SEAL_BATCH = 3;

/** 天 → 毫秒（各处保留期都用它换算，避免各写一遍 `* 24 * 60 * 60 * 1000`） */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** 附件的三种客户端请求形状（M4-4；服务端与客户端共用同一份校验） */

/** `POST /api/attachments/check`：客户端算出哈希与大小后先问一句"传过没有" */
export const AttachmentCheckSchema = v.object({
  sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/i)),
  size: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_ATTACHMENT_BYTES)),
  /** 缺省 = 原图 */
  kind: v.optional(v.picklist(["original", "thumb"])),
});
export type AttachmentCheck = v.InferOutput<typeof AttachmentCheckSchema>;

/** 缩略图那一行的元数据（浏览器端生成，设计 §3.3） */
export const AttachmentThumbSchema = v.object({
  size: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_ATTACHMENT_BYTES)),
  mime: v.nullable(v.string()),
  width: v.nullable(v.number()),
  height: v.nullable(v.number()),
});

/** `POST /api/attachments/finalize`：落元数据（原图 + 可选的缩略图 + 可选的条目引用） */
export const AttachmentFinalizeSchema = v.object({
  sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/i)),
  size: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_ATTACHMENT_BYTES)),
  mime: v.nullable(v.string()),
  width: v.nullable(v.number()),
  height: v.nullable(v.number()),
  filename: v.nullable(v.string()),
  thumb: v.optional(v.nullable(AttachmentThumbSchema)),
  /** 这次上传要挂到哪条条目上（引用由客户端显式上报） */
  itemId: v.optional(v.nullable(v.string())),
});
export type AttachmentFinalize = v.InferOutput<typeof AttachmentFinalizeSchema>;

/** 版本封存原因（设计 §4.1）；界面显示的中文映射见 `VERSION_REASON_LABELS` */
export const VersionReasonSchema = v.picklist([
  "autosave_idle",
  "session",
  "manual",
  "pre_restore",
  "pre_conflict",
  "pre_mcp",
  "pre_convert",
]);
export type VersionReason = v.InferOutput<typeof VersionReasonSchema>;

/**
 * 版本元数据（线上形状；M4-5 的服务端返回、M4-11 的界面消费）。
 *
 * 两端共用同一份定义——版本行的字段（原因、备注、保留、大小）在界面上一个不少，
 * 各写一份类型必然会漂移。
 */
export const VersionMetaSchema = v.object({
  id: v.string(),
  rev: v.number(),
  reason: v.string(),
  label: v.nullable(v.string()),
  /** 1 = 保留（不参与稀疏化） */
  keep: v.number(),
  codec: v.picklist(["gzip", "none"]),
  size_bytes: v.number(),
  content_hash: v.string(),
  title: v.nullable(v.string()),
  created_at: v.number(),
});
export type VersionMeta = v.InferOutput<typeof VersionMetaSchema>;

/**
 * 封存原因的**中文映射**（M4 界面稿 §4.3 定的原文，集中一处：界面与日志用同一份）。
 *
 * 界面**不允许**回落到英文原值（界面稿 §4.3 的硬要求），所以取不到时用 `versionReasonLabel()`
 * 给一个中性中文，而不是把 `pre_mcp` 这种内部字面量摆给用户看。
 */
export const VERSION_REASON_LABELS: Readonly<Record<VersionReason, string>> = {
  autosave_idle: "停止编辑后自动保存",
  session: "新会话首次编辑",
  manual: "手动保存",
  pre_restore: "恢复前",
  pre_conflict: "冲突前",
  pre_mcp: "AI 修改前",
  pre_convert: "表格降级前",
};

/** 取中文原因；未知值（将来加了新 reason 而界面还没更新）给中性文案，**不回落到英文** */
export function versionReasonLabel(reason: string): string {
  return (VERSION_REASON_LABELS as Record<string, string | undefined>)[reason] ?? "其他改动";
}

/** `POST /api/items/:id/versions`：手动封存（备注可空） */
export const VersionSealSchema = v.object({
  label: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(200)))),
});
export type VersionSeal = v.InferOutput<typeof VersionSealSchema>;

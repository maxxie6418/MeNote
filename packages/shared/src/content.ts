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

/** 单附件硬上限（与 `attachments.size_bytes` 的 CHECK 一致） */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** 缩略图最长边（浏览器端生成，WebP） */
export const THUMBNAIL_MAX_EDGE = 400;

/**
 * 缩略图目标体积：超了就**降质量**再编码，**不拒绝上传**（设计 §八）。
 * 真压不下去也照传——宁可大一点，也不要让用户"传不上去"。
 */
export const THUMBNAIL_TARGET_BYTES = 40 * 1024;

/** 每条笔记保留的版本数：默认与可选范围（设置页据此渲染） */
export const VERSIONS_DEFAULT = 100;
export const VERSIONS_MIN = 20;
export const VERSIONS_MAX = 500;

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

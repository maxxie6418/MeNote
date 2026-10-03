/**
 * 快照物化（M7 第 4 项 批 2；架构 §12.4 / §7.3 / §7.4；设计 §二 第 1 步）。
 *
 * 把 D1 里的内容按 **`packages/shared/src/backup.ts` 的路径函数**写成 `snapshot/` 树，
 * 放进 R2 的 `snap/{uid}/`，**最后写 `COMPLETE` 提交标记**。
 *
 * ## 四条决定整份实现的取舍
 *
 * ### 1. 增量，不是每轮全量
 *
 * Cron 触发器是每 15 分钟一次（`wrangler.jsonc` 的 `triggers.crons`），一天 96 轮。
 * 全量重写的话，一个 500 条目的库就是**每天 4.8 万次 R2 写**，
 * 而且 99% 的轮次什么也没变。所以本轮只处理 **`sync_seq` 落在游标之后**的条目，
 * 游标记在 `user_snapshot_state`（迁移 0008）。**没东西变时一个字节都不写**——
 * 连 manifest 都不重写。
 *
 * ### 2. 出站加密：隐私条目套信封，普通条目明文
 *
 * 架构 §7.3 的信封格式是定稿，服务端造得出来（K 包裹块从库里那份 `k_wrapped_pw`
 * 逐字节取，理由见 `services/backup-envelope.ts`）。
 *
 * **注意 M5 与这里的差别**：M5 的浏览器导出是「密文原样搬运」，而服务端本来就存明文，
 * 所以那一步今天等于搬明文；这里是**真的要加密**（M16-02 定稿 / 设计 §五）。
 * 自动备份与手动导出的隐私口径因此**不一样**，这是定稿要求的，不是本轮的发明。
 *
 * ### 3. 附件字节本轮**不进**快照树
 *
 * 附件按内容哈希存在**同一个桶**里（架构 §5.2：没有 `enc/` 子目录，一律明文）。
 * 再往 `snap/` 里复制一份 = **存储翻倍、收益为零**。所以本轮的 manifest 里
 * `attachments` 是**空数组**——**清单不声称自己没有存的东西**。
 * 附件字节由批 3 在推送时按需直拷，届时再把条目补进清单。
 *
 * （这与 M5 的 zip 导出不同：zip 是要交给用户、能单独解压的，所以必须自带附件。
 * 服务端快照不是给人直接解压的，它是推给远端的中转物。）
 *
 * ### 4. `content_hash` / `size_bytes` 记的是**明文正文**，不是写出去的那个文件
 *
 * 隐私条目写出去的是信封（103 字节固定开销），库里 `items.content_hash` 记的却是明文
 * 正文的哈希。这里**照旧记明文**：清单里的哈希标识的是"这段内容是什么"，不是
 * "这批字节怎么存"（M5 的 zip 导出也是这个口径）。配套的前提是**恢复端要先把信封解开**
 * ——解开后拿到的正是明文，哈希自然对得上。**那条恢复链本轮没做**，批 4 之后补；
 * 补之前这份快照里的隐私条目不能直接当正文用。
 */
import {
  BACKUP_ENCRYPT_QUOTA_BYTES,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  JOB_SNAPSHOT_BATCH,
  completePath,
  foldersPath,
  manifestPath,
  notePath,
  renderComplete,
  sha256Hex,
  type BackupItemEntry,
  type BackupManifest,
} from "@menote/shared";
import { loadOutgoingKeyMaterial, needsOutgoingEnvelope, sealOutgoingBody } from "../services/backup-envelope";
import { WORKER_APP_VERSION } from "../version";
import type { EnvBindings } from "../types";

/** 快照在桶里的前缀。**不与附件键撞**：附件键是内容哈希，`snap/` 这段前缀只有这里写 */
export const SNAP_PREFIX = "snap";

/** 内容 IV 长度（架构 §7.3 偏移 87，12 字节） */
const CONTENT_IV_BYTES = 12;

export interface SnapshotEnv {
  DB: D1Database;
  ATTACHMENTS?: R2Bucket;
  AUTH_PEPPER?: string;
}

export interface SnapshotOutcome {
  /** 跳过的原因；`undefined` = 正常跑完 */
  skipped?: string;
  /** 本轮写进 R2 的文件数（不含 manifest / COMPLETE） */
  files: number;
  items: number;
  /** 套了信封的隐私条目数 */
  encrypted: number;
  /** 因单轮加密配额而**留到下一轮**的隐私条目数 */
  deferred: number;
  /** 推进到的游标（不越过任何被推迟的条目） */
  cursorSeq: number;
}

interface ItemRow {
  id: string;
  type: string;
  folder_id: string | null;
  title: string | null;
  tags: string;
  memo_at: number | null;
  is_task: number;
  task_status: string | null;
  task_due: string | null;
  task_priority: string | null;
  pinned: number;
  starred: number;
  enc_self: number;
  in_enc_space: number;
  content_hash: string;
  rev: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  sync_seq: number;
  body: string | null;
}

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  depth: number;
  in_enc_space: number;
  is_enc_space: number;
  sync_seq: number;
}

const encoder = new TextEncoder();

async function readCursor(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT cursor_seq FROM user_snapshot_state WHERE user_id = ?")
    .bind(userId)
    .first<{ cursor_seq: number }>();
  return row?.cursor_seq ?? 0;
}

async function writeCursor(db: D1Database, userId: string, cursor: number, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_snapshot_state (user_id, cursor_seq, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET cursor_seq = excluded.cursor_seq, updated_at = excluded.updated_at`,
    )
    .bind(userId, cursor, now)
    .run();
}

/**
 * 物化一轮。
 *
 * 两条**各自独立**的配额：文件数 `quota` 管 R2 写入量（架构 §12.1 定的 10 个/轮），
 * 加密字节 `BACKUP_ENCRYPT_QUOTA_BYTES` 管 CPU（10 ms 限额，M7 性能校准取的 2 MB 下界）。
 *
 * 撞到加密配额时**不整轮放弃**：普通条目照写，撞上配额的那条隐私条目留到下一轮，
 * **游标停在它之前**——推过它就等于永远不再物化它。
 */
export async function materializeSnapshot(
  env: SnapshotEnv,
  userId: string,
  now: number,
  quota: number = JOB_SNAPSHOT_BATCH,
): Promise<SnapshotOutcome> {
  const cursor = await readCursor(env.DB, userId);
  if (!env.ATTACHMENTS) {
    // 没绑对象存储就**如实说跳过**，不假装跑过（`services/jobs.ts` 的既有口径）
    return { skipped: "未绑定对象存储（ATTACHMENTS），快照无处可放", files: 0, items: 0, encrypted: 0, deferred: 0, cursorSeq: cursor };
  }
  const bucket = env.ATTACHMENTS;

  const items = await env.DB.prepare(
    `SELECT i.id, i.type, i.folder_id, i.title, i.tags, i.memo_at, i.is_task, i.task_status,
            i.task_due, i.task_priority, i.pinned, i.starred, i.enc_self, i.in_enc_space,
            i.content_hash, i.rev, i.created_at, i.updated_at, i.deleted_at, i.sync_seq, b.body
       FROM items i
       LEFT JOIN item_bodies b ON b.item_id = i.id
      WHERE i.user_id = ? AND i.sync_seq > ?
      ORDER BY i.sync_seq ASC
      LIMIT ?`,
  )
    .bind(userId, cursor, quota)
    .all<ItemRow>();
  const rows = items.results ?? [];

  const folders = await env.DB.prepare(
    `SELECT id, parent_id, name, depth, in_enc_space, is_enc_space, sync_seq
       FROM folders WHERE user_id = ? AND sync_seq > ? ORDER BY sync_seq ASC LIMIT ?`,
  )
    .bind(userId, cursor, quota)
    .all<FolderRow>();
  const changedFolders = folders.results ?? [];

  // 什么都没变：**一个字节都不写**（重写 manifest 就得重扫全量条目，不值当）
  if (rows.length === 0 && changedFolders.length === 0) {
    return { files: 0, items: 0, encrypted: 0, deferred: 0, cursorSeq: cursor };
  }

  // 密钥材料：**有隐私条目才解 K**。没有 `user_crypto` 行却有隐私条目 = 数据不一致，
  // 那时宁可明文推出去并把话说清楚，也不要静默丢内容、也不要整轮崩掉。
  const hasPrivate = rows.some((row) => needsOutgoingEnvelope(row.enc_self, row.in_enc_space));
  const material = hasPrivate ? await loadOutgoingKeyMaterial(env as EnvBindings, env.DB, userId) : null;
  if (hasPrivate && material === null) {
    console.error("snapshot: 存在隐私条目但没有门禁材料，本轮按明文出站", userId);
  }

  let encrypted = 0;
  let deferred = 0;
  let encryptBytes = 0;
  let files = 0;
  // 游标上限：撞上加密配额后就不许再往前推
  let cursorLimit = Number.POSITIVE_INFINITY;

  for (const row of rows) {
    const body = row.body ?? "";
    const path = notePath(row.id);
    let bytes: Uint8Array;

    if (needsOutgoingEnvelope(row.enc_self, row.in_enc_space) && material !== null) {
      const plain = encoder.encode(body);
      if (encryptBytes + plain.byteLength > BACKUP_ENCRYPT_QUOTA_BYTES) {
        // 撞 CPU 余量：这条留到下一轮，**游标不许越过它**
        deferred += 1;
        cursorLimit = Math.min(cursorLimit, row.sync_seq - 1);
        continue;
      }
      // 内容 IV 每次现生成——它是逐文件的随机量（架构 §7.3 偏移 87）
      const iv = crypto.getRandomValues(new Uint8Array(CONTENT_IV_BYTES));
      bytes = await sealOutgoingBody(material, plain, iv);
      encryptBytes += plain.byteLength;
      encrypted += 1;
    } else {
      bytes = encoder.encode(body);
    }

    await bucket.put(`${SNAP_PREFIX}/${userId}/${path}`, bytes);
    files += 1;
  }

  // 文件夹树：**整棵重写**（它很小，重写的代价低于"只写变了的"带来的不一致风险）
  if (changedFolders.length > 0) {
    const all = await env.DB.prepare(
      `SELECT id, parent_id, name, depth, in_enc_space, is_enc_space, sync_seq
         FROM folders WHERE user_id = ? ORDER BY depth ASC`,
    )
      .bind(userId)
      .all<FolderRow>();
    await bucket.put(
      `${SNAP_PREFIX}/${userId}/${foldersPath()}`,
      encoder.encode(JSON.stringify(stripSyncSeq(all.results ?? []), null, 2)),
    );
    files += 1;
  }

  // 游标：条目与文件夹共用一个数字（两者都取自同一个全局 `sync_seq` 计数器），
  // 所以取**两边都处理过的最大值**，再被加密配额的上限压住
  const itemMax = rows.reduce((max, row) => Math.max(max, row.sync_seq), cursor);
  const folderMax = changedFolders.reduce((max, row) => Math.max(max, row.sync_seq), cursor);
  const nextCursor = Math.min(Math.max(itemMax, folderMax), cursorLimit);

  // manifest → COMPLETE。**顺序不能反**：标记先到会让半个快照看起来是完整的
  const manifest = await buildManifest(env.DB, userId, now);
  const manifestText = JSON.stringify(manifest, null, 2);
  const manifestSha = await sha256Hex(encoder.encode(manifestText));
  await bucket.put(`${SNAP_PREFIX}/${userId}/${manifestPath()}`, encoder.encode(manifestText));
  await bucket.put(
    `${SNAP_PREFIX}/${userId}/${completePath()}`,
    encoder.encode(renderComplete(BACKUP_VERSION, manifestSha)),
  );

  await writeCursor(env.DB, userId, nextCursor, now);

  return { files, items: rows.length - deferred, encrypted, deferred, cursorSeq: nextCursor };
}

/**
 * 重建 manifest（**全量**，不是本轮那几条）。
 *
 * 它是快照的索引，推送侧（批 3）与整包校验都靠它——一份只列了本轮那几条的清单没有意义。
 * 附件恒为空数组，理由见文件头第 3 条。
 */
async function buildManifest(db: D1Database, userId: string, now: number): Promise<BackupManifest> {
  const rows = await db
    .prepare(
      `SELECT i.id, i.type, i.folder_id, i.title, i.tags, i.memo_at, i.is_task, i.task_status,
              i.task_due, i.task_priority, i.pinned, i.starred, i.enc_self, i.in_enc_space,
              i.content_hash, i.rev, i.created_at, i.updated_at, i.deleted_at, i.sync_seq, b.body
         FROM items i
         LEFT JOIN item_bodies b ON b.item_id = i.id
        WHERE i.user_id = ?
        ORDER BY i.created_at ASC`,
    )
    .bind(userId)
    .all<ItemRow>();

  const items: BackupItemEntry[] = (rows.results ?? []).map((row) => toItemEntry(row));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app_version: WORKER_APP_VERSION,
    exported_at: new Date(now).toISOString(),
    items,
    // 附件字节不在本快照里（文件头第 3 条）——**不声称自己没有的东西**
    attachments: [],
    // 自动备份固定含回收站：误删的条目要能从备份里找回（M5 用户 2026-10-01 确认的口径）
    include_trashed: true,
    include_versions: false,
  };
}

/** D1 一行 → manifest 的一条（字段与 `BackupItemEntrySchema` 逐一对应） */
function toItemEntry(row: ItemRow): BackupItemEntry {
  return {
    path: notePath(row.id),
    id: row.id,
    type: row.type,
    folder_id: row.folder_id,
    title: row.title,
    tags: parseTags(row.tags),
    memo_at: row.memo_at,
    is_task: row.is_task,
    task_status: row.task_status,
    task_due: row.task_due,
    task_priority: row.task_priority,
    pinned: row.pinned,
    starred: row.starred,
    enc_self: row.enc_self,
    in_enc_space: row.in_enc_space,
    content_hash: row.content_hash,
    size_bytes: byteLength(row.body ?? ""),
    rev: row.rev,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

/** `tags` 在库里是 JSON 文本；**读坏了就当空数组**，不让一行脏数据毁掉整次备份 */
function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

/** 文件夹 JSON 的形状要与浏览器侧导出**逐字段一致**（`features/backup/import.ts` 按它建夹） */
function stripSyncSeq(rows: readonly FolderRow[]): Array<Omit<FolderRow, "sync_seq">> {
  return rows.map(({ id, parent_id, name, depth, in_enc_space, is_enc_space }) => ({
    id,
    parent_id,
    name,
    depth,
    in_enc_space,
    is_enc_space,
  }));
}

function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

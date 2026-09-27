/**
 * 回收站的业务模型（M4-12；《M4 界面稿》§6）。
 *
 * 三件事：**列表怎么呈现**（剩余天数、加密空间占位标题）、**永久删除怎么分批**
 * （每批 10 条、失败跳过并可重试、进度可见）、**操作后的提示文案**（成功/警告、撤销即恢复）。
 * 全是纯函数或纯编排，所以界面与用例都薄。
 */
import { PERMANENT_DELETE_BATCH, TRASH_RETENTION_DAYS_DEFAULT, DAY_MS } from "@menote/shared";
import { isMemoVisible, isSpaceUnlocked, type PrivacyGate } from "@menote/shared";
import type { LocalFolder, LocalItem } from "../../data/db";

/** 回收站里的一行 */
export interface TrashRowModel {
  id: string;
  /**
   * 行是什么：`item`（笔记 / 表格 / Memo）还是 `folder`。
   *
   * **为什么要区分**：界面稿 §6.5 写明"加密空间内条目（**或其文件夹**）在回收站里"，
   * 所以文件夹也要出现在这张列表里；而两者的 `type` 语义、图标与不可用的操作都不同。
   */
  kind: "item" | "folder";
  type: LocalItem["type"] | "folder";
  /** 显示用标题：加密空间条目在锁定时是占位文字（不泄露真实标题） */
  title: string;
  /** 标题是否被占位（界面据此加锁图标） */
  titleHidden: boolean;
  /** 在加密空间里（解锁期间显示"加密空间"标注） */
  inEncSpace: boolean;
  /** 单篇加密标记（明文标题 + 锁图标 + "已加密"，沿用 `ItemRow` 口径） */
  encSelf: boolean;
  /** 删除时刻 */
  deletedAt: number;
  /** 剩余保留天数（实时计数，必须可见） */
  remainingDays: number;
  /** ≤3 天：走警告色**并加"即将永久删除"文字**（颜色不单独表意） */
  urgent: boolean;
  /**
   * 能否**永久删除**这一行。
   *
   * 条目与文件夹都可以（文件夹的永久删除在 2026-09-27 按用户拍板补上：服务端删 `folders` 行
   * 并写 `entity='folder'` 墓碑）。保留这个字段是因为**不同行确实可能不可删**
   * （例如以后要加"还在被引用的空间"之类），界面据此置灰并写明原因。
   */
  purgeable: boolean;
}

/** 保留期换算：`deleted_at + 保留天数 × 一天` */
export function remainingDays(deletedAt: number, now: number, retentionDays = TRASH_RETENTION_DAYS_DEFAULT): number {
  const deadline = deletedAt + retentionDays * DAY_MS;
  const remain = Math.ceil((deadline - now) / DAY_MS);
  return Math.max(0, remain);
}

/** 剩余天数 ≤3 就提醒（与界面稿 §6.1 第 2 块一致） */
export const URGENT_REMAINING_DAYS = 3;

/**
 * 这一行在回收站里要不要**藏标题**。
 *
 * 注意不能直接用 `canShowInList`：那个函数把"已删除"本身就判为不可见，
 * 而回收站看到的全是已删除条目——照搬会把每一行的标题都变成占位。
 * 这里问的是"**如果它没被删**，此刻的隐私门禁会不会挡住它"，规则与列表一致：
 * 空间内条目看隐私锁、Memo 看范围设置；**单篇加密的明文标题任何状态都照常显示**
 * （《隐私锁设计》§9.2-③）。
 */
function titleHiddenByGate(item: LocalItem, gate: PrivacyGate): boolean {
  if (gate.lockState === "disabled") return false;
  if (item.type === "memo") return !isMemoVisible(gate);
  if (item.in_enc_space === 1) return !isSpaceUnlocked(gate);
  return false;
}

export function trashRow(
  item: LocalItem,
  now: number,
  gate: PrivacyGate,
  retentionDays = TRASH_RETENTION_DAYS_DEFAULT,
): TrashRowModel {
  const inEncSpace = item.in_enc_space === 1;
  const locked = titleHiddenByGate(item, gate);
  const deletedAt = item.deleted_at ?? 0;
  const remain = remainingDays(deletedAt, now, retentionDays);

  return {
    id: item.id,
    kind: "item",
    type: item.type,
    // 锁定态**不显示真实标题**；解锁期间显示真实标题并带"加密空间"标注
    title: locked ? "加密空间内条目" : (item.title ?? "（无标题）"),
    titleHidden: locked,
    inEncSpace,
    encSelf: item.enc_self === 1,
    deletedAt,
    remainingDays: remain,
    urgent: remain <= URGENT_REMAINING_DAYS,
    purgeable: true,
  };
}

/**
 * 文件夹行（界面稿 §6.5 要求文件夹也出现在回收站）。
 *
 * 与条目行的两点不同：①**标题就是文件夹名**（文件夹名按明文存储，没有单篇加密这回事）；
 * ②在加密空间里的文件夹按隐私锁口径藏名字（与条目一致）。
 */
export function trashFolderRow(
  folder: LocalFolder,
  now: number,
  gate: PrivacyGate,
  retentionDays = TRASH_RETENTION_DAYS_DEFAULT,
): TrashRowModel {
  const inEncSpace = folder.in_enc_space === 1 || folder.is_enc_space === 1;
  const locked = gate.lockState !== "disabled" && inEncSpace && !isSpaceUnlocked(gate);
  const deletedAt = folder.deleted_at ?? 0;
  const remain = remainingDays(deletedAt, now, retentionDays);

  return {
    id: folder.id,
    kind: "folder",
    type: "folder",
    title: locked ? "加密空间内文件夹" : folder.name,
    titleHidden: locked,
    inEncSpace,
    encSelf: false,
    deletedAt,
    remainingDays: remain,
    urgent: remain <= URGENT_REMAINING_DAYS,
    // 文件夹也可以永久删除（服务端自 2026-09-27 起支持：删 `folders` 行 + `entity='folder'` 墓碑）
    purgeable: true,
  };
}

/** 回收站列表：**条目 + 文件夹**，按删除时间倒序（刚删的在上面） */
export function trashRows(
  items: readonly LocalItem[],
  now: number,
  gate: PrivacyGate,
  retentionDays = TRASH_RETENTION_DAYS_DEFAULT,
  folders: readonly LocalFolder[] = [],
): TrashRowModel[] {
  const itemRows = items
    .filter((item) => item.deleted_at !== null)
    .map((item) => trashRow(item, now, gate, retentionDays));
  const folderRows = folders
    .filter((folder) => folder.deleted_at !== null)
    .map((folder) => trashFolderRow(folder, now, gate, retentionDays));

  return [...itemRows, ...folderRows].sort((left, right) => right.deletedAt - left.deletedAt);
}

// ——————————————————————————— 永久删除的分批编排 ———————————————————————————

export interface PurgeFailure {
  id: string;
  reason: string;
}

export interface PurgeProgress {
  done: number;
  total: number;
  /** 界面直接用的进度文案（"正在删除 10 / 24"） */
  label: string;
}

export interface PurgeResult {
  done: number;
  failures: PurgeFailure[];
}

/** 按每批 10 条切分（设计 §5.2：单请求 ≤45 语句倒推出来的上限） */
export function chunkIds(ids: readonly string[], size = PERMANENT_DELETE_BATCH): string[][] {
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    batches.push(ids.slice(index, index + size));
  }
  return batches;
}

export function progressLabel(done: number, total: number): string {
  return `正在删除 ${done} / ${total}`;
}

/**
 * 分请求永久删除。
 *
 * **单批失败不清空已完成的部分**：失败的 id 进 `failures`（界面把它们留在列表里并给「重试」）。
 * 这与 M3 的批量标记同一口径——"一部分成功"是正常结果，不是异常。
 */
export async function runPurge(
  ids: readonly string[],
  purge: (batch: readonly string[]) => Promise<void>,
  onProgress?: (progress: PurgeProgress) => void,
): Promise<PurgeResult> {
  const batches = chunkIds(ids);
  const failures: PurgeFailure[] = [];
  let done = 0;

  for (const batch of batches) {
    try {
      await purge(batch);
      done += batch.length;
    } catch (error) {
      failures.push(
        ...batch.map((id) => ({
          id,
          reason: error instanceof Error ? error.message : "删除失败",
        })),
      );
    }
    onProgress?.({ done, total: ids.length, label: progressLabel(done, ids.length) });
  }

  return { done, failures };
}

/** 清空回收站也要分批推进（条目可能很多），返回进度与失败清单 */
export function runEmpty(
  ids: readonly string[],
  purge: (batch: readonly string[]) => Promise<void>,
  onProgress?: (progress: PurgeProgress) => void,
): Promise<PurgeResult> {
  return runPurge(ids, purge, onProgress);
}

// ——————————————————————————— 文案 ———————————————————————————

/**
 * 删除成功后的提示：**必须带撤销**（撤销即恢复）。
 *
 * 界面稿 §6.6 还要求补一句"相关分享会立即失效"——分享在 M5，这里把文案位置留好。
 */
export function deleteNotice(title: string): string {
  return `「${title}」已移入回收站，30 天内可恢复`;
}

/** 恢复后的提示：原文件夹没了会被挪到根目录，这里如实说明（功能拆解 M03-05 / Q12） */
export function restoreNotice(movedToRoot: boolean): string {
  return movedToRoot ? "已恢复到根目录（原文件夹已不存在）" : "已恢复到原位置";
}

/**
 * 永久删除确认框的正文（界面稿 §6.3：范围写全，且**不承诺快照文件**）。
 *
 * 逐字写了三条：条目本身、全部版本、不再被引用的附件；最后一句明确"快照中的文件不在本次
 * 操作范围内"——**不能**写"快照也会删除"（那是不实承诺，设计 §十-4）。
 */
export function purgeConfirmText(count: number): { title: string; body: string } {
  const scope = count === 1 ? "这条内容" : `这 ${count} 条内容`;
  return {
    title: count === 1 ? "永久删除" : `永久删除 ${count} 条`,
    body: `${scope}及其全部版本将被永久删除，不再被引用的附件也会随后清理。快照中的文件不在本次操作范围内。此操作不可撤销。`,
  };
}

/** 清空回收站的确认文案（N 是实时计数） */
export function emptyConfirmText(count: number): { title: string; body: string } {
  return {
    title: "清空回收站",
    body: `回收站中的 ${count} 条内容及其全部版本将被永久删除，不可撤销。`,
  };
}

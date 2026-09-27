/**
 * 版本历史的业务模型（M4-11；《M4 界面稿》§四）。
 *
 * 界面只做展示与交互：**行的文案**（时间 / 中文原因 / 大小 / 备注 / 保留标记）、
 * **简易行级 diff**、**恢复确认框的三段文案**都在这里（纯函数，可单测）。
 */
import {
  VERSION_REASON_LABELS,
  versionReasonLabel,
  type VersionMeta,
} from "@menote/shared";

/** 一行版本的展示模型 */
export interface VersionRowModel {
  id: string;
  /** `2026-09-27 12:03`（`--mono` 显示） */
  timeLabel: string;
  /** 中文原因（**不回落英文**） */
  reasonLabel: string;
  /** `12.3 KB` */
  sizeLabel: string;
  label: string | null;
  keep: boolean;
  rev: number;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 时间：今年的省掉年份（版本列表按时间读，多一年反而更长） */
export function versionTimeLabel(createdAt: number, now: number = Date.now()): string {
  const date = new Date(createdAt);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return sameYear ? `${day} ${time}` : `${date.getFullYear()}-${day} ${time}`;
}

export function versionSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(2)} MB`;
}

/** 版本列表 → 展示行（顺序即服务端给的"新的在前"） */
export function versionRows(
  versions: readonly VersionMeta[],
  now: number = Date.now(),
): VersionRowModel[] {
  return versions.map((version) => ({
    id: version.id,
    timeLabel: versionTimeLabel(version.created_at, now),
    reasonLabel: versionReasonLabel(version.reason),
    sizeLabel: versionSizeLabel(version.size_bytes),
    label: version.label,
    keep: version.keep === 1,
    rev: version.rev,
  }));
}

/** 原因映射表也在这里再导出一次，界面不必同时 import 两个包 */
export { VERSION_REASON_LABELS };

// ——————————————————————————— 简易行级 diff ———————————————————————————

export type DiffKind = "same" | "add" | "remove";

export interface DiffLine {
  kind: DiffKind;
  text: string;
  /** 行号（左右各自的；`add` 只有右、`remove` 只有左） */
  leftNumber?: number;
  rightNumber?: number;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
}

/**
 * 行级 diff：**最长公共子序列**（LCS）标准做法。
 *
 * 为什么不上字符级/词级 diff：版本对比的用途是"我改了哪几段"，行级已经够用，
 * 而且**结果稳定**（同样的输入永远同样的输出，便于用例断言与用户建立预期）。
 * 大文本（几千行）时用 O(n·m) 的表会吃内存，所以超过阈值退化成"整块替换"——
 * 宁可粗一点，也不要在浏览器里卡住。
 */
export const DIFF_MAX_LINES = 2000;

export function lineDiff(left: string, right: string): DiffResult {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");

  if (leftLines.length > DIFF_MAX_LINES || rightLines.length > DIFF_MAX_LINES) {
    const lines: DiffLine[] = [
      ...leftLines.map((text, index) => ({ kind: "remove" as const, text, leftNumber: index + 1 })),
      ...rightLines.map((text, index) => ({ kind: "add" as const, text, rightNumber: index + 1 })),
    ];
    return { lines, added: rightLines.length, removed: leftLines.length };
  }

  // LCS 长度表（行数已在阈值内，O(n·m) 可接受）
  const table: number[][] = Array.from({ length: leftLines.length + 1 }, () =>
    new Array<number>(rightLines.length + 1).fill(0),
  );
  for (let i = leftLines.length - 1; i >= 0; i -= 1) {
    for (let j = rightLines.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        leftLines[i] === rightLines[j]
          ? (table[i + 1]![j + 1] ?? 0) + 1
          : Math.max(table[i + 1]![j] ?? 0, table[i]![j + 1] ?? 0);
    }
  }

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < leftLines.length && j < rightLines.length) {
    if (leftLines[i] === rightLines[j]) {
      lines.push({ kind: "same", text: leftLines[i] ?? "", leftNumber: i + 1, rightNumber: j + 1 });
      i += 1;
      j += 1;
    } else if ((table[i + 1]![j] ?? 0) >= (table[i]![j + 1] ?? 0)) {
      // 先出"删除"：读起来像"这段被换掉了"，比先出新增更符合直觉
      lines.push({ kind: "remove", text: leftLines[i] ?? "", leftNumber: i + 1 });
      removed += 1;
      i += 1;
    } else {
      lines.push({ kind: "add", text: rightLines[j] ?? "", rightNumber: j + 1 });
      added += 1;
      j += 1;
    }
  }
  while (i < leftLines.length) {
    lines.push({ kind: "remove", text: leftLines[i] ?? "", leftNumber: i + 1 });
    removed += 1;
    i += 1;
  }
  while (j < rightLines.length) {
    lines.push({ kind: "add", text: rightLines[j] ?? "", rightNumber: j + 1 });
    added += 1;
    j += 1;
  }

  return { lines, added, removed };
}

/** 增删的**文字前缀**：颜色不单独表意（界面稿 §4.1 第 4 块） */
export function diffPrefix(kind: DiffKind): string {
  return kind === "add" ? "+" : kind === "remove" ? "-" : " ";
}

export function diffSummary(result: DiffResult): string {
  if (result.added === 0 && result.removed === 0) return "两版内容一致";
  return `新增 ${result.added} 行 · 删除 ${result.removed} 行`;
}

// ——————————————————————————— 文案 ———————————————————————————

/**
 * 「恢复此版本」确认框的正文（界面稿 §4.5：三段必须写全）。
 *
 * ①影响对象 ②当前稿会先自动封存（**这句必须在确认框里可见**）③可恢复性 + 详情。
 * 三段缺一不可——只写"确定要恢复吗"正是界面稿点名不许的做法。
 */
export function restoreConfirmText(row: VersionRowModel): { title: string; body: string[] } {
  return {
    title: "恢复此版本",
    body: [
      `将用「${row.timeLabel} · ${row.reasonLabel}」这一版的内容覆盖当前稿。`,
      "当前稿会先自动封存为一个版本（原因「恢复前」，并标记为保留），所以这一步可以再撤回。",
      "版本表不动，历史不可变；恢复后当前稿的改动不会被丢弃，它已经变成一个版本。",
    ],
  };
}

/** 「存为版本」成功后的提示（界面稿 §4.4） */
export const SEAL_NOTICE = "已存为版本（默认永久保留）";
/** 恢复成功用**成功态**（不是警告态，界面稿 §4.5） */
export const RESTORE_NOTICE = "已恢复到此版本；恢复前的当前稿已封存为新版本";

export function keepNotice(keep: boolean): string {
  return keep ? "已标记为保留" : "已取消保留";
}

/** 恢复的**前置**：当前稿未保存的改动先普通保存一次（避免"恢复把未保存内容吃掉"） */
export const RESTORE_NEEDS_SAVE_HINT = "恢复前会先保存当前稿";

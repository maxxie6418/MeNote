/**
 * 回收站页的装配（M4-12；《M4 界面稿》§六）。
 *
 * 只做两件事：把 `useTrash` 的数据接到受控的 `TrashPage` 上，以及处理"返回设置"——
 * 按界面稿 §5.2 的边界，返回时**落回「版本与回收站」分类**，不回默认分类。
 */
import { useCallback } from "react";
import type { PrivacyGate } from "@menote/shared";
import { TrashPage } from "../features/trash/ui/TrashPage";
import { useTrash } from "../features/trash/useTrash";
import type { TrashNotice } from "../features/trash/useTrash";

export interface TrashSlotProps {
  gate: PrivacyGate;
  /** 回收站保留天数（来自用户设置：「版本与回收站」分类里可改） */
  retentionDays: number;
  onBackToSettings: () => void;
  onToast: (message: string, tone: TrashNotice["tone"] | "success" | "error" | "info") => void;
}

export function TrashSlot({ gate, retentionDays, onBackToSettings, onToast }: TrashSlotProps) {
  const notify = useCallback(
    (notice: TrashNotice) => onToast(notice.message, notice.tone),
    [onToast],
  );
  // 保留天数**传进去**：回收站页的剩余天数与页头口径都按用户设置算（默认 30）
  const trash = useTrash(gate, Date.now, notify, retentionDays);

  return (
    <TrashPage
      rows={trash.rows}
      selected={trash.selected}
      onToggleSelect={trash.toggleSelect}
      onSelectAll={trash.selectAll}
      onRestore={(ids) => void trash.restore(ids)}
      onPurge={(ids) => void trash.purge(ids)}
      onEmpty={() => void trash.empty()}
      progress={trash.progress}
      failures={trash.failures}
      onRetry={() => void trash.retry()}
      offline={trash.offline}
      retentionDays={trash.retentionDays}
      onBackToSettings={onBackToSettings}
    />
  );
}

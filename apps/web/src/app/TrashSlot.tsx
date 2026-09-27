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
  onBackToSettings: () => void;
  onToast: (message: string, tone: TrashNotice["tone"] | "success" | "error" | "info") => void;
}

export function TrashSlot({ gate, onBackToSettings, onToast }: TrashSlotProps) {
  const notify = useCallback(
    (notice: TrashNotice) => onToast(notice.message, notice.tone),
    [onToast],
  );
  const trash = useTrash(gate, Date.now, notify);

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
      onBackToSettings={onBackToSettings}
    />
  );
}

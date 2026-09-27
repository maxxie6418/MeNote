/**
 * 笔记区在组合根里的接线（M3-8 从 `App.tsx` 抽出，为入口文件的行数预算让位）。
 *
 * 这一层只做"把隐私锁状态与工作区数据接成 `NotesPane` 的 props"，并统一处理提示：
 * - **单篇加密**：加密 / 取消加密（失败时把服务端原因如实弹出来）；
 * - **移入 / 移出加密空间**：锁定时不给内部层级（`folders: []`），于是菜单里只剩"移入空间根"——
 *   这不是前端"偷偷限制"，而是锁定态下那些文件夹本来就不可见（设计 §6.3、走查第 15 行）。
 */
import type { NotesWorkspace } from "../features/notes/useNotesWorkspace";
import type { PrivacyGate, PrivacyLockState } from "@menote/shared";
import { isScopeGateOpen } from "@menote/shared";
import type { DocMode } from "../features/notes/ui/NoteWorkspace";
import { NotesPane } from "./workarea/NotesPane";

export interface NotesSlotProps {
  workspace: NotesWorkspace;
  editorMode: DocMode;
  privacy: {
    enabled: boolean;
    gate: PrivacyGate;
    lockState: PrivacyLockState;
    unlockedCount: number;
    onRequestUnlock: () => void;
    onLockItem: (itemId: string) => void;
    onLockAllItems: () => void;
  };
  onToast: (message: string, tone: "success" | "error") => void;
}

/** 把动作里的异常转成一句能读的提示（服务端 message 已经是中文可读文案） */
function toastError(onToast: NotesSlotProps["onToast"], fallback: string) {
  return (error: unknown): void => {
    onToast(error instanceof Error ? error.message : fallback, "error");
  };
}

export function NotesSlot({ workspace, editorMode, privacy, onToast }: NotesSlotProps) {
  const unlocked = isScopeGateOpen(privacy.gate);

  return (
    <NotesPane
      workspace={workspace}
      editorMode={editorMode}
      encryption={{
        enabled: privacy.enabled,
        gate: privacy.gate,
        unlockedCount: privacy.unlockedCount,
        onRequestUnlock: privacy.onRequestUnlock,
        onLockItem: privacy.onLockItem,
        onLockAllItems: privacy.onLockAllItems,
      }}
      onToggleEncryption={(itemId, next) => {
        void workspace
          .setItemEncryption(itemId, next)
          .then(() => onToast(next ? "已加密此篇" : "已取消加密", "success"))
          .catch(toastError(onToast, "操作失败，请稍后重试"));
      }}
      onToast={onToast}
      vault={{
        enabled: privacy.enabled,
        locked: !unlocked,
        id: workspace.vault.id,
        // 锁定时内部层级不可见 → 只留"移入空间根"
        folders: unlocked
          ? workspace.vault.folders.map((folder) => ({ id: folder.id, name: folder.name }))
          : [],
        onMoveIn: (itemId, folderId) => {
          void workspace
            .moveItemToVault(itemId, folderId)
            .then(() => onToast("已移入加密空间", "success"))
            .catch(toastError(onToast, "移入失败，请稍后重试"));
        },
        onMoveOut: (itemId) => {
          void workspace
            .moveItemOutOfVault(itemId, null)
            .then(() => onToast("已移出加密空间", "success"))
            .catch(toastError(onToast, "移出失败，请稍后重试"));
        },
      }}
    />
  );
}

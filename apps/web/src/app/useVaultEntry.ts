/**
 * 首页的「打开加密空间」入口（M7 首页重做）。
 *
 * ## 为什么要独立成一份 hook
 *
 * `App.tsx` 有 500 行硬上限（ESLint `max-lines`），而这段三态判定是首页独有的关注点，
 * 塞在 `App` 里既撑行数又让 `App` 变得难读。所以抽出来，**`App` 只剩一行调用**。
 *
 * ## 三态与功能栏那个贴底节点同口径
 *
 * 不发明第二套进入方式：
 *
 * | 隐私锁状态 | 点「打开加密空间」 |
 * |---|---|
 * | 没启用 | **不响应**（那颗入口已置灰，旁边有**可见**说明——`DESIGN.md` §6.1：禁用必须说明为何，触屏够不到 `title`） |
 * | 启用但锁定 | 开**同一套**解锁弹窗（顶栏胶囊、单篇加密、Memo 占位都指向它） |
 * | 启用且已解锁 | 进空间根视图（`{ kind: "notebook", folderId: vault.id }`） |
 */
import { useCallback, useMemo } from "react";
import type { PrivacyGate } from "@menote/shared";
import type { NotesWorkspace } from "../features/notes/useNotesWorkspace";

/** 隐私锁三态（`usePrivacyLock` 只需要这两个字段，其余不必传进来） */
export interface VaultLockState {
  enabled: boolean;
  lockState: "disabled" | "locked" | "unlocked";
}

export interface VaultEntryHooks {
  privacy: VaultLockState;
  workspace: NotesWorkspace;
  /** 离开首页/其它独立视图（`browse` 态） */
  leaveBrowse: () => void;
  /** 开解锁弹窗（与顶栏胶囊同一个） */
  requestUnlock: () => void;
}

export interface VaultEntry {
  openVault: () => void;
  /** 给首页那两颗入口（动作带 + 快速导航）用 */
  entry: { enabled: boolean; locked: boolean; reason: string | null };
}

export function useVaultEntry({ privacy, workspace, leaveBrowse, requestUnlock }: VaultEntryHooks): VaultEntry {
  const enabled = privacy.enabled;
  const locked = privacy.lockState === "locked";

  const openVault = useCallback(() => {
    if (!enabled) return;
    if (locked) {
      requestUnlock();
      return;
    }
    leaveBrowse();
    workspace.setView({ kind: "notebook", folderId: workspace.vault.id });
  }, [enabled, locked, leaveBrowse, requestUnlock, workspace]);

  const entry = useMemo(
    () => ({
      enabled,
      locked,
      reason: enabled ? null : "先在设置 › 隐私锁 启用，才能打开加密空间",
    }),
    [enabled, locked],
  );

  return { openVault, entry };
}

/** 供类型检查用：`PrivacyGate` 与 `VaultLockState` 的一致性由调用方保证 */
export type { PrivacyGate };

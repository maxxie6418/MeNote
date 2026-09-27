/**
 * 回收站的数据接线（M4-12；《M4 界面稿》§6）。
 *
 * 把"本地读 + 联网动作"收在一个 hook 里，界面（`TrashPage`）仍然是受控的：
 * - **列表本地读**（离线也能看）；
 * - **恢复 / 永久删除 / 清空需要联网**：离线时它们的入口由界面置灰并说明原因；
 * - 永久删除按**每批 10 条**分请求，进度与失败清单在这里维护。
 *
 * 为什么软删/恢复不本地先行：原位置判定（原文件夹还在不在）与永久删除的墓碑、R2 待删登记
 * 都是服务端的职责；本地先改再对账，只会让"到底删没删掉"更难说清。
 */
import { useCallback, useEffect, useState } from "react";
import type { PrivacyGate } from "@menote/shared";
import { TRASH_RETENTION_DAYS_DEFAULT } from "@menote/shared";
import type { LocalFolder, LocalItem } from "../../data/db";
import { trashApi } from "../../data/api/endpoints";
import {
  countTrashedItems,
  listTrashedFolders,
  listTrashedItems,
  markFolderRestored,
  markItemRestored,
  markItemTrashed,
  purgeLocalItems,
} from "../../data/db";
import {
  runPurge,
  trashRows,
  type PurgeFailure,
  type PurgeProgress,
  type TrashRowModel,
} from "./model";

export interface TrashNotice {
  message: string;
  tone: "success" | "warn" | "error";
}

export interface UseTrashResult {
  rows: TrashRowModel[];
  /** 实际生效的保留天数（界面的口径文案要显示这个值，不是写死的 30） */
  retentionDays: number;
  loading: boolean;
  offline: boolean;
  selected: ReadonlySet<string>;
  progress: PurgeProgress | null;
  failures: PurgeFailure[];
  toggleSelect: (id: string) => void;
  selectAll: (checked: boolean) => void;
  restore: (ids: readonly string[]) => Promise<void>;
  purge: (ids: readonly string[]) => Promise<void>;
  empty: () => Promise<void>;
  retry: () => Promise<void>;
  reload: () => Promise<void>;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function useTrash(
  gate: PrivacyGate,
  now: () => number = Date.now,
  notify: (notice: TrashNotice) => void = () => undefined,
  /**
   * 回收站保留天数（**来自用户设置**，默认 30）。
   *
   * 2026-09-27 修：此前这里写死用默认值，于是"设置里改成 7 天"之后，
   * 回收站页显示的剩余天数、以及"剩余 N 天"的倒计时**都还按 30 天算**——
   * 设置改了、界面不跟着变，正是"接上了但接错"。
   */
  retentionDays: number = TRASH_RETENTION_DAYS_DEFAULT,
): UseTrashResult {
  const [items, setItems] = useState<LocalItem[]>([]);
  /** 回收站里的文件夹（M4-12 补；界面稿 §6.5） */
  const [folders, setFolders] = useState<LocalFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState<PurgeProgress | null>(null);
  const [failures, setFailures] = useState<PurgeFailure[]>([]);
  const [offline, setOffline] = useState(isOffline);

  const reload = useCallback(async () => {
    const [rows, folderRows] = await Promise.all([listTrashedItems(), listTrashedFolders()]);
    setItems(rows);
    setFolders(folderRows);
    setLoading(false);
  }, []);

  // 首次读盘走 `.then` 而不是在 effect 体里直接调 setState 的函数：
  // 后者会触发级联渲染（lint 明确禁止），这也是仓库里其他读盘 hook 的统一写法
  useEffect(() => {
    let alive = true;
    void Promise.all([listTrashedItems(), listTrashedFolders()]).then(([rows, folderRows]) => {
      if (!alive) return;
      setItems(rows);
      setFolders(folderRows);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 在线状态变化时刷新（离线时把恢复/永久删除置灰，回线后自动可用）
  useEffect(() => {
    const update = (): void => setOffline(isOffline());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(items.map((item) => item.id)) : new Set());
    },
    [items],
  );

  const restore = useCallback(
    async (ids: readonly string[]) => {
      let movedToRoot = false;
      /** 这一次恢复里有文件夹（提示文案要说清"整夹连同内容"） */
      let restoredFolders = 0;
      for (const id of ids) {
        try {
          // 文件夹走文件夹的接口：`restoreItem` 对文件夹 id 会 404
          if (folders.some((folder) => folder.id === id)) {
            const result = await trashApi.restoreFolder(id);
            await markFolderRestored(id, result.meta_rev, result.parent_id);
            restoredFolders += 1;
            if (result.parent_id === null) movedToRoot = true;
            continue;
          }
          const result = await trashApi.restoreItem(id);
          await markItemRestored(id, result.meta_rev, result.folder_id);
          if (result.folder_id === null) movedToRoot = true;
        } catch (error) {
          notify({
            message: error instanceof Error ? error.message : "恢复失败，请稍后重试",
            tone: "error",
          });
          return;
        }
      }
      await reload();
      setSelected(new Set());
      notify({
        message: movedToRoot
          ? "已恢复到根目录（原文件夹已不存在）"
          : restoredFolders > 0
            ? `已恢复 ${restoredFolders} 个文件夹（含其中的内容）`
            : ids.length > 1
              ? `已恢复 ${ids.length} 条到原位置`
              : "已恢复到原位置",
        tone: "success",
      });
    },
    [folders, notify, reload],
  );

  const runBatches = useCallback(
    async (ids: readonly string[]) => {
      setFailures([]);
      const result = await runPurge(
        ids,
        async (batch) => {
          await trashApi.purge(batch);
        },
        (next) => setProgress(next),
      );
      setProgress(null);

      // 只清**真的删掉了**的那些：失败项要留在列表里给「重试」
      const failed = new Set(result.failures.map((failure) => failure.id));
      await purgeLocalItems(ids.filter((id) => !failed.has(id)));
      setFailures(result.failures);
      await reload();
      setSelected(new Set());
      if (result.failures.length === 0) {
        notify({ message: `已永久删除 ${result.done} 条`, tone: "warn" });
      } else {
        notify({ message: `${result.failures.length} 条没能删除，已留在列表里`, tone: "error" });
      }
    },
    [notify, reload],
  );

  const purge = useCallback(
    async (ids: readonly string[]) => {
      if (isOffline()) {
        notify({ message: "需要联网才能永久删除", tone: "error" });
        return;
      }
      await runBatches(ids);
    },
    [notify, runBatches],
  );

  const empty = useCallback(async () => {
    if (isOffline()) {
      notify({ message: "需要联网才能清空回收站", tone: "error" });
      return;
    }
    const ids = items.map((item) => item.id);
    setFailures([]);
    setProgress({ done: 0, total: ids.length, label: `正在删除 0 / ${ids.length}` });
    try {
      const result = await trashApi.empty();
      await purgeLocalItems(ids);
      await reload();
      notify({ message: `已清空回收站（${result.deleted} 条）`, tone: "warn" });
    } catch (error) {
      notify({
        message: error instanceof Error ? error.message : "清空失败，请稍后重试",
        tone: "error",
      });
    } finally {
      setProgress(null);
    }
  }, [items, notify, reload]);

  const retry = useCallback(async () => {
    const ids = failures.map((failure) => failure.id);
    if (ids.length > 0) await runBatches(ids);
  }, [failures, runBatches]);

  return {
    rows: trashRows(items, now(), gate, retentionDays, folders),
    retentionDays,
    loading,
    offline,
    selected,
    progress,
    failures,
    toggleSelect,
    selectAll,
    restore,
    purge,
    empty,
    retry,
    reload,
  };
}

/** 设置页卡片头要的实时计数（与回收站页共用同一份本地来源） */
export async function trashCount(): Promise<number> {
  return countTrashedItems();
}

/**
 * 回收站条目数变化时的广播（模块级，极简）：
 * 删除动作散在好几个 feature（列表行、编辑器、文件夹、Memo），
 * 让设置页那个计数跟着更新最简单的办法就是"删完喊一嗓子"，
 * 而不是把计数一路 prop drill 到每个删除入口。
 */
const countListeners = new Set<() => void>();

export function notifyTrashCountChanged(): void {
  for (const listener of countListeners) listener();
}

/**
 * 回收站条目数的**实时计数**（设置页卡片头用；`DESIGN.md` §5.4-2：实时计数必须可见）。
 *
 * 读的是本地库，所以很快、离线也对；任何删除路径调用 `notifyTrashCountChanged()` 都会让它刷新。
 */
export function useTrashCount(): { count: number; refresh: () => Promise<void> } {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    setCount(await countTrashedItems());
  }, []);

  useEffect(() => {
    let alive = true;
    void countTrashedItems().then((next) => {
      if (alive) setCount(next);
    });

    const listener = (): void => {
      void countTrashedItems().then((next) => {
        if (alive) setCount(next);
      });
    };
    countListeners.add(listener);
    return () => {
      alive = false;
      countListeners.delete(listener);
    };
  }, []);

  return { count, refresh };
}

/**
 * 移入回收站（软删）——**供其他 feature 调用**（笔记列表、文件夹树、编辑器「更多」菜单）。
 *
 * 放在这里而不是各自实现：软删必须走同一个端点与同一套本地记账（`rev` 不动、`meta_rev+1`、
 * `deleted_at` 落库），否则"删了但列表还在"最迟会在切换视图时暴露。
 */
export async function moveToTrash(id: string): Promise<{ deletedAt: number; metaRev: number }> {
  const result = await trashApi.deleteItem(id);
  if (result.deleted_at !== null) {
    await markItemTrashed(id, result.deleted_at, result.meta_rev);
  }
  notifyTrashCountChanged();
  return { deletedAt: result.deleted_at ?? Date.now(), metaRev: result.meta_rev };
}

/** 撤销：把刚删掉的条目恢复回来（提示里的「撤销」就是它） */
export async function undoTrash(id: string): Promise<{ folderId: string | null }> {
  const result = await trashApi.restoreItem(id);
  await markItemRestored(id, result.meta_rev, result.folder_id);
  notifyTrashCountChanged();
  return { folderId: result.folder_id };
}

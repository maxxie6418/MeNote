/**
 * 版本历史的数据接线（M4-11；《M4 界面稿》§四）。
 *
 * 面板本身是受控的；这个 hook 管"列表怎么来、正文怎么拉、四个动作怎么落"：
 * - 打开时拉一次列表（失败给错误提示，不静默空列表）；
 * - **选一个版本才拉它的正文**（列表不带正文；一屏十几个版本的全文没人要）；
 * - 恢复的前置（先保存当前稿）由调用方在 `onRestore` 之前完成——这里只负责"调接口 + 刷新"。
 */
import { useCallback, useState } from "react";
import { versionsApi } from "../../data/api/endpoints";
import { versionRows, type VersionRowModel } from "./model";

export interface VersionsNotice {
  message: string;
  tone: "success" | "warn" | "error";
}

export interface UseVersionsResult {
  rows: VersionRowModel[];
  bodies: Record<string, string>;
  loading: boolean;
  bodyLoading: boolean;
  busy: boolean;
  open: (itemId: string) => Promise<void>;
  openVersion: (versionId: string) => Promise<void>;
  seal: (label: string | null) => Promise<void>;
  restore: (versionId: string) => Promise<void>;
  toggleKeep: (versionId: string, keep: boolean) => Promise<void>;
  reset: () => void;
}

export function useVersions(
  notify: (notice: VersionsNotice) => void = () => undefined,
  now: () => number = Date.now,
): UseVersionsResult {
  const [itemId, setItemId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Parameters<typeof versionRows>[0]>([]);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    try {
      const page = await versionsApi.list(target, { limit: 100 });
      setVersions(page.versions);
    } catch (error) {
      notify({
        message: error instanceof Error ? error.message : "版本列表读取失败",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const open = useCallback(
    async (target: string) => {
      setItemId(target);
      setBodies({});
      await load(target);
    },
    [load],
  );

  const openVersion = useCallback(
    async (versionId: string) => {
      if (bodies[versionId] !== undefined) return;
      setBodyLoading(true);
      try {
        const result = await versionsApi.body(versionId);
        setBodies((current) => ({ ...current, [versionId]: result.body }));
      } catch (error) {
        notify({
          message: error instanceof Error ? error.message : "版本正文读取失败",
          tone: "error",
        });
      } finally {
        setBodyLoading(false);
      }
    },
    [bodies, notify],
  );

  const seal = useCallback(
    async (label: string | null) => {
      if (!itemId) return;
      setBusy(true);
      try {
        const result = await versionsApi.seal(itemId, label);
        await load(itemId);
        notify({
          message: result.created ? "已存为版本（默认永久保留）" : "内容与最近一个版本相同，没有新增版本",
          tone: result.created ? "success" : "warn",
        });
      } catch (error) {
        notify({ message: error instanceof Error ? error.message : "存为版本失败", tone: "error" });
      } finally {
        setBusy(false);
      }
    },
    [itemId, load, notify],
  );

  const restore = useCallback(
    async (versionId: string) => {
      if (!itemId) return;
      setBusy(true);
      try {
        await versionsApi.restore(versionId);
        await load(itemId);
        notify({ message: "已恢复到此版本；恢复前的当前稿已封存为新版本", tone: "success" });
      } catch (error) {
        notify({ message: error instanceof Error ? error.message : "恢复失败", tone: "error" });
      } finally {
        setBusy(false);
      }
    },
    [itemId, load, notify],
  );

  const toggleKeep = useCallback(
    async (versionId: string, keep: boolean) => {
      if (!itemId) return;
      try {
        await versionsApi.setKeep(versionId, keep);
        await load(itemId);
        notify({ message: keep ? "已标记为保留" : "已取消保留", tone: "success" });
      } catch (error) {
        notify({ message: error instanceof Error ? error.message : "操作失败", tone: "error" });
      }
    },
    [itemId, load, notify],
  );

  const reset = useCallback(() => {
    setItemId(null);
    setVersions([]);
    setBodies({});
  }, []);

  return {
    rows: versionRows(versions, now()),
    bodies,
    loading,
    bodyLoading,
    busy,
    open,
    openVersion,
    seal,
    restore,
    toggleKeep,
    reset,
  };
}

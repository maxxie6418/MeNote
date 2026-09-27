/**
 * 条目的元数据补丁动作（M3-8 从 `useNotesWorkspace` 抽出，为那个 hook 的行数预算让位）。
 *
 * 共同点：都是一条 `patch_meta`（写本地 + 入队 outbox），接着刷新工作区。
 * 抽出来的另一个好处是这些动作的**前置校验**集中在一处，读起来不用在 600 行的 hook 里找。
 *
 * 三条客户端前置校验（服务端同样挡，这里只是提前给反馈）：
 * - **Memo 不做单篇加密**；
 * - **单篇加密前必须已启用隐私锁**（否则没有门禁材料，锁上就解不开）；
 * - **取消加密必须先解锁**（取消意味着要处理明文，不能让"锁定态下悄悄解密"发生——由界面挡）。
 */
import { useCallback } from "react";
import { db, enqueueMetaPatch, getLocalItem } from "../../data/db";
import type { LocalItem } from "../../data/db";
import { itemsApi } from "../../data/api/endpoints";

/** 补丁允许改的列（与服务端白名单对应） */
export type ItemPatchFields = Partial<
  Pick<LocalItem, "folder_id" | "pinned" | "starred" | "enc_self" | "in_enc_space">
>;

export interface UseItemPatchActionsInput {
  refresh: () => Promise<void>;
  onLocalWrite?: () => void;
}

export function useItemPatchActions(input: UseItemPatchActionsInput) {
  const { refresh, onLocalWrite } = input;

  const patchItem = useCallback(
    async (itemId: string, patch: ItemPatchFields) => {
      const item = await getLocalItem(itemId);
      if (!item) return;
      await db.items.update(itemId, { ...patch, updated_at: Date.now() });
      await enqueueMetaPatch(itemId, item.meta_rev, Date.now());
      await refresh();
      onLocalWrite?.();
    },
    [onLocalWrite, refresh],
  );

  const moveItemToFolder = useCallback(
    (itemId: string, folderId: string | null) => patchItem(itemId, { folder_id: folderId }),
    [patchItem],
  );

  const setItemEncryption = useCallback(
    async (itemId: string, encrypted: boolean) => {
      const item = await getLocalItem(itemId);
      if (!item) return;
      if (item.type === "memo") {
        throw new Error("Memo 不支持单篇加密");
      }
      await patchItem(itemId, { enc_self: encrypted ? 1 : 0 });
    },
    [patchItem],
  );

  const togglePinned = useCallback(
    async (itemId: string) => {
      const item = await getLocalItem(itemId);
      if (!item) return;
      await patchItem(itemId, { pinned: item.pinned === 1 ? 0 : 1 });
    },
    [patchItem],
  );

  const toggleStarred = useCallback(
    async (itemId: string) => {
      const item = await getLocalItem(itemId);
      if (!item) return;
      await patchItem(itemId, { starred: item.starred === 1 ? 0 : 1 });
    },
    [patchItem],
  );

  /**
   * **降级为普通笔记**（M4-9；`table → note` 单向，2026-09-27 按用户拍板加入）。
   *
   * 为什么不走 outbox（其它补丁都走）：outbox 行**不带 payload**，补丁是在推送时从本地行重建的——
   * 而 `type` 不能"每次都发"（服务端只接受"当前是表格"的降级请求，给普通笔记发 `type` 会被拒）。
   * 所以这一条**直连 API**：成功才改本地，失败原样报错。代价是**需要联网**——
   * 但降级本身就是一次要确认的破坏性动作（会封存一个版本再改类型），要求在线是合理的。
   */
  const degradeToNote = useCallback(
    async (itemId: string) => {
      const item = await getLocalItem(itemId);
      if (!item || item.type !== "table") return;
      const result = await itemsApi.patchMeta(itemId, {
        base_meta_rev: item.meta_rev,
        type: "note",
      });
      // 服务端已改类型：本地跟着改（`meta_rev` 用服务端回的，别自己加）
      await db.items.update(itemId, {
        type: "note",
        meta_rev: result.meta_rev,
        updated_at: Date.now(),
      });
      await refresh();
    },
    [refresh],
  );

  return {
    patchItem,
    moveItemToFolder,
    setItemEncryption,
    togglePinned,
    toggleStarred,
    degradeToNote,
  };
}

/**
 * Memo 图册要用的图片索引（B3 批）。
 *
 * 由**组合根**（`app/workarea/MemoView.tsx`）调用，把结果当纯数据传进面板——面板与模块
 * 都不碰数据访问（界面只做展示与交互）。
 *
 * 只读元数据，**不读图片本体**：图片在 R2，本地只有"这一条引用了哪些图、多大、有没有缩略图"。
 * 依赖是"条目 id 的集合"而不是数组本身——同步刷新会换数组身份，用 id 串当依赖可以避免
 * 每次 refresh 都重查一遍附件表。
 */
import { useEffect, useState } from "react";
import { listImageAttachments } from "../../data/db";
import type { LocalItem } from "../../data/db";

export interface MemoImageRef {
  sha256: string;
  width: number | null;
  height: number | null;
  /** 有没有缩略图对象（没有就退原图） */
  hasThumb: boolean;
}

export function useMemoImages(memos: readonly LocalItem[]): Map<string, MemoImageRef[]> {
  const [images, setImages] = useState<Map<string, MemoImageRef[]>>(() => new Map());
  const ids = memos.map((memo) => memo.id).join(",");

  useEffect(() => {
    let alive = true;
    void listImageAttachments().then((byItem) => {
      if (!alive) return;
      const next = new Map<string, MemoImageRef[]>();
      for (const [itemId, rows] of byItem) {
        next.set(
          itemId,
          rows.map((row) => ({
            sha256: row.sha256,
            width: row.width,
            height: row.height,
            hasThumb: row.has_thumb,
          })),
        );
      }
      setImages(next);
    });
    return () => {
      alive = false;
    };
  }, [ids]);

  return images;
}

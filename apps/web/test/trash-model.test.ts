/**
 * 回收站模型（M4-12；《M4 界面稿》§6）。
 *
 * 用例名对齐《M4 实施计划》M4-12 的验收清单。
 */
import { describe, expect, it, vi } from "vitest";
import { DAY_MS, DEFAULT_PRIVACY_SETTINGS, PERMANENT_DELETE_BATCH, TRASH_RETENTION_DAYS_DEFAULT, privacyGateFrom } from "@menote/shared";
import type { LocalItem } from "../src/data/db";
import {
  URGENT_REMAINING_DAYS,
  chunkIds,
  deleteNotice,
  emptyConfirmText,
  progressLabel,
  purgeConfirmText,
  remainingDays,
  restoreNotice,
  runPurge,
  trashRows,
} from "../src/features/trash/model";

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

function item(overrides: Partial<LocalItem> = {}): LocalItem {
  return {
    id: "i1",
    type: "note",
    folder_id: null,
    title: "标题",
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 1,
    content_hash: "h",
    tags: [],
    memo_at: null,
    is_task: 0,
    task_status: null,
    task_due: null,
    task_priority: null,
    pinned: 0,
    starred: 0,
    rev: 1,
    meta_rev: 1,
    sealed_rev: null,
    sync_seq: 1,
    created_at: 1,
    updated_at: 1,
    last_edit_at: 1,
    last_device: null,
    deleted_at: NOW - 5 * DAY_MS,
    deleted: true,
    pending: null,
    ...overrides,
  };
}

// 用正式的 gate 工厂构造，别手搓形状：`scope` 与 `searchBodiesWhenUnlocked` 都是判定要用的字段
const openGate = privacyGateFrom(DEFAULT_PRIVACY_SETTINGS, "unlocked");
const lockedGate = privacyGateFrom(DEFAULT_PRIVACY_SETTINGS, "locked");

describe("剩余保留天数", () => {
  it("按 30 天默认值计算，向上取整且不为负", () => {
    expect(remainingDays(NOW, NOW)).toBe(TRASH_RETENTION_DAYS_DEFAULT);
    expect(remainingDays(NOW - 29 * DAY_MS, NOW)).toBe(1);
    expect(remainingDays(NOW - 31 * DAY_MS, NOW)).toBe(0);
    // 自定义保留期（设置页可改）
    expect(remainingDays(NOW, NOW, 7)).toBe(7);
  });
});

describe("列表呈现", () => {
  it("按删除时间倒序；≤3 天标记为紧急", () => {
    const rows = trashRows(
      [
        item({ id: "old", deleted_at: NOW - 29 * DAY_MS }),
        item({ id: "new", deleted_at: NOW - 1 * DAY_MS }),
      ],
      NOW,
      openGate,
    );
    expect(rows.map((row) => row.id)).toEqual(["new", "old"]);
    expect(rows[0]?.remainingDays).toBe(29);
    expect(rows[0]?.urgent).toBe(false);
    expect(rows[1]?.remainingDays).toBe(1);
    expect(rows[1]?.urgent).toBe(true);
    expect(rows[1]?.remainingDays).toBeLessThanOrEqual(URGENT_REMAINING_DAYS);
  });

  it("没删的条目不进回收站列表", () => {
    const rows = trashRows([item({ deleted_at: null }), item({ id: "t", deleted_at: NOW })], NOW, openGate);
    expect(rows.map((row) => row.id)).toEqual(["t"]);
  });

  it("加密空间条目锁定时标题占位（真实标题不出现），解锁期间显示真实标题并标注", () => {
    const locked = trashRows([item({ in_enc_space: 1, title: "秘密" })], NOW, lockedGate);
    expect(locked[0]?.title).toBe("加密空间内条目");
    expect(locked[0]?.title).not.toContain("秘密");
    expect(locked[0]?.titleHidden).toBe(true);

    const unlocked = trashRows([item({ in_enc_space: 1, title: "秘密" })], NOW, openGate);
    expect(unlocked[0]?.title).toBe("秘密");
    expect(unlocked[0]?.inEncSpace).toBe(true);
    expect(unlocked[0]?.titleHidden).toBe(false);
  });

  it("单篇加密条目：明文标题 + 加密标记（标题任何状态可读）", () => {
    const rows = trashRows([item({ enc_self: 1, title: "单篇" })], NOW, lockedGate);
    expect(rows[0]?.title).toBe("单篇");
    expect(rows[0]?.encSelf).toBe(true);
  });

  it("没有标题时给占位文字，不显示空白行", () => {
    expect(trashRows([item({ title: null })], NOW, openGate)[0]?.title).toBe("（无标题）");
  });
});

describe("永久删除的分批编排", () => {
  it(`每批 ${PERMANENT_DELETE_BATCH} 条拆分请求`, () => {
    const ids = Array.from({ length: 24 }, (_, index) => `i${index}`);
    const batches = chunkIds(ids);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(PERMANENT_DELETE_BATCH);
    expect(batches[2]).toHaveLength(4);
  });

  it("按批推进并报进度（界面直接显示 label）", async () => {
    const seen: string[] = [];
    const purge = vi.fn(async () => undefined);
    const ids = Array.from({ length: 24 }, (_, index) => `i${index}`);

    const result = await runPurge(ids, purge, (progress) => seen.push(progress.label));

    expect(purge).toHaveBeenCalledTimes(3);
    expect(seen).toEqual([progressLabel(10, 24), progressLabel(20, 24), progressLabel(24, 24)]);
    expect(result).toEqual({ done: 24, failures: [] });
  });

  it("单批失败跳过并进失败清单、可重试（已完成的部分不清空）", async () => {
    const ids = Array.from({ length: 24 }, (_, index) => `i${index}`);
    const purge = vi
      .fn<(batch: readonly string[]) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("网络不可用"))
      .mockResolvedValueOnce(undefined);

    const result = await runPurge(ids, purge);

    // 三批是 [10, 10, 4]：第二批（10 条）失败，其余两批照常完成 → done = 14
    expect(result.done).toBe(14);
    expect(result.failures).toHaveLength(10);
    expect(result.failures[0]?.reason).toBe("网络不可用");

    // 失败项重试：只把失败的 10 个 id 再发一次
    const retry = vi.fn(async () => undefined);
    const again = await runPurge(result.failures.map((failure) => failure.id), retry);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(again.done).toBe(10);
  });

  it("空列表不发请求", async () => {
    const purge = vi.fn(async () => undefined);
    expect(await runPurge([], purge)).toEqual({ done: 0, failures: [] });
    expect(purge).not.toHaveBeenCalled();
  });
});

describe("文案", () => {
  it("删除提示含「已移入回收站」与可恢复窗口", () => {
    expect(deleteNotice("我的笔记")).toContain("已移入回收站");
    expect(deleteNotice("我的笔记")).toContain("30 天");
  });

  it("恢复提示区分原位置与根目录", () => {
    expect(restoreNotice(false)).toContain("原位置");
    expect(restoreNotice(true)).toContain("根目录");
  });

  it("永久删除确认框写明条目 + 全部版本 + 附件，且**不承诺快照文件**", () => {
    const single = purgeConfirmText(1);
    expect(single.title).toBe("永久删除");
    expect(single.body).toContain("全部版本");
    expect(single.body).toContain("附件");
    expect(single.body).toContain("不可撤销");
    // 关键：不得写"快照也会删除"
    expect(single.body).toContain("快照中的文件不在本次操作范围内");
    expect(single.body).not.toContain("快照也会删除");

    expect(purgeConfirmText(12).title).toBe("永久删除 12 条");
    expect(purgeConfirmText(12).body).toContain("这 12 条内容");
  });

  it("清空确认框写实时条数", () => {
    expect(emptyConfirmText(0).body).toContain("0 条");
    expect(emptyConfirmText(7).body).toContain("7 条");
  });
});

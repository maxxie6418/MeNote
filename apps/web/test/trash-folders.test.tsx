// @vitest-environment jsdom
/**
 * 回收站里的**文件夹**（M4-12 补；《M4 界面稿》§6.5 要求"加密空间内条目**或其文件夹**在回收站里"）。
 *
 * 发现经过：第二轮调用点检查查出 `trashApi.restoreFolder` 与 `markFolderRestored` **没有 UI 调用点**、
 * `listTrashedItems` 只查 `items`——也就是**文件夹一旦删除就在界面上消失**：内容可以逐条恢复，
 * 但会落到根目录，而文件夹本身永远看不到、也恢复不了。
 *
 * 本轮补上"列出 + 恢复"；**永久删除**仍缺（服务端 `permanentDeleteItems` 只扫 `items`），
 * 所以文件夹行的「永久删除」置灰并写明原因——见 `TrashRowModel.purgeable` 的说明。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRIVACY_SETTINGS, privacyGateFrom } from "@menote/shared";
import { TrashPage } from "../src/features/trash/ui/TrashPage";
import { trashFolderRow, trashRows } from "../src/features/trash/model";
import type { LocalFolder, LocalItem } from "../src/data/db";

afterEach(cleanup);

/** 用正式的 gate 工厂构造，别手搓形状 */
const openGate = privacyGateFrom(DEFAULT_PRIVACY_SETTINGS, "unlocked");
const lockedGate = privacyGateFrom(DEFAULT_PRIVACY_SETTINGS, "locked");
const noPrivacyGate = (): ReturnType<typeof privacyGateFrom> => openGate;
void lockedGate;

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

function folder(overrides: Partial<LocalFolder> = {}): LocalFolder {
  return {
    id: "f1",
    parent_id: null,
    name: "工作",
    depth: 1,
    position: 0,
    is_enc_space: 0,
    in_enc_space: 0,
    meta_rev: 2,
    sync_seq: 3,
    created_at: 1,
    updated_at: 2,
    deleted_at: NOW - 6 * 24 * 60 * 60 * 1000,
    deleted: true,
    pending: null,
    ...overrides,
  };
}

function item(id: string, deletedAt: number): LocalItem {
  return {
    id,
    type: "note",
    folder_id: null,
    title: "被删的笔记",
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
    meta_rev: 2,
    sealed_rev: null,
    sync_seq: 3,
    created_at: 1,
    updated_at: 2,
    last_edit_at: null,
    last_device: null,
    deleted_at: deletedAt,
    deleted: true,
    pending: null,
  };
}

describe("文件夹进入回收站列表", () => {
  it("条目与文件夹合成一张列表，按删除时间倒序", () => {
    const rows = trashRows(
      [item("i1", NOW - 2 * 24 * 60 * 60 * 1000)],
      NOW,
      noPrivacyGate(),
      undefined,
      [folder()],
    );

    expect(rows).toHaveLength(2);
    // 文件夹删得更早 → 排在后面
    expect(rows.map((row) => row.kind)).toEqual(["item", "folder"]);
    expect(rows[1]).toMatchObject({ kind: "folder", type: "folder", title: "工作" });
  });

  it("文件夹行的剩余天数同一套换算；≤3 天标紧急", () => {
    const row = trashFolderRow(
      folder({ deleted_at: NOW - 28 * 24 * 60 * 60 * 1000 }),
      NOW,
      noPrivacyGate(),
    );
    expect(row.remainingDays).toBe(2);
    expect(row.urgent).toBe(true);
  });

  it("加密空间里的文件夹在锁定时藏名字（与条目同一口径）", () => {
    const row = trashFolderRow(folder({ in_enc_space: 1 }), NOW, lockedGate);
    expect(row.titleHidden).toBe(true);
    expect(row.title).toBe("加密空间内文件夹");
  });

  it("已删除的条目/文件夹才进列表（`deleted_at` 为空的不算）", () => {
    const rows = trashRows([item("live", 0)], NOW, noPrivacyGate(), undefined, [
      folder({ deleted_at: null }),
    ]);
    // `deleted_at = 0` 的行仍会被 `trashRow` 收进（调用方只传已删除的），
    // 所以这里只断言"未删除的文件夹不进列表"
    expect(rows.some((row) => row.id === "f1")).toBe(false);
  });
});

describe("保留天数走用户设置（不是写死的 30）", () => {
  it("页头口径显示实际生效的天数", () => {
    const { rerender } = render(
      <TrashPage
        rows={[]}
        selected={new Set()}
        onToggleSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onRestore={vi.fn()}
        onPurge={vi.fn()}
        onEmpty={vi.fn()}
        onBackToSettings={vi.fn()}
      />,
    );
    // 没给 retentionDays 时用默认 30
    expect(screen.getByText("保留 30 天")).toBeTruthy();

    rerender(
      <TrashPage
        rows={[]}
        selected={new Set()}
        onToggleSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onRestore={vi.fn()}
        onPurge={vi.fn()}
        onEmpty={vi.fn()}
        retentionDays={7}
        onBackToSettings={vi.fn()}
      />,
    );
    expect(screen.getByText("保留 7 天")).toBeTruthy();
  });

  it("剩余天数也按设置算（设 7 天时删了 5 天的只剩 2 天）", () => {
    const rows = trashRows(
      [item("i1", NOW - 5 * 24 * 60 * 60 * 1000)],
      NOW,
      openGate,
      7,
    );
    expect(rows[0]?.remainingDays).toBe(2);
    expect(rows[0]?.urgent).toBe(true);
  });
});

describe("文件夹行的界面", () => {
  it("显示类型「文件夹」与文件夹图标，并且**不给可用的永久删除**（服务端还不支持）", () => {
    render(
      <TrashPage
        rows={[trashFolderRow(folder(), NOW, noPrivacyGate())]}
        selected={new Set()}
        onToggleSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onRestore={vi.fn()}
        onPurge={vi.fn()}
        onEmpty={vi.fn()}
        onBackToSettings={vi.fn()}
      />,
    );

    expect(screen.getByText("文件夹")).toBeTruthy();
    const purge = screen.getByRole("button", { name: "永久删除" }) as HTMLButtonElement;
    expect(purge.disabled).toBe(true);
    expect(purge.getAttribute("title")).toContain("文件夹的永久删除暂未开放");
    // 恢复照常可用
    expect((screen.getByRole("button", { name: "恢复" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("条目行的永久删除仍然可用（别把两者做成一样）", () => {
    const rows = trashRows([item("i1", NOW)], NOW, noPrivacyGate());
    render(
      <TrashPage
        rows={rows}
        selected={new Set()}
        onToggleSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onRestore={vi.fn()}
        onPurge={vi.fn()}
        onEmpty={vi.fn()}
        onBackToSettings={vi.fn()}
      />,
    );
    expect((screen.getByRole("button", { name: "永久删除" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("点文件夹行的「恢复」把它交出去", async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    render(
      <TrashPage
        rows={[trashFolderRow(folder(), NOW, noPrivacyGate())]}
        selected={new Set()}
        onToggleSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onRestore={onRestore}
        onPurge={vi.fn()}
        onEmpty={vi.fn()}
        onBackToSettings={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "恢复" }));
    expect(onRestore).toHaveBeenCalledWith(["f1"]);
  });
});

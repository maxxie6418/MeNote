// @vitest-environment jsdom
/**
 * 单篇加密的界面侧契约（M3-7）：锁定占位、四个动作的可用性、状态栏的口径。
 *
 * 不碰 WebCrypto 与网络：这里验的是"界面把该做的事做对了"——
 * 锁定时**编辑器根本不挂载**、禁用项都带原因、锁定态也能点加密（Q25）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalItem } from "../src/data/db";
import { NoteWorkspace } from "../src/features/notes/ui/NoteWorkspace";
import type { NoteEditorSnapshot } from "../src/features/notes/model";

afterEach(cleanup);

function item(extra: Partial<LocalItem> = {}): LocalItem {
  return {
    id: "n1",
    type: "note",
    folder_id: null,
    title: "会议记录",
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 12,
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
    deleted_at: null,
    deleted: false,
    pending: null,
    ...extra,
  };
}

const SNAPSHOT: NoteEditorSnapshot = {
  sizeLabel: "12 字",
  sizeLevel: "ok",
  saveState: "synced",
} as NoteEditorSnapshot;

function renderWorkspace(options: {
  item?: LocalItem;
  encryption?: Partial<NonNullable<Parameters<typeof NoteWorkspace>[0]["encryption"]>>;
  onExportMarkdown?: (includeAttachments: boolean) => void;
} = {}) {
  const handlers = {
    onUnlock: vi.fn(),
    onLock: vi.fn(),
    onToggle: vi.fn(),
    onLockAll: vi.fn(),
  };
  const { container } = render(
    <NoteWorkspace
      item={options.item ?? item()}
      initialBody="正文内容"
      snapshot={SNAPSHOT}
      initialMode="edit"
      onInput={vi.fn()}
      onTitleChange={vi.fn()}
      encryption={{
        enabled: true,
        encrypted: false,
        unlocked: false,
        unlockedCount: 0,
        ...handlers,
        ...options.encryption,
      }}
      onExportMarkdown={options.onExportMarkdown}
    />,
  );
  return { container, ...handlers };
}

describe("锁定态的单篇", () => {
  it("已加密且未解锁：正文区换占位、编辑器不挂载、状态栏不显示大小", () => {
    const { onUnlock } = renderWorkspace({
      item: item({ enc_self: 1 }),
      encryption: { encrypted: true, unlocked: false },
    });

    expect(screen.getByText("这一篇已加密")).toBeTruthy();
    expect(screen.queryByLabelText("正文")).toBeNull();
    expect(screen.queryByText("12 字")).toBeNull();
    expect(screen.getByText("已加密")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "解锁此篇" }));
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it("解锁后编辑器挂载、正文可编辑", async () => {
    renderWorkspace({
      item: item({ enc_self: 1 }),
      encryption: { encrypted: true, unlocked: true },
    });
    expect(screen.queryByText("这一篇已加密")).toBeNull();
    /*
      编辑器是动态 import 的，等它挂上。
      **给足超时**：RTL 默认 1s，而全量并行跑时这个分包（CodeMirror + 编辑器）会明显变慢——
      2026-09-28 实测在全量套件里偶发超时、单文件跑 444ms 就过；加大到 5s 消掉这个假失败。
    */
    expect(await screen.findByLabelText("正文", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText("已加密 · 本次已解锁")).toBeTruthy();
  });

  it("未加密的普通条目：没有加密标识，编辑器照常", async () => {
    renderWorkspace();
    expect(await screen.findByLabelText("正文")).toBeTruthy();
    expect(screen.queryByText(/已加密/)).toBeNull();
  });
});

describe("「更多」菜单里的加密动作", () => {
  it("锁定态也能加密此篇（Q25）", () => {
    const { onToggle } = renderWorkspace({ encryption: { encrypted: false } });

    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    const encrypt = screen.getByRole("menuitem", { name: /加密此篇/ }) as HTMLButtonElement;
    expect(encrypt.disabled).toBe(false);
    fireEvent.click(encrypt);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("未启用隐私锁时禁用加密并说明去哪里启用", () => {
    renderWorkspace({ encryption: { enabled: false, encrypted: false } });

    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    const encrypt = screen.getByRole("menuitem", { name: /加密此篇/ }) as HTMLButtonElement;
    expect(encrypt.disabled).toBe(true);
    expect(encrypt.title).toContain("隐私锁");
  });

  it("已加密但未解锁时：取消加密被拦住并说明原因", () => {
    renderWorkspace({
      item: item({ enc_self: 1 }),
      encryption: { encrypted: true, unlocked: false },
    });

    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    const decrypt = screen.getByRole("menuitem", { name: /取消加密/ }) as HTMLButtonElement;
    expect(decrypt.disabled).toBe(true);
    expect(decrypt.title).toContain("解锁");
  });

  it("已解锁的加密篇：可以取消加密、锁上此篇", () => {
    const { onToggle, onLock } = renderWorkspace({
      item: item({ enc_self: 1 }),
      encryption: { encrypted: true, unlocked: true, unlockedCount: 2 },
    });

    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    const decrypt = screen.getByRole("menuitem", { name: /取消加密/ }) as HTMLButtonElement;
    expect(decrypt.disabled).toBe(false);
    fireEvent.click(decrypt);
    expect(onToggle).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /锁上此篇/ }));
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("「锁上全部单篇」只在有已解密单篇时可用", () => {
    renderWorkspace({ encryption: { unlockedCount: 0 } });
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    expect((screen.getByRole("menuitem", { name: /锁上全部单篇/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    cleanup();
    const second = renderWorkspace({ encryption: { unlockedCount: 3 } });
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /锁上全部单篇/ }));
    expect(second.onLockAll).toHaveBeenCalledTimes(1);
  });
});

describe("「更多」菜单里的单篇导出（M15）", () => {
  it("两项各司其职：只导 .md 回调 false，含附件回调 true", () => {
    const onExportMarkdown = vi.fn();
    renderWorkspace({ onExportMarkdown });

    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出 Markdown" }));
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出 Markdown（含附件）" }));

    expect(onExportMarkdown).toHaveBeenNthCalledWith(1, false);
    expect(onExportMarkdown).toHaveBeenNthCalledWith(2, true);
  });

  it("不给 onExportMarkdown 时菜单里不出现导出入口（未接线的视图不显示假按钮）", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    expect(screen.queryByRole("menuitem", { name: /导出 Markdown/ })).toBeNull();
  });

  it("锁定态两项都禁用并说明原因（正文都看不了，更不该导出）", () => {
    renderWorkspace({
      item: item({ enc_self: 1 }),
      encryption: { encrypted: true, unlocked: false },
      onExportMarkdown: vi.fn(),
    });

    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    for (const name of ["导出 Markdown", "导出 Markdown（含附件）"]) {
      const entry = screen.getByRole("menuitem", { name }) as HTMLButtonElement;
      expect(entry.disabled).toBe(true);
      expect(entry.title).toContain("解锁");
    }
  });
});

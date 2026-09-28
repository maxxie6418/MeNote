// @vitest-environment jsdom
/**
 * 新建条目的**落点**（2026-09-28 用户反馈的问题 1："其他新建要附属于笔记本"）。
 *
 * 此前的实现里只有**加密空间**那条分支带 `folder_id`，普通笔记本一律走 `createLocalNote`
 * （= `folder_id: null`）→ 选中「工作」后点「新建笔记」，新笔记却出现在根目录「全部笔记」里
 * （实测复现：`工作 / 0 条` 不变，根视图多出一篇「未命名笔记」）。
 *
 * 这里钉三条口径：
 * 1. 「笔记本」视图选中文件夹 → 落在**那个文件夹**（第 2 层子夹同样）；
 * 2. 「最近编辑 / 收藏 / 标签」没有笔记本上下文 → 落根目录；
 * 3. 加密空间里的文件夹 → 落在那里**并带空间标记**（`in_enc_space`，不走"先建后移"）。
 *
 * 另钉一条派生值：列表头要显示的**层级路径**（`工作 › 本周`）。
 */
import "fake-indexeddb/auto";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { noPrivacyGate } from "@menote/shared";
import { createLocalFolder, db } from "../src/data/db";
import type { LocalFolder } from "../src/data/db";
import { useNoteCreation } from "../src/features/notes/useNoteCreation";
import { useNotesWorkspace, type NotesWorkspace } from "../src/features/notes/useNotesWorkspace";
import type { NotesView } from "../src/features/notes/views";

const NOW = Date.UTC(2026, 8, 28, 10, 0, 0);
const NOOP = (): void => undefined;
/** 无门禁的 gate 是单例（稳定引用） */
const GATE = noPrivacyGate();

function folder(
  id: string,
  name: string,
  parentId: string | null,
  depth: number,
  overrides: Partial<LocalFolder> = {},
): LocalFolder {
  return {
    id,
    parent_id: parentId,
    is_enc_space: 0,
    in_enc_space: 0,
    name,
    depth,
    position: 0,
    meta_rev: 1,
    sync_seq: 1,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    deleted: false,
    pending: null,
    ...overrides,
  };
}

const PARENT = folder("f1", "工作", null, 1);
const CHILD = folder("f2", "本周", "f1", 2);
const VAULT_CHILD = folder("v2", "私事", "v1", 1, { in_enc_space: 1 });

/** `open` 收到的新 id 就是新建条目的 id（用 ref 拿，effect 里抓不到快照值） */
interface CreationApi {
  createNote: (options?: { title?: string; body?: string }) => Promise<void>;
  opened: { current: string | null };
}

function CreationHarness({
  folders,
  view,
  capture,
}: {
  folders: readonly LocalFolder[];
  view: NotesView;
  capture: (api: CreationApi) => void;
}) {
  const opened = useRef<string | null>(null);
  const { createNote } = useNoteCreation({
    folders,
    view,
    refresh: async () => undefined,
    open: async (id: string) => {
      opened.current = id;
    },
    setView: NOOP,
    onLocalWrite: NOOP,
  });

  useEffect(() => {
    capture({ createNote, opened });
  }, [capture, createNote]);

  return null;
}

/** 建一条并读回本地库里那一行 */
async function createAndRead(
  folders: readonly LocalFolder[],
  view: NotesView,
): Promise<{ folder_id: string | null; in_enc_space: 0 | 1 }> {
  const api: { current: CreationApi | null } = { current: null };
  render(
    <CreationHarness folders={folders} view={view} capture={(next) => (api.current = next)} />,
  );
  const handle = api.current;
  if (!handle) throw new Error("新建动作还没接上");
  await act(async () => {
    await handle.createNote();
  });
  const opened = handle.opened.current;
  if (!opened) throw new Error("createNote 没有打开新建的条目");
  const row = await db.items.get(opened);
  if (!row) throw new Error("本地库里没有新建的条目");
  return { folder_id: row.folder_id, in_enc_space: row.in_enc_space };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await createLocalFolder(PARENT.id, PARENT.name, null, 1, NOW);
  await createLocalFolder(CHILD.id, CHILD.name, PARENT.id, 2, NOW);
  // 空间里的子夹：`in_enc_space = 1` 就足以让 `isInVault` 判真（空间根行由服务端补建）
  await createLocalFolder(VAULT_CHILD.id, VAULT_CHILD.name, VAULT_CHILD.parent_id, 1, NOW, {
    inEncSpace: true,
  });
});

afterEach(cleanup);

describe("新建笔记的落点", () => {
  it("选中第 1 层笔记本 → 落在那里面", async () => {
    const created = await createAndRead([PARENT, CHILD], { kind: "notebook", folderId: "f1" });
    expect(created.folder_id).toBe("f1");
    expect(created.in_enc_space).toBe(0);
  });

  it("选中第 2 层子夹 → 落在子夹里", async () => {
    const created = await createAndRead([PARENT, CHILD], { kind: "notebook", folderId: "f2" });
    expect(created.folder_id).toBe("f2");
  });

  it("笔记本根视图（folderId 为 null）→ 落根目录", async () => {
    const created = await createAndRead([PARENT, CHILD], { kind: "notebook" });
    expect(created.folder_id).toBeNull();
  });

  it("最近编辑 / 收藏 / 标签这些没有笔记本上下文的视图 → 落根目录", async () => {
    expect((await createAndRead([PARENT], { kind: "recent" })).folder_id).toBeNull();
    expect((await createAndRead([PARENT], { kind: "starred" })).folder_id).toBeNull();
    expect((await createAndRead([PARENT], { kind: "tag", tag: "项目" })).folder_id).toBeNull();
  });

  it("加密空间里的文件夹 → 落在那里并带空间标记（不走先建后移）", async () => {
    const created = await createAndRead([PARENT, CHILD, VAULT_CHILD], {
      kind: "notebook",
      folderId: "v2",
    });
    expect(created.folder_id).toBe("v2");
    expect(created.in_enc_space).toBe(1);
  });
});

/** 工作区外壳：只为拿派生值 `viewPath` */
function WorkspaceHarness({ capture }: { capture: (value: NotesWorkspace) => void }) {
  const workspace = useNotesWorkspace({ gate: GATE });
  useEffect(() => {
    capture(workspace);
  }, [capture, workspace]);
  return null;
}

describe("列表头的层级路径（viewPath）", () => {
  it("子夹给出「父夹 › 子夹」，根视图为空", async () => {
    const seen: NotesWorkspace[] = [];
    render(<WorkspaceHarness capture={(value) => seen.push(value)} />);
    await waitFor(() => expect(seen.at(-1)?.loading).toBe(false));

    // folders 状态由 refresh() 填：先读一次本地库
    await act(async () => {
      await seen.at(-1)?.refresh();
    });
    expect(
      (seen.at(-1)?.folders ?? []).map((row) => row.id).sort(),
    ).toEqual(["f1", "f2", "v2"]);

    act(() => {
      seen.at(-1)?.setView({ kind: "notebook", folderId: "f2" });
    });
    await waitFor(() => expect(seen.at(-1)?.viewPath).toEqual(["工作", "本周"]));

    act(() => {
      seen.at(-1)?.setView({ kind: "notebook" });
    });
    await waitFor(() => expect(seen.at(-1)?.viewPath).toEqual([]));
  });
});

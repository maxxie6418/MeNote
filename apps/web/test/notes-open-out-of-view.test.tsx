// @vitest-environment jsdom
/**
 * 回归（用户 2026-10-01 反馈的问题 4）：**左侧笔记本树里直接点开一篇文档，正文区要当场显示它**。
 *
 * 根因：`useNotesWorkspace` 的 `selected` 此前是从**当前视图过滤后的 `items`** 里找的
 * （`items.find((item) => item.id === selectedId)`）。而树里能点开的条目**未必属于此刻的视图**——
 * 停在「工作」视图里点开「私事」下的文档、或视图是最近编辑 / 收藏 / 标签时都会命中
 * → `selected` 为 `null` → 正文区退回空占位（"打开后停在列表态"），
 * 用户得先切到那个文件夹、再在列表里点一次才看得到内容（"多次点击才能看到"）。
 *
 * 这里钉两条：
 * 1. **视图不包含它，也要能打开**（正文区拿得到这一篇）；
 * 2. **门禁不许被绕过**——隐私锁锁定时，空间内的条目仍然打不开（正文区照旧占位）。
 */
import "fake-indexeddb/auto";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { noPrivacyGate, privacyGateFrom, type PrivacyGate } from "@menote/shared";
import { createLocalFolder, createLocalItem, db } from "../src/data/db";
import { useNotesWorkspace, type NotesWorkspace } from "../src/features/notes/useNotesWorkspace";

const NOW = Date.UTC(2026, 9, 1, 10, 0, 0);
/** 无门禁的 gate 是单例（稳定引用） */
const GATE = noPrivacyGate();
/** 锁定的 gate：空间内条目此刻不允许出现在列表里 */
const LOCKED = privacyGateFrom(
  { scope: { memo: true }, search_bodies_when_unlocked: true },
  "locked",
);

function Harness({
  gate,
  capture,
}: {
  gate: PrivacyGate;
  capture: (value: NotesWorkspace) => void;
}) {
  const workspace = useNotesWorkspace({ gate });
  useEffect(() => {
    capture(workspace);
  }, [capture, workspace]);
  return null;
}

/** 挂上工作区外壳，等到首次加载落定并把"最新一次返回值"的读法交出来 */
async function mountWorkspace(gate: PrivacyGate): Promise<() => NotesWorkspace> {
  const seen: NotesWorkspace[] = [];
  render(<Harness gate={gate} capture={(value) => seen.push(value)} />);
  await waitFor(() => expect(seen.at(-1)?.loading).toBe(false));
  await act(async () => {
    await seen.at(-1)?.refresh();
  });
  return () => {
    const value = seen.at(-1);
    if (!value) throw new Error("工作区还没挂上");
    return value;
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await createLocalFolder("f1", "工作", null, 1, NOW);
  await createLocalFolder("f2", "私事", null, 1, NOW);
  // 这一篇在「私事」下：视图停在「工作」时它不在列表里
  await createLocalItem(
    { id: "n2", type: "note", title: "私事下的笔记", folder_id: "f2", body: "正文内容" },
    NOW,
  );
});

afterEach(cleanup);

describe("树里点开视图外的条目", () => {
  it("视图停在「工作」时点开「私事」下的笔记：正文区仍然拿到这一篇", async () => {
    const current = await mountWorkspace(GATE);
    act(() => {
      current().setView({ kind: "notebook", folderId: "f1" });
    });

    await act(async () => {
      await current().open("n2");
    });

    await waitFor(() => expect(current().selected?.id).toBe("n2"));
    // 前提：这一篇确实不在当前视图的列表里（否则这条用例考不到点上）
    expect(current().items.some((item) => item.id === "n2")).toBe(false);
  });

  it("最近编辑 / 收藏这类视图下同样能点开", async () => {
    const current = await mountWorkspace(GATE);
    act(() => {
      current().setView({ kind: "starred" });
    });

    await act(async () => {
      await current().open("n2");
    });

    await waitFor(() => expect(current().selected?.id).toBe("n2"));
  });

  it("锁定时空间内的条目仍然打不开（门禁不被绕过）", async () => {
    await createLocalItem(
      {
        id: "v-note",
        type: "note",
        title: "空间里的笔记",
        folder_id: null,
        body: "锁着的内容",
        inEncSpace: true,
      },
      NOW,
    );
    const current = await mountWorkspace(LOCKED);

    await act(async () => {
      await current().open("v-note");
    });

    expect(current().selected).toBeNull();
  });
});

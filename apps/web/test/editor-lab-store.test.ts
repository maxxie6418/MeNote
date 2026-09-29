/**
 * 编辑试验的存储隔离：只碰自己的钥匙，坏数据退回样文，源码不引用笔记库。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EDITOR_LAB_STORAGE_KEY,
  defaultLabState,
  loadLabState,
  saveLabState,
} from "../src/features/editor-lab/store";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

describe("编辑试验存储", () => {
  it("空存储给出三篇固定样文", () => {
    const state = loadLabState(memoryStorage());
    expect(state.notes.map((note) => note.id)).toEqual(["lab-1", "lab-2", "lab-3"]);
    expect(state.notes.map((note) => note.title)).toEqual(["短文", "代码块", "稍长"]);
  });

  it("只写入试验钥匙，旁边的正式数据不动", () => {
    const storage = memoryStorage({ "menote:notes": "正式笔记" });
    saveLabState(defaultLabState(), storage);
    expect(Object.keys(storage.data)).toEqual(["menote:notes", EDITOR_LAB_STORAGE_KEY]);
    expect(storage.data["menote:notes"]).toBe("正式笔记");
    expect(storage.data[EDITOR_LAB_STORAGE_KEY]).toContain("lab-2");
  });

  it("读回自己写进去的正文，缺的一篇用样文补上", () => {
    const storage = memoryStorage();
    const next = defaultLabState();
    next.notes[0] = { ...next.notes[0], body: "改过的短文" };
    next.selectedId = "lab-2";
    saveLabState(next, storage);
    const raw = JSON.parse(storage.data[EDITOR_LAB_STORAGE_KEY] ?? "{}") as { notes: unknown[] };
    raw.notes = raw.notes.filter((note) => (note as { id: string }).id !== "lab-3");
    storage.data[EDITOR_LAB_STORAGE_KEY] = JSON.stringify(raw);

    const loaded = loadLabState(storage);
    expect(loaded.notes[0]?.body).toBe("改过的短文");
    expect(loaded.notes[2]?.title).toBe("稍长");
    expect(loaded.selectedId).toBe("lab-2");
  });

  it("坏 JSON 或错误版本退回样文，不抛错", () => {
    expect(loadLabState(memoryStorage({ [EDITOR_LAB_STORAGE_KEY]: "{" })).notes[0]?.title).toBe("短文");
    expect(
      loadLabState(memoryStorage({ [EDITOR_LAB_STORAGE_KEY]: JSON.stringify({ version: 2 }) })).notes,
    ).toEqual(defaultLabState().notes);
  });

  it("试验存储模块不引用笔记库", () => {
    const source = readFileSync(new URL("../src/features/editor-lab/store.ts", import.meta.url), "utf8");
    expect(source).not.toContain("data/db");
    expect(source).not.toContain("createLocalNote");
    expect(source).not.toContain("enqueue");
  });
});

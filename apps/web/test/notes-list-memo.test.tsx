// @vitest-environment jsdom
/**
 * 回归：**只有变化的行重渲染**（性能守卫）。
 *
 * 起因：用户反馈"笔记页切换笔记很卡"。真实 Chrome 实测（隔离环境、2000 篇）：
 * 点一行 → 界面换过去要 128–234ms，主线程一条 137–227ms 的长任务；同一路径在 200 篇时只要 28–45ms。
 * 根因是**列表整表重渲染**：`NotesPane` 每次渲染都新建 `list={<NoteList … />}` 与全部内联回调，
 * 编辑器每敲一个字都会让 `workspace` 换身份 → App 重渲染 → 列表 N 行全部重渲染。
 *
 * 这里钉住"行渲染次数"：给每个条目的字段装 getter 计数——**只有真的重渲染那一行，才会再去读它的字段**。
 * 因此这个用例同时守住两件事：
 * 1. 行组件必须被 `memo` 包住（否则选中变化会把 N 行都渲染一遍）；
 * 2. 传给行的 props 必须是原始值或**稳定引用**（否则 `memo` 会失效，N 行照样全渲染）。
 *
 * 先在被修的实现上跑过：50 行、只改选中项 → 50 行全部被渲染（用例红）；修好后 = 2 行。
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NoteList } from "../src/features/notes/ui/NoteList";
import type { LocalItem } from "../src/data/db";

afterEach(cleanup);

const ROW_COUNT = 50;

function baseItem(id: string): LocalItem {
  return {
    id,
    type: "note",
    folder_id: null,
    title: `标题 ${id}`,
    enc_self: 0,
    in_enc_space: 0,
    size_bytes: 10,
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
    created_at: Date.UTC(2026, 8, 27, 10, 0),
    updated_at: Date.UTC(2026, 8, 27, 10, 0),
    last_edit_at: null,
    last_device: null,
    deleted_at: null,
    deleted: false,
    pending: null,
  };
}

/** 行渲染时会读这些字段（id 用不上：它是 key，父组件读它不算行渲染） */
const READ_BY_ROW = [
  "type",
  "folder_id",
  "title",
  "enc_self",
  "in_enc_space",
  "pinned",
  "starred",
  "updated_at",
  "pending",
] as const;

function countingItem(id: string, counts: Map<string, number>): LocalItem {
  const base = baseItem(id);
  const tracked = { ...base };
  for (const key of READ_BY_ROW) {
    const value = base[key];
    Object.defineProperty(tracked, key, {
      get() {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        return value;
      },
      enumerable: true,
      configurable: true,
    });
  }
  return tracked;
}

/** 只统计"本次重置之后被读过字段的行"，等价于"这一轮被重渲染的行" */
function renderedRows(counts: Map<string, number>): string[] {
  return [...counts.keys()].sort();
}

const noop = (): void => undefined;
/** 稳定引用：所有回调与数组都提到渲染之外（真实代码里由 A-2/A-3 的 useCallback/useMemo 保证） */
const ON_SELECT = noop;
const ON_NEW_NOTE = noop;
const ON_MOVE = noop;
const FOLDERS: Array<{ id: string; name: string }> = [];
const UNLOCKED = new Set<string>();

function renderList(
  items: LocalItem[],
  props: { selectedId: string; summaries: Record<string, string> },
): ReturnType<typeof render> {
  return render(
    <NoteList
      items={items}
      title="全部笔记"
      selectedId={props.selectedId}
      loading={false}
      summaries={props.summaries}
      folders={FOLDERS}
      unlockedItemIds={UNLOCKED}
      onSelect={ON_SELECT}
      onNewNote={ON_NEW_NOTE}
      onMove={ON_MOVE}
    />,
  );
}

describe("笔记列表的渲染成本守卫", () => {
  it("只改选中项时，只有旧选中与新选中两行重渲染", () => {
    const counts = new Map<string, number>();
    const items = Array.from({ length: ROW_COUNT }, (_, index) => countingItem(`n${index}`, counts));
    const summaries = {};

    const view = renderList(items, { selectedId: "n1", summaries });
    counts.clear();

    view.rerender(
      <NoteList
        items={items}
        title="全部笔记"
        selectedId="n2"
        loading={false}
        summaries={summaries}
        folders={FOLDERS}
        unlockedItemIds={UNLOCKED}
        onSelect={ON_SELECT}
        onNewNote={ON_NEW_NOTE}
        onMove={ON_MOVE}
      />,
    );

    expect(renderedRows(counts)).toEqual(["n1", "n2"]);
  });

  it("摘要表换了新对象但内容没变时，一行都不重渲染", () => {
    const counts = new Map<string, number>();
    const items = Array.from({ length: ROW_COUNT }, (_, index) => countingItem(`n${index}`, counts));
    const before = Object.fromEntries(items.map((entry) => [entry.id, `摘要 ${entry.id}`]));

    const view = renderList(items, { selectedId: "n1", summaries: before });
    counts.clear();

    // 内容相同、但对象是新的一份（`refresh()` 每次都 `setSummaries` 新对象）
    view.rerender(
      <NoteList
        items={items}
        title="全部笔记"
        selectedId="n1"
        loading={false}
        summaries={{ ...before }}
        folders={FOLDERS}
        unlockedItemIds={UNLOCKED}
        onSelect={ON_SELECT}
        onNewNote={ON_NEW_NOTE}
        onMove={ON_MOVE}
      />,
    );

    expect(renderedRows(counts)).toEqual([]);
  });
});

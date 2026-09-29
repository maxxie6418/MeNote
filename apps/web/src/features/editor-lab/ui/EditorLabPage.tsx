/**
 * 设置 › 编辑试验。
 *
 * 三篇样文和三个快捷框只活在 `menote:editor-lab:v1`。不调用笔记库、不入同步队列。
 * 正文区复用现在的编辑器与预览，好让读数描述的是正在部署的那套，而不是另一套替身。
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { SegmentedControl } from "../../../app/ui/SegmentedControl";
import { Button } from "../../../app/ui/Controls";
import { Icon } from "../../../app/ui/Icon";
import {
  attributeLongTask,
  labNow,
  retainRecentLongTasks,
  summarizeLongTasks,
  type LabAction,
  type LabLongTask,
} from "../perf";
import {
  defaultLabState,
  loadLabState,
  saveLabState,
  type LabMode,
  type LabNote,
  type LabQuick,
  type LabState,
} from "../store";

const Editor = lazy(async () => {
  const mod = await import("../../../app/editor/Editor");
  return { default: mod.Editor };
});

const MarkdownPreview = lazy(async () => {
  const mod = await import("../../../app/editor/MarkdownPreview");
  return { default: mod.MarkdownPreview };
});

const MODE_OPTIONS: ReadonlyArray<{ value: LabMode; label: string }> = [
  { value: "split", label: "双栏" },
  { value: "edit", label: "仅编辑" },
  { value: "preview", label: "仅预览" },
  { value: "live", label: "即时渲染" },
];

const QUICK_FIELDS: ReadonlyArray<{ key: keyof LabQuick; label: string }> = [
  { key: "memo", label: "Memo 快捷录入" },
  { key: "task", label: "待办快捷录入" },
  { key: "note", label: "笔记快捷录入" },
];

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function EditorLabPage() {
  const [state, setState] = useState<LabState>(() => loadLabState(browserStorage()));
  const [actions, setActions] = useState<LabAction[]>([]);
  const [longTasks, setLongTasks] = useState<LabLongTask[]>([]);
  const [longTaskSupported, setLongTaskSupported] = useState(
    () => typeof PerformanceObserver !== "undefined",
  );
  const [instances, setInstances] = useState(0);
  const actionsRef = useRef(actions);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const selected = state.notes.find((note) => note.id === state.selectedId) ?? state.notes[0];

  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
    const timer = setTimeout(() => {
      const storage = browserStorage();
      if (storage) saveLabState(state, storage);
    }, 400);
    return () => clearTimeout(timer);
  }, [state]);
  useEffect(
    () => () => {
      const storage = browserStorage();
      if (storage) saveLabState(stateRef.current, storage);
    },
    [],
  );

  useEffect(() => {
    if (!longTaskSupported) return undefined;
    let observer: PerformanceObserver;
    try {
      observer = new PerformanceObserver((list) => {
        const next = list.getEntries().map((entry) => ({
          startedAt: entry.startTime,
          ms: Math.round(entry.duration),
          after: attributeLongTask(actionsRef.current, entry.startTime),
        }));
        if (next.length === 0) return;
        const now = labNow();
        setLongTasks((previous) => retainRecentLongTasks([...previous, ...next], now).slice(-30));
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      queueMicrotask(() => setLongTaskSupported(false));
      return undefined;
    }
    return () => observer.disconnect();
  }, [longTaskSupported]);

  function beginAction(label: string): void {
    const startedAt = labNow();
    const action: LabAction = { label, startedAt, paintMs: null };
    setActions((previous) => [...previous, action].slice(-20));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const paintMs = Math.round(labNow() - startedAt);
        setActions((previous) =>
          previous.map((item) => (item.startedAt === startedAt ? { ...item, paintMs } : item)),
        );
        const root = stageRef.current;
        setInstances(root ? root.querySelectorAll("[data-editor]").length : 0);
      });
    });
  }

  function selectNote(id: LabNote["id"]): void {
    const note = state.notes.find((item) => item.id === id);
    beginAction(`切到「${note?.title ?? id}」`);
    setState((previous) => ({ ...previous, selectedId: id }));
  }

  function selectMode(mode: LabMode): void {
    const label = MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
    beginAction(`切到${label}`);
    setState((previous) => ({ ...previous, mode }));
  }

  function editBody(body: string): void {
    setState((previous) => ({
      ...previous,
      notes: previous.notes.map((note) =>
        note.id === previous.selectedId ? { ...note, body } : note,
      ) as LabState["notes"],
    }));
  }

  function editQuick(key: keyof LabQuick, value: string): void {
    setState((previous) => ({ ...previous, quick: { ...previous.quick, [key]: value } }));
  }

  function reset(): void {
    const storage = browserStorage();
    const next = defaultLabState();
    if (storage) saveLabState(next, storage);
    setState(next);
    beginAction("恢复样文");
  }

  const latest = [...actions].reverse().find((action) => action.paintMs !== null) ?? null;
  const taskSummary = summarizeLongTasks(longTasks);

  return (
    <div className="editor-lab">
      <p className="panel-hint" role="status">
        这三篇和下面三个框只存在于本机的试验存储，不写入笔记、不上传、不出现在列表或搜索里。
      </p>

      {/*
        试验区是这一页的主角，放开 `.setcard` 的 790px 上限——330px 列表挤在里面，
        双栏每边只剩两百多像素，正是上一版看起来乱的原因。其余两张卡仍按设置页常规宽度居中。
      */}
      <section className="setcard setcard--wide" aria-label="试验笔记">
        <h3 className="setcard__title">试验笔记</h3>
        <div className="editor-lab__workspace">
          <aside className="listpane" aria-label="试验笔记列表">
            <div className="listpane__head">
              <h2 className="listpane__title">样文</h2>
              <span className="listpane__count">{state.notes.length} 篇</span>
            </div>
            <div className="listpane__scroll">
              {state.notes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className="itemrow"
                  aria-label={note.title}
                  aria-current={note.id === selected.id}
                  onClick={() => selectNote(note.id)}
                >
                  <span className="itemrow__ico" aria-hidden="true">
                    <Icon name="note" size={13} />
                  </span>
                  <span className="itemrow__main">
                    <span className="itemrow__title">{note.title}</span>
                    <span className="itemrow__excerpt">{excerptOf(note.body)}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="editor-lab__listfoot">
              <Button variant="secondary" size="sm" onClick={reset}>
                恢复样文
              </Button>
            </div>
          </aside>
          <section className="docpane" aria-label="试验正文">
            <div className="docpane__head">
              <h2 className="editor-lab__doctitle">{selected.title}</h2>
              <SegmentedControl
                ariaLabel="试验编辑模式"
                size="compact"
                options={MODE_OPTIONS}
                value={state.mode}
                onChange={selectMode}
              />
            </div>
            <div
              ref={stageRef}
              className="docpane__body"
              onKeyDown={(event) => {
                if (event.repeat || event.isComposing) return;
                if (event.ctrlKey || event.metaKey || event.altKey) return;
                if (event.key === "Shift") return;
                beginAction("按键");
              }}
            >
              <Suspense fallback={<div className="docpane__center">编辑器加载中…</div>}>
                <LabStage note={selected} mode={state.mode} onChange={editBody} />
              </Suspense>
            </div>
          </section>
        </div>
      </section>

      <section className="setcard" aria-label="性能">
        <h3 className="setcard__title">性能</h3>
        <p className="editor-lab__stat">
          最近动作
          {latest
            ? `：${latest.label}，到下一帧 ${latest.paintMs} ms`
            : "：还没有。切换笔记或模式后这里会出毫秒数。"}
        </p>
        <p className="editor-lab__stat">本页编辑器实例：{instances}</p>
        {longTaskSupported ? (
          <p className="editor-lab__stat">
            近一分钟长任务 {taskSummary.count} 次
            {taskSummary.latest
              ? `，最近 ${taskSummary.latest.ms} ms${
                  taskSummary.latest.after ? `，紧跟在「${taskSummary.latest.after}」之后` : "，对不上刚才的动作"
                }。最长 ${taskSummary.maxMs} ms。`
              : "。超过 50 ms 的主线程阻塞会出现在这里。"}
          </p>
        ) : (
          <p className="editor-lab__stat">这个浏览器不提供长任务记录，只能看上面的动作耗时。</p>
        )}
      </section>

      <section className="setcard" aria-label="快捷录入试验">
        <h3 className="setcard__title">快捷录入</h3>
        <p className="editor-lab__stat">三个框与正文分开存。`@` 和 `/` 还没接上，这里先确认输入本身不串到正式数据。</p>
        {QUICK_FIELDS.map((field) => (
          <label key={field.key} className="editor-lab__quick">
            <span>{field.label}</span>
            <textarea
              aria-label={field.label}
              value={state.quick[field.key]}
              rows={3}
              onChange={(event) => editQuick(field.key, event.target.value)}
            />
          </label>
        ))}
      </section>
    </div>
  );
}

function excerptOf(body: string): string {
  const line = body
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item !== "" && !item.startsWith("#"));
  if (!line) return "没有正文";
  return line.replace(/[*`]/g, "").slice(0, 42);
}

function LabStage({
  note,
  mode,
  onChange,
}: {
  note: LabNote;
  mode: LabMode;
  onChange: (body: string) => void;
}) {
  if (mode === "preview") {
    return (
      <div className="doc-split__pane">
        <MarkdownPreview source={note.body} />
      </div>
    );
  }
  if (mode === "split") {
    return (
      <div className="doc-split">
        <div className="doc-split__pane">
          <Editor
            key={note.id}
            initialValue={note.body}
            onChange={onChange}
            ariaLabel={`${note.title}的试验正文`}
          />
        </div>
        <div className="doc-split__pane">
          <MarkdownPreview source={note.body} />
        </div>
      </div>
    );
  }
  return (
    <div className="doc-split__pane">
      <Editor
        key={note.id}
        initialValue={note.body}
        onChange={onChange}
        live={mode === "live"}
        ariaLabel={`${note.title}的试验正文`}
      />
    </div>
  );
}

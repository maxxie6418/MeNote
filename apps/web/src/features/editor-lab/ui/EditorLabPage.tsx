/**
 * 设置 › 编辑试验。
 *
 * 三篇样文和三个快捷框只活在 `menote:editor-lab:v1`。不调用笔记库、不入同步队列。
 * 正文区复用现在的编辑器与预览，好让读数描述的是正在部署的那套，而不是另一套替身。
 *
 * `/` 命令（编辑拓展阶段 B / Task B3）：正文与三个快捷框都能唤出，但它们**共用**
 * `app/editor/format-commands.ts` 那一套纯函数——命令结果只落进本页的试验存储，
 * 既不写 `menote:notes`，也没有任何发布通道。
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { CommandMenu, type CommandMenuProps } from "../../../app/editor/CommandMenu";
import {
  FORMAT_COMMANDS,
  QUICK_FORMAT_COMMANDS,
  type FormatCommandId,
  type TextSelection,
} from "../../../app/editor/format-commands";
import { applyFormatAt, triggerAt } from "../../../app/editor/trigger";
import type { EditorHandle, EditorProps } from "../../../app/editor/Editor";
import { SegmentedControl } from "../../../app/ui/SegmentedControl";
import { Button } from "../../../app/ui/Controls";
import { Icon } from "../../../app/ui/Icon";
import {
  EditorLifecycleCounter,
  attributeLongTask,
  labNow,
  retainRecentLongTasks,
  summarizeLongTasks,
  type LabAction,
  type LabLifecycleSnapshot,
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

/** `/` 菜单挂在谁身上：正文区，或三个快捷框之一 */
type LabTarget = "body" | keyof LabQuick;

interface LabSlash {
  target: LabTarget;
  query: string;
  /** 触发词里 `/` 的位置（正文区只能拿到查询文本，记 -1） */
  start: number;
}

/**
 * 快捷框里的 `/` 触发词与命令执行。
 *
 * 判定与"吃掉触发段"都走 `app/editor/trigger.ts`（与正文编辑器、快捷输入同一份实现；
 * 那个模块不依赖 CodeMirror，所以不会把编辑器拖进本页的初始包）。
 */
function quickSlashAt(value: string, caret: number): { query: string; start: number } | null {
  const matched = triggerAt(value, caret, ["/"]);
  return matched ? { query: matched.query, start: matched.start } : null;
}

/**
 * 在快捷框里执行一条命令。返回的新选区要宿主自己落回 `textarea`
 * ——受控组件重设 `value` 会把光标丢到末尾。
 */
function applyQuickFormat(
  value: string,
  caret: number,
  command: FormatCommandId,
): { text: string; selection: TextSelection } {
  const result = applyFormatAt(value, { from: caret, to: caret }, command, ["/"]);
  return { text: result.text, selection: result.selection };
}

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
  const [slash, setSlash] = useState<LabSlash | null>(null);
  const [counter] = useState(() => new EditorLifecycleCounter());
  const [lifecycle, setLifecycle] = useState<LabLifecycleSnapshot>(() => counter.snapshot());
  const actionsRef = useRef(actions);
  const handleRef = useRef<EditorHandle | null>(null);
  /** Esc 关掉的那次触发词：查询没退化就不自动弹回（见 `updateSlash`） */
  const dismissedRef = useRef<{ target: LabTarget; query: string } | null>(null);
  /** 命令给出的选区，等 React 更新完 `value` 后落回输入框 */
  const pendingSelectionRef = useRef<TextSelection | null>(null);
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

  // 命令刚执行完：把光标落回命令给出的位置，否则用户接着打字会落在标记外面
  useEffect(() => {
    const pending = pendingSelectionRef.current;
    pendingSelectionRef.current = null;
    if (!pending) return;
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement) active.setSelectionRange(pending.from, pending.to);
  }, [state.quick]);

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
      });
    });
  }

  /**
   * 更新触发词。Esc 关掉的触发词**不再自动弹回**：只要查询还是同一族（前缀没变）就保持关闭
   * ——否则按 Esc 之后随便敲一个键菜单又跳出来，等于没关。删掉 `/` 重打会重新触发（那时报 null）。
   */
  function updateSlash(target: LabTarget, trigger: { query: string; start: number } | null): void {
    if (!trigger) {
      dismissedRef.current = null;
      setSlash(null);
      return;
    }
    const dismissed = dismissedRef.current;
    if (dismissed?.target === target && trigger.query.startsWith(dismissed.query)) return;
    dismissedRef.current = null;
    setSlash({ target, query: trigger.query, start: trigger.start });
  }

  /** `dismiss` 为真（Esc / 点了菜单外）时记住这次触发词；选中命令或换文档时不留。 */
  function closeSlash(dismiss: boolean): void {
    dismissedRef.current = dismiss && slash ? { target: slash.target, query: slash.query } : null;
    setSlash(null);
  }

  function chooseCommand(command: FormatCommandId): void {
    const open = slash;
    closeSlash(false);
    if (!open) return;
    if (open.target === "body") {
      // 触发词由编辑器自己删（它有 view.state，宿主拿不到光标坐标）
      handleRef.current?.applyFormat(command);
      return;
    }
    const caret = open.start + 1 + open.query.length;
    const result = applyQuickFormat(state.quick[open.target], caret, command);
    pendingSelectionRef.current = result.selection;
    editQuick(open.target, result.text);
  }

  function selectNote(id: LabNote["id"]): void {
    const note = state.notes.find((item) => item.id === id);
    beginAction(`切到「${note?.title ?? id}」`);
    closeSlash(false);
    setState((previous) => ({ ...previous, selectedId: id }));
  }

  function selectMode(mode: LabMode): void {
    const label = MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
    beginAction(`切到${label}`);
    closeSlash(false);
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

  /** 快捷框输入：先存值，再按新光标重新判定 `/` 触发词 */
  function editQuickFromInput(key: keyof LabQuick, value: string, caret: number): void {
    editQuick(key, value);
    updateSlash(key, quickSlashAt(value, caret));
  }

  function reset(): void {
    const storage = browserStorage();
    const next = defaultLabState();
    if (storage) saveLabState(next, storage);
    closeSlash(false);
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
              className="docpane__body"
              onKeyDown={(event) => {
                // `isComposing` 只在**原生** KeyboardEvent 上（React 的合成事件类型里没有它）；
                // 输入法组合期间不算"用户按键"，否则读数会被候选词翻页污染
                if (event.repeat || event.nativeEvent.isComposing) return;
                if (event.ctrlKey || event.metaKey || event.altKey) return;
                if (event.key === "Shift") return;
                beginAction("按键");
              }}
            >
              <Suspense fallback={<div className="docpane__center">编辑器加载中…</div>}>
                <LabStage
                  note={selected}
                  mode={state.mode}
                  counter={counter}
                  onLifecycle={setLifecycle}
                  onChange={editBody}
                  onHandle={(handle) => {
                    handleRef.current = handle;
                  }}
                  onSlashQuery={(query) =>
                    updateSlash("body", query === null ? null : { query, start: -1 })
                  }
                />
              </Suspense>
              {slash?.target === "body" ? (
                <div className="editor-lab__menu-anchor">
                  <LabCommandMenu
                    counter={counter}
                    onReport={setLifecycle}
                    open
                    query={slash.query}
                    commands={FORMAT_COMMANDS}
                    onChoose={chooseCommand}
                    onClose={() => closeSlash(true)}
                  />
                </div>
              ) : null}
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
        <p className="editor-lab__stat">本页编辑器实例：{lifecycle.activeEditors}</p>
        <p className="editor-lab__stat">本页事件监听：{lifecycle.activeListeners}</p>
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
        <p className="editor-lab__stat">
          三个框与正文分开存。`/` 已经能唤出基础命令，改的只有这里的试验存储；`@` 还没接上。
        </p>
        {QUICK_FIELDS.map((field) => (
          <div key={field.key} className="editor-lab__quick">
            <label htmlFor={`lab-quick-${field.key}`}>{field.label}</label>
            <div className="editor-lab__quick-input">
              <textarea
                id={`lab-quick-${field.key}`}
                aria-label={field.label}
                value={state.quick[field.key]}
                rows={3}
                onChange={(event) =>
                  editQuickFromInput(
                    field.key,
                    event.currentTarget.value,
                    event.currentTarget.selectionStart,
                  )
                }
              />
              {slash?.target === field.key ? (
                <LabCommandMenu
                  counter={counter}
                  onReport={setLifecycle}
                  open
                  query={slash.query}
                  commands={QUICK_FORMAT_COMMANDS}
                  onChoose={chooseCommand}
                  onClose={() => closeSlash(true)}
                />
              ) : null}
            </div>
          </div>
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
  counter,
  onLifecycle,
  onChange,
  onHandle,
  onSlashQuery,
}: {
  note: LabNote;
  mode: LabMode;
  counter: EditorLifecycleCounter;
  onLifecycle: (snapshot: LabLifecycleSnapshot) => void;
  onChange: (body: string) => void;
  onHandle: (handle: EditorHandle) => void;
  onSlashQuery: (query: string | null) => void;
}) {
  if (mode === "preview") {
    return (
      <div className="doc-split__pane">
        <MarkdownPreview source={note.body} />
      </div>
    );
  }
  const editor = (
    <LabBodyEditor
      key={note.id}
      initialValue={note.body}
      onChange={onChange}
      live={mode === "live"}
      ariaLabel={`${note.title}的试验正文`}
      counter={counter}
      onLifecycle={onLifecycle}
      onHandle={onHandle}
      onSlashQuery={onSlashQuery}
    />
  );
  if (mode === "split") {
    return (
      <div className="doc-split">
        <div className="doc-split__pane">{editor}</div>
        <div className="doc-split__pane">
          <MarkdownPreview source={note.body} />
        </div>
      </div>
    );
  }
  return <div className="doc-split__pane">{editor}</div>;
}

/**
 * `/` 菜单的外壳：菜单打开时 `CommandMenu` 会把 `keydown` 挂到 `document` 上、关闭即撤，
 * 这一层把"挂上了 / 撤下了"报给计数器（与 `LabBodyEditor` 同一套做法）。
 *
 * 宿主只在菜单打开期间渲染它，所以这一层 effect 的挂/卸**就是**那条监听的生命周期。
 */
function LabCommandMenu({
  counter,
  onReport,
  ...menuProps
}: CommandMenuProps & {
  counter: EditorLifecycleCounter;
  onReport: (snapshot: LabLifecycleSnapshot) => void;
}) {
  useEffect(() => {
    onReport(counter.listenerAttached());
    return () => {
      onReport(counter.listenerDetached());
    };
  }, [counter, onReport]);

  return <CommandMenu {...menuProps} />;
}

/**
 * 正文试验的编辑器外壳：把"编辑器挂上了 / 卸掉了"变成这一页的读数。
 *
 * 上报放在 React 提交阶段（effect 的挂/卸）而不是等 `Editor` 的 `onReady`：`Editor` 只在挂载时
 * 创建视图，所以这一层 effect 与视图的建/毁一一对应，**卸载也会走到**——只报挂不报卸，
 * 切换几十次之后读数就再也回不到基线了。
 */
function LabBodyEditor({
  counter,
  onLifecycle,
  onHandle,
  ...editorProps
}: EditorProps & {
  counter: EditorLifecycleCounter;
  onLifecycle: (snapshot: LabLifecycleSnapshot) => void;
  onHandle: (handle: EditorHandle) => void;
}) {
  useEffect(() => {
    onLifecycle(counter.editorCreated());
    return () => {
      onLifecycle(counter.editorDestroyed());
    };
  }, [counter, onLifecycle]);

  return <Editor {...editorProps} onReady={onHandle} />;
}

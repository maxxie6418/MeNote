/**
 * 全局快捷键框架（应用级和弦，不是编辑器里的 `@` / `/`）。
 *
 * 两张登记表，都是「注册后返回取消函数」：
 * - **和弦**：`Ctrl/Cmd+S` 这类按键。新快捷键在这里登记一条，不要再往 `document` 上加监听。
 * - **编辑会话**：谁正在编辑、怎么把未落盘的改动写下去。`Ctrl/Cmd+S` 先冲刷所有活跃会话，再同步。
 *
 * `@` 与 `/` 是编辑器输入触发，不属于这里（见 `docs/modules/Menote-编辑拓展-设计-v1.md`）。
 */
export interface ShortcutChord {
  /** 小写字母或 `KeyboardEvent.key` 的小写形式（`k`、`s`、`enter`） */
  key: string;
  /** `Ctrl` 或 `Cmd`（macOS）。两者都算，调用方不要分平台。 */
  mod: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  preventDefault?: () => void;
}

export interface ShortcutBinding {
  id: string;
  chord: ShortcutChord;
  /**
   * 同一和弦多条时，**数字小的先执行**（后注册的同优先级不会插到前面）。
   * 内置三条用 10 / 20 / 30，后来的功能插在缝里即可。
   */
  priority: number;
  run: (event: KeyEventLike) => void;
}

export interface EditingSession {
  id: string;
  /** 此刻算不算「正在编辑」。不算的会话不会被 `Ctrl/Cmd+S` 冲刷。 */
  isActive: () => boolean;
  /** 把未落盘的改动写入本地并入队。没有改动时应当直接返回。 */
  flush: () => void | Promise<void>;
}

const bindings: ShortcutBinding[] = [];
const sessions = new Map<string, EditingSession>();

/** 和弦是否命中。组合中、按住重复，一律不当命中——避免输入法和连发把保存打成一串。 */
export function matchesChord(event: KeyEventLike, chord: ShortcutChord): boolean {
  if (event.isComposing || event.repeat) return false;
  if (event.key.toLowerCase() !== chord.key) return false;
  if ((event.ctrlKey || event.metaKey) !== chord.mod) return false;
  if (event.shiftKey !== Boolean(chord.shift)) return false;
  if (event.altKey !== Boolean(chord.alt)) return false;
  return true;
}

export function registerShortcut(binding: ShortcutBinding): () => void {
  bindings.push(binding);
  bindings.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  return () => {
    const index = bindings.indexOf(binding);
    if (index >= 0) bindings.splice(index, 1);
  };
}

/** 命中的那一条；没有则 `null`。同和弦取优先级最小的。 */
export function findShortcut(event: KeyEventLike): ShortcutBinding | null {
  return bindings.find((binding) => matchesChord(event, binding.chord)) ?? null;
}

/** 命中则执行并返回 `true`。调用方据此决定要不要再往下传。 */
export function dispatchShortcut(event: KeyEventLike): boolean {
  const binding = findShortcut(event);
  if (!binding) return false;
  event.preventDefault?.();
  binding.run(event);
  return true;
}

export function registerEditingSession(session: EditingSession): () => void {
  sessions.set(session.id, session);
  return () => {
    if (sessions.get(session.id) === session) sessions.delete(session.id);
  };
}

export function activeEditingSessions(): EditingSession[] {
  return [...sessions.values()].filter((session) => session.isActive());
}

/** 冲刷所有活跃会话。返回冲刷了几条，便于测试和以后的状态提示。 */
export async function flushActiveEditingSessions(): Promise<number> {
  const active = activeEditingSessions();
  for (const session of active) {
    await session.flush();
  }
  return active.length;
}

/**
 * 已有对话框时不再叠一个「添加」窗口。
 * 浏览器的「新窗口」仍然要被拦住——那一步在和弦处理里 `preventDefault`，与这里无关。
 */
export function canOpenNewMemo(dialogOpen: boolean): boolean {
  return !dialogOpen;
}

/** 测试隔离。生产代码不要调用。 */
export function resetShortcutsForTests(): void {
  bindings.splice(0, bindings.length);
  sessions.clear();
}

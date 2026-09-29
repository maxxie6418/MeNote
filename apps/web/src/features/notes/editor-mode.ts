/**
 * 正文区「上次用的那一档」（用户 2026-09-29 拍板：设置里不再有"默认档"这一说，
 * 打开笔记就用**上次离开时的那一档**）。
 *
 * 为什么记在**本机**（`localStorage`）而不是跟着账号同步：
 * 1. 它是**设备级**偏好，与主题同类——手机与桌面各用各的档很正常，而设置那份是"跟随账号"的；
 * 2. 在正文区切档是高频动作，每切一次写一次服务端会给同步添噪声（主题当初也是这个理由）。
 *
 * 读出来的一律是"合法且当前还开着"的档；任何坏值（手改过、用户后来关掉了那一档）
 * 都静默回落到兜底档，绝不把正文卡住。
 */
import type { EditorMode } from "@menote/shared";

/** 本机记住的键名（与 `menote:privacy:device-unlocked` 同一命名习惯） */
export const LAST_EDITOR_MODE_KEY = "menote:editor:last-mode";

const KNOWN_MODES: readonly EditorMode[] = ["split", "edit", "preview", "live"];

function isEditorMode(value: string | null): value is EditorMode {
  return value !== null && (KNOWN_MODES as readonly string[]).includes(value);
}

/** 读出"上次用的那档"；没记过或记的值不认识 → `null` */
export function readLastEditorMode(): EditorMode | null {
  try {
    const raw = globalThis.localStorage?.getItem(LAST_EDITOR_MODE_KEY) ?? null;
    return isEditorMode(raw) ? raw : null;
  } catch {
    // 隐私模式 / 无 localStorage：当作"没记过"
    return null;
  }
}

/** 记下"这次用的是哪一档"；写不进去也不影响切换本身 */
export function writeLastEditorMode(mode: EditorMode): void {
  try {
    globalThis.localStorage?.setItem(LAST_EDITOR_MODE_KEY, mode);
  } catch {
    // 同上：退化成"这次没记住"，不报错、不打断写正文
  }
}

/**
 * 打开一篇笔记时用哪一档：**本机记住的**（且用户还开着它）→ 设置里的首次初始值
 * （`editor_mode`，同样要开着）→ 还开着的第一档。
 *
 * `available` 由 `normalizeEditorModes` 保证非空，所以这里必有返回值。
 */
export function initialEditorMode(
  available: readonly EditorMode[],
  seed: EditorMode | undefined,
): EditorMode {
  const last = readLastEditorMode();
  if (last && available.includes(last)) return last;
  if (seed && available.includes(seed)) return seed;
  return available[0] ?? "split";
}

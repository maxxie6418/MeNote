/**
 * Memo 的时间轴逻辑（功能拆解 M06-03；需求 §8.4）。
 *
 * 三条要点：
 * 1. **按天分组**，天边界要按**设置时区**算（默认 `Asia/Shanghai`）——不能用本机时区，
 *    否则同一批 Memo 在不同设备上会分到不同的日子（用户会看到"每天都不一样"）。
 * 2. 置顶的 Memo 显示在时间轴最上方（Q9）；其余按 `memo_at` 倒序。
 * 3. 顶部支持标签筛选与日期范围筛选（需求 §8.4），两者是纯函数、便于单测。
 *
 * 这里只用 `Intl.DateTimeFormat`，不引时区库：只需要"某个时刻落在哪个日历日"。
 */

/** 设置项的默认时区（M2-7 设置页接入后从用户设置读） */
export const DEFAULT_TIME_ZONE = "Asia/Shanghai";

export interface MemoLike {
  id: string;
  memo_at: number | null;
  pinned: number;
  tags: string[];
  is_task: number;
}

/** 取某个时刻在指定时区下的日历日键（`YYYY-MM-DD`） */
export function dayKeyInZone(epochMs: number, timeZone: string = DEFAULT_TIME_ZONE): string {
  // en-CA 的短日期就是 ISO 形式，省掉手工拼装
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochMs));
}

/** 时间轴上的日期标题，如「9月26日 周六」 */
export function dayLabelInZone(epochMs: number, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(epochMs));
}

/** 时刻文案，如「14:05」 */
export function timeLabelInZone(epochMs: number, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(epochMs));
}

/** 置顶在前，其余按 `memo_at` 倒序（Q9） */
export function sortMemos<T extends MemoLike>(memos: readonly T[]): T[] {
  return [...memos].sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned;
    return (b.memo_at ?? 0) - (a.memo_at ?? 0);
  });
}

export interface MemoDay<T extends MemoLike> {
  dayKey: string;
  dayLabel: string;
  memos: T[];
}

/** 按天分组（天边界按 `timeZone`），天与天内都保持倒序 */
export function groupMemosByDay<T extends MemoLike>(
  memos: readonly T[],
  timeZone: string = DEFAULT_TIME_ZONE,
): Array<MemoDay<T>> {
  const sorted = sortMemos(memos).filter((memo) => memo.memo_at !== null);
  const days = new Map<string, MemoDay<T>>();

  for (const memo of sorted) {
    const at = memo.memo_at ?? 0;
    const dayKey = dayKeyInZone(at, timeZone);
    const existing = days.get(dayKey);
    if (existing) {
      existing.memos.push(memo);
      continue;
    }
    days.set(dayKey, { dayKey, dayLabel: dayLabelInZone(at, timeZone), memos: [memo] });
  }

  return [...days.values()];
}

export const MEMO_RANGES = [
  { value: "all", label: "全部" },
  { value: "today", label: "今天" },
  { value: "week", label: "近 7 天" },
  { value: "month", label: "近 30 天" },
] as const;

export type MemoRange = (typeof MEMO_RANGES)[number]["value"];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MemoFilter {
  tag: string | null;
  range: MemoRange;
}

export const EMPTY_FILTER: MemoFilter = { tag: null, range: "all" };

/**
 * 标签 + 日期范围筛选。
 *
 * 日期范围的边界按**时区下的当天 0 点**起算：`today` = 与"现在"同一个日历日；
 * `week`/`month` 从当天 0 点往前推 6/29 天（"近 7 天"含今天）。
 */
export function filterMemos<T extends MemoLike>(
  memos: readonly T[],
  filter: MemoFilter,
  now: number,
  timeZone: string = DEFAULT_TIME_ZONE,
): T[] {
  const startOfToday = startOfDayInZone(now, timeZone);
  const lowerBound =
    filter.range === "all"
      ? Number.NEGATIVE_INFINITY
      : filter.range === "today"
        ? startOfToday
        : filter.range === "week"
          ? startOfToday - 6 * DAY_MS
          : startOfToday - 29 * DAY_MS;

  return memos.filter((memo) => {
    if (filter.tag !== null && !memo.tags.includes(filter.tag)) return false;
    if (memo.memo_at === null) return filter.range === "all";
    return memo.memo_at >= lowerBound;
  });
}

/** 某个时刻所在时区的当天 0 点（用"时区下的日期 + 时区偏移"反解，避免手工算偏移） */
export function startOfDayInZone(epochMs: number, timeZone: string = DEFAULT_TIME_ZONE): number {
  const dayKey = dayKeyInZone(epochMs, timeZone); // YYYY-MM-DD
  // 把该日期的 00:00 当作 UTC 解析，再按"该时刻在目标时区的时差"校正
  const asUtc = Date.parse(`${dayKey}T00:00:00Z`);
  const offsetMs = zonedOffsetMs(asUtc, timeZone);
  return asUtc - offsetMs;
}

/** 目标时刻在给定时区相对 UTC 的偏移（毫秒） */
function zonedOffsetMs(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(epochMs));

  const pick = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(
    pick("year"),
    pick("month") - 1,
    pick("day"),
    pick("hour") % 24,
    pick("minute"),
    pick("second"),
  );
  return asIfUtc - epochMs;
}

/** 时间轴顶部标签筛选的可选项（按出现次数倒序） */
export function collectMemoTags(memos: readonly MemoLike[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const memo of memos) {
    for (const tag of memo.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-Hans-CN"));
}

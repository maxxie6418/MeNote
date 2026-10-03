/**
 * 通用格式化（`app/` 层，两个以上 feature 都要用才放这里）。
 *
 * **只放纯函数**：不引依赖、不调 `Intl`——相对时间的口径要能单测，
 * 也不能因为运行环境的 locale 变掉（`Intl.RelativeTimeFormat` 会）。
 *
 * 原来它住在 `features/mcp/model.ts`（M6）。定时备份要在设置页上写「最近备份 3 小时前」，
 * 从备份 feature 去 import MCP feature 的 model 是**反向依赖**——两条业务线互不认识，
 * 一条删了另一条就断。所以提到这一层，由两边各自 import。
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;

/** 相对时间；`null` 给「还没用过」这类口径（`fallback` 由调用方按语义给） */
export function formatRelative(timestamp: number | null, now: number, fallback: string): string {
  if (timestamp === null) return fallback;
  const delta = Math.max(0, now - timestamp);
  if (delta < MINUTE) return "刚刚";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} 分钟前`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)} 小时前`;
  if (delta < MONTH) return `${Math.floor(delta / DAY)} 天前`;
  return `${Math.floor(delta / MONTH)} 个月前`;
}

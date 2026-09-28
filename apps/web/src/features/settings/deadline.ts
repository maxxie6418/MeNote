/**
 * 注册开关「到期日」的换算（纯函数，便于单测）。
 *
 * 两个约定：
 * 1. **到期日按当天结束**（`23:59:59.999` 本地时间）——用户填"今天"就该今天还能注册，
 *    而不是填完立刻关闭（服务端按 `close_at > now` 判开放）。
 * 2. **`0` = 不自动到期**（契约里 `close_at` 的既定含义），所以"清空日期"要显式传 0。
 */
export function toDeadlineTimestamp(value: string): number {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!matched) return 0;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  return Number.isNaN(end.getTime()) ? 0 : end.getTime();
}

/** 时间戳 → `YYYY-MM-DD`（本地时区）；`0` → 空串（日期输入框的空值） */
export function toDeadlineValue(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

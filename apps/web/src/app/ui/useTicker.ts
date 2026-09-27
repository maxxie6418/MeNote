/**
 * 每秒重渲染的计时钩子（M3-10）。
 *
 * 用途只有一处：**把"还剩多久"显示出来**（顶栏胶囊的倒计时、状态栏的自动锁定提示）。
 * 状态机本身只在到期那一刻变化、平时不重渲染，所以界面要自己 tick。
 *
 * 抽成共享件是因为胶囊与状态栏两处都要它——两处各写一遍很容易在"什么时候停表"上走偏。
 */
import { useEffect, useState } from "react";

/** `active` 为真时每秒重渲染一次，并返回当前时间（毫秒） */
export function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);

  return now;
}

/**
 * 量滚动容器，算出当前该渲染哪一段行（M4-9；《M4 界面稿》§2.9）。
 *
 * 只做"读 DOM"这一件事，窗口计算全在 `model.ts` 的 `windowRange` 里（纯函数、可单测）——
 * 于是这个 hook 薄到只剩三件事：拿容器、听滚动、量高度。
 *
 * 量不出来（jsdom 里 `clientHeight` 恒为 0）时 `viewportHeight` 为 0，`windowRange` 会
 * 直接退化成"全渲染"，所以组件在测试环境里仍然是完整 DOM，断言照写。
 */
import { useEffect, useRef, useState } from "react";
import { DEFAULT_ROW_HEIGHT, VIRTUAL_ROW_THRESHOLD, windowRange, type WindowRange } from "../model";

export function useVirtualWindow(rowCount: number, rowHeight = DEFAULT_ROW_HEIGHT): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  range: WindowRange;
} {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const enabled = rowCount > VIRTUAL_ROW_THRESHOLD;

  useEffect(() => {
    const node = containerRef.current;
    if (!enabled || !node) return undefined;

    const measure = (): void => setViewportHeight(node.clientHeight);
    measure();

    const onScroll = (): void => setScrollTop(node.scrollTop);
    node.addEventListener("scroll", onScroll, { passive: true });

    // 窗口尺寸变化时视口高度会变；没有 ResizeObserver 的环境（老浏览器/jsdom 的部分实现）就跳过
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);

    return () => {
      node.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [enabled]);

  return {
    containerRef,
    range: windowRange({ rowCount, rowHeight, scrollTop, viewportHeight }),
  };
}

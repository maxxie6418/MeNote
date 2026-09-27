/**
 * `DESIGN.md` §5.1 的界面规则断言（渲染层；2026-09-27 建）。
 *
 * 规则原文：「每个界面区域**最多一个主操作**」「【禁止】同一区域出现两个并列的实心主色按钮」
 * （`DESIGN.md` §5.1 + 禁止项 #6）。主操作的样式就是 `.btn--primary`。
 *
 * 粒度说明：断言的容器要对应**一个界面区域**（一张卡片、一个面板、一个正文区），
 * 不是"整个页面"——页面由多个区域组成，每个区域各有一个主操作是允许的。
 * 屏测试里渲染的通常是单个面板，直接传它的容器即可。
 */
import { expect } from "vitest";

/** 主操作的样式类（`Button` 的 `variant="primary"` → `btn--primary`） */
export const PRIMARY_SELECTOR = ".btn--primary";

/** 把一个元素的可读名字取出来（用于断言失败的提示信息） */
function nameOf(element: Element): string {
  return (
    element.getAttribute("aria-label") ??
    element.getAttribute("title") ??
    (element.textContent ?? "").replace(/\s+/g, "")
  );
}

/**
 * 断言这块区域**最多一个**实心主色按钮。
 *
 * `min` 用于"必须至少有一个"的场景（例如空状态的唯一出口）；不传则只断"不超过一个"。
 */
export function assertSinglePrimaryAction(
  region: HTMLElement,
  options: { min?: number; label?: string } = {},
): number {
  const primaries = [...region.querySelectorAll(PRIMARY_SELECTOR)];
  const where = options.label ? `（${options.label}）` : "";
  // 失败时把两个按钮的名字打出来，便于直接定位是哪一处
  const names = primaries.map(nameOf);
  expect(
    primaries.length,
    `${where}这块区域出现了并列的实心主色按钮：${names.join(" / ")}（DESIGN.md §5.1 禁止）`,
  ).toBeLessThanOrEqual(1);
  if (options.min !== undefined) {
    expect(primaries.length, `${where}至少要有一个主操作`).toBeGreaterThanOrEqual(options.min);
  }
  return primaries.length;
}

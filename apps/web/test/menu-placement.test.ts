/**
 * 菜单弹出方向与限高（用户 2026-10-01 反馈的问题 3："在快捷输入框里用 `/` 命令时弹窗向上弹，
 * 内容出框看不到了"）。
 *
 * 纯函数，不碰 DOM：判定只吃"锚点纵向区间 + 可用边界纵向区间 + 菜单限高"。
 * 三个真实场景各钉一条：
 * 1. **功能栏录入框**（在功能栏顶部，下方有整屏空间）→ 向下弹；
 * 2. **编辑器试验页 / 正文区左下角锚点**（在页面底部）→ 向上弹（原来那条行为不许丢）；
 * 3. **添加内容窗口**（`.modal` 是 `overflow: hidden` 的真正边界，两边都不够 232px）
 *    → 取空间大的一侧，并把限高压到可用空间（宁可矮而可滚动，也不要被裁掉看不见）。
 */
import { describe, expect, it } from "vitest";
import {
  MENU_GAP,
  MENU_MAX_HEIGHT,
  menuMaxHeight,
  menuPlacement,
  type VerticalBox,
} from "../src/app/editor/menu-placement";

/** 常见的视口 */
const VIEWPORT: VerticalBox = { top: 0, bottom: 768 };

/** 功能栏录入框的输入区（54 顶栏 + 12 + 38 按钮 + 12 + 边框内边距后的输入区） */
const FN_ANCHOR: VerticalBox = { top: 116, bottom: 156 };

/** 编辑器试验页底部那类锚点 */
const BOTTOM_ANCHOR: VerticalBox = { top: 700, bottom: 740 };

/** 添加内容窗口：`.modal` 的 box 大约 246px 高，输入区在标题下面 */
const MODAL_BOX: VerticalBox = { top: 0, bottom: 246 };
const MODAL_ANCHOR: VerticalBox = { top: 49, bottom: 145 };

describe("菜单弹出方向", () => {
  it("下方放得下 → 向下（功能栏录入框：在功能栏顶部）", () => {
    expect(menuPlacement(FN_ANCHOR, VIEWPORT)).toBe("down");
    // 上方虽然也有空间，但"向下"优先（输入在上、内容在下的阅读顺序）
    expect(menuPlacement(FN_ANCHOR, VIEWPORT)).not.toBe("up");
  });

  it("下方放不下、上方放得下 → 向上（页面底部的锚点，试验页与正文区左下角）", () => {
    expect(menuPlacement(BOTTOM_ANCHOR, VIEWPORT)).toBe("up");
  });

  it("两边都放不下 → 取空间更大的一侧（窗口里量的是 `.modal` 这个真实边界，不是视口）", () => {
    // 向下 246-145-6 = 95；向上 49-0-6 = 43 → 向下
    expect(menuPlacement(MODAL_ANCHOR, MODAL_BOX)).toBe("down");
    // 换成输入区靠下、上方空间更大的情形 → 向上
    const anchor: VerticalBox = { top: 210, bottom: 240 };
    expect(menuPlacement(anchor, MODAL_BOX)).toBe("up");
  });

  it("刚好放得下算放得下（≥ 限高，不因 1px 抖动翻方向）", () => {
    const box: VerticalBox = { top: 0, bottom: 100 + MENU_MAX_HEIGHT + MENU_GAP };
    const anchor: VerticalBox = { top: 100, bottom: 100 };
    expect(menuPlacement(anchor, box)).toBe("down");
  });
});

describe("菜单限高", () => {
  it("空间够 → 就是限高 232px", () => {
    expect(menuMaxHeight(FN_ANCHOR, VIEWPORT)).toBe(MENU_MAX_HEIGHT);
  });

  it("空间不够 → 压到可用空间（矮而可滚动，好过被裁掉）", () => {
    // 向下 95px 可用
    expect(menuMaxHeight(MODAL_ANCHOR, MODAL_BOX)).toBe(95);
  });

  it("紧贴边界也不会给负数", () => {
    // 上下都被同一层容器卡死（连间隙都放不下）：给 0，由 CSS 收口，不要出现负的 max-height
    const box: VerticalBox = { top: 0, bottom: 10 };
    const anchor: VerticalBox = { top: 2, bottom: 8 };
    expect(menuMaxHeight(anchor, box)).toBe(0);
  });
});

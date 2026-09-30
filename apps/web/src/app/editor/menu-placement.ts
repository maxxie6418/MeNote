/**
 * `/` 与 `@` 菜单的**弹出方向与限高**（用户 2026-10-01 反馈的问题 3）。
 *
 * 背景：此前 `.cmd-menu` 写死 `bottom: calc(100% + 6px)`（**一律向上弹**），注释里的前提是
 * "录入框在窗口底部，向下弹会被视口裁掉"——那个前提只对编辑器试验页成立。功能栏录入框在
 * **功能栏顶部**（y ≈ 116），菜单限高 232px 往上弹会直接弹出视口顶部，内容被裁掉看不见；
 * 添加内容窗口里的输入区上方只有标题（更窄），而 `.modal` 又是 `overflow: hidden`，
 * 向上弹同样会被裁。
 *
 * 所以方向不能写死，要按**锚点周围真正可用的空间**算。可用空间取"最近的一个会裁剪的祖先"
 * （视口或 `overflow` 非 `visible` 的容器），不是 `window.innerHeight`——窗口里那个 `overflow: hidden`
 * 的 `.modal` 才是真正的边界。
 *
 * 三个导出：
 * - `menuPlacement()`：纯函数，只回答"往上还是往下"（先考虑放得下、再取空间大的一侧）；
 * - `menuMaxHeight()`：纯函数，把菜单限高压到可用空间内（宁可变成可滚动的矮菜单，也不要被裁掉）；
 * - `menuBoxForNode()`：DOM 部分，量锚点与裁剪边界后把两者拼起来（jsdom 下量不到真实布局，
 *   所以判定逻辑全在上面两个纯函数里，用例直接盯它们）。
 */

/** 菜单最大高度（与 `.cmd-menu` 的 `max-height` 同一个值，改一处要一起改） */
export const MENU_MAX_HEIGHT = 232;

/** 菜单与锚点之间的间隙（与 `.cmd-menu` 的 `calc(100% + 6px)` 同一个值） */
export const MENU_GAP = 6;

export type MenuPlacement = "up" | "down";

/** 一维区间（只关心纵向） */
export interface VerticalBox {
  top: number;
  bottom: number;
}

/** 某个方向能放下的高度（不含间隙） */
function roomIn(box: VerticalBox, anchor: VerticalBox, direction: MenuPlacement): number {
  return direction === "down"
    ? box.bottom - anchor.bottom - MENU_GAP
    : anchor.top - box.top - MENU_GAP;
}

/**
 * 菜单该往哪边弹。
 *
 * 规则（简单到能预测）：
 * 1. 下方放得下（≥ 菜单限高）→ **向下**（这是"输入区在上、内容在下"的默认阅读顺序）；
 * 2. 上方放得下 → 向上（编辑器试验页那三个快捷框、正文区左下角锚点就吃这一条）；
 * 3. 两边都放不下 → 取**空间更大**的一侧，由 `menuMaxHeight()` 压矮成可滚动的菜单。
 */
export function menuPlacement(
  anchor: VerticalBox,
  box: VerticalBox,
  menuHeight: number = MENU_MAX_HEIGHT,
): MenuPlacement {
  if (roomIn(box, anchor, "down") >= menuHeight) return "down";
  if (roomIn(box, anchor, "up") >= menuHeight) return "up";
  return roomIn(box, anchor, "down") >= roomIn(box, anchor, "up") ? "down" : "up";
}

/** 菜单实际能用的最大高度：压在可用空间内，且不超过限高；空间为负时给 0（由 CSS 的 `max-height` 收口） */
export function menuMaxHeight(
  anchor: VerticalBox,
  box: VerticalBox,
  menuHeight: number = MENU_MAX_HEIGHT,
): number {
  const room = roomIn(box, anchor, menuPlacement(anchor, box, menuHeight));
  return Math.max(0, Math.min(menuHeight, Math.floor(room)));
}

export interface MenuBox {
  placement: MenuPlacement;
  maxHeight: number;
}

/**
 * 锚点周围**会裁剪的边界**：从锚点往上找第一个 `overflow` 非 `visible` 的祖先（含
 * `auto` / `scroll` / `hidden` / `clip`），都没有就是视口。
 *
 * 两个轴都要看：CSS 规定一个轴非 `visible` 时另一个轴会按 `auto` 计算，所以"只写了
 * `overflow-x: auto`"的容器**同样**会裁纵向内容。
 */
export function menuBoundsFor(node: HTMLElement, viewportHeight: number): VerticalBox {
  let parent = node.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    if (style.overflowY !== "visible" || style.overflowX !== "visible") {
      const rect = parent.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }
    parent = parent.parentElement;
  }
  return { top: 0, bottom: viewportHeight };
}

/** 量一次锚点，算出菜单的方向与限高（宿主在菜单打开时调一次即可） */
export function menuBoxForNode(
  node: HTMLElement | null,
  viewportHeight: number = typeof window === "undefined" ? 0 : window.innerHeight,
  menuHeight: number = MENU_MAX_HEIGHT,
): MenuBox {
  if (!node) return { placement: "down", maxHeight: menuHeight };
  const anchor = node.getBoundingClientRect();
  const box = menuBoundsFor(node, viewportHeight);
  return {
    placement: menuPlacement(anchor, box, menuHeight),
    maxHeight: menuMaxHeight(anchor, box, menuHeight),
  };
}

// @vitest-environment jsdom
/**
 * 启动时的登录态检查屏（`AuthLoading`）。
 *
 * 起因（用户 2026-09-29）：应用打开时整屏只有一句"正在检查登录状态…"，要求
 * **去掉文字、改用站点图标本体做加载动画**（云与书竖直微跳）。
 *
 * jsdom 不加载 `app.css`，所以这里分两层钉：
 * 1. **DOM 层**——内联的 logo 在、云 / 书两个分组都在（说明 CSS 真能分别驱动它们）、
 *    整块插画对辅助技术隐藏、**可见文字没了但状态文字以 `.visually-hidden` 留在 DOM 里**
 *    （`DESIGN.md` §5.5-4 / §6.1 的意图不能丢）、这一屏不闪出登录 / 注册表单；
 * 2. **样式层**——直接读 `app.css` 确认两条动画真的绑在 `.mn-cloud` / `.mn-book` 上，
 *    而且是**上下位移、不是旋转**。只查"类名有规则"（`style-coverage` 的活）挡不住
 *    "类名还在、动画被删"这种静默退化，而"云和书在跳"正是本次需求本身。
 *
 * 读 `app.css` 为什么走 `import.meta.dirname`：jsdom 环境下仓库别处那套写法都不成立（三条实测）——
 * `readFileSync(new URL(…, import.meta.url))` 会被 Vite 当资源引用改写成 `http://localhost:3000/src/…`、
 * `import.meta.glob(…, "?raw")` 拿到的 CSS 在 vitest 里是空串、`node:url` 的 `fileURLToPath` 收 jsdom 的
 * `URL` 对象会炸。
 */
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AuthLoading } from "../src/app/AuthScreens";

const testDir = (import.meta as ImportMeta & { dirname: string }).dirname;
const appCss = readFileSync(`${testDir}/../src/app/theme/app.css`, "utf8");

afterEach(cleanup);

describe("AuthLoading（登录态检查中）", () => {
  it("CSS 真的读到了（否则下面那些样式断言等于没写）", () => {
    expect(appCss).toContain(".authpage");
  });

  it("内联的是站点图标本体，且云 / 书两个分组都在（CSS 要能分别驱动它们）", () => {
    const { container } = render(<AuthLoading />);

    const logo = container.querySelector(".authloading__logo");
    expect(logo, "缺少 logo 容器").not.toBeNull();
    // 必须内联：`<img>` 里的内容页面 CSS 够不着，那样云和书分不开
    expect(logo?.querySelector("img"), "logo 走了 <img>，CSS 驱动不了内部分组").toBeNull();
    const svg = logo?.querySelector("svg");
    expect(svg, "内联的 SVG 不在").not.toBeNull();
    expect(svg?.querySelector(".mn-cloud"), "云分组不在").not.toBeNull();
    expect(svg?.querySelector(".mn-book"), "书分组不在").not.toBeNull();
  });

  it("插画对辅助技术隐藏（语义交给状态文字，免得读屏念两遍 Menote）", () => {
    const { container } = render(<AuthLoading />);

    expect(container.querySelector(".authloading__logo")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("可见文字去掉了，但状态文字仍在 DOM 里（读屏照常念得到）", () => {
    const { container } = render(<AuthLoading />);

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("正在检查登录状态");
    // 只存在于视觉隐藏元素里，屏上不显示（jsdom 不加载 CSS，按类名断言）
    const text = [...status.querySelectorAll("span")].find((node) =>
      (node.textContent ?? "").includes("正在检查登录状态"),
    );
    expect(text?.className, "状态文字不在视觉隐藏元素里，那就又平铺出来了").toContain(
      "visually-hidden",
    );
    // 上一版那套（转圈图标 + 可见文字）已经整体退场
    expect(container.querySelector(".authloading__label")).toBeNull();
    expect(container.querySelector(".authloading__spin")).toBeNull();
  });

  it("云与书真的绑着上下微跳的动画（类名还在、动画被删会静默退化）", () => {
    const cloudRule = appCss.match(/\.authloading__logo \.mn-cloud\s*\{([^}]*)\}/)?.[1] ?? "";
    const bookRule = appCss.match(/\.authloading__logo \.mn-book\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(cloudRule, "`.mn-cloud` 没有规则").not.toBe("");
    expect(bookRule, "`.mn-book` 没有规则").not.toBe("");
    expect(cloudRule).toMatch(/animation:[^;]*authloading-cloud/);
    expect(bookRule).toMatch(/animation:[^;]*authloading-book/);

    const cloudFrames = appCss.match(/@keyframes\s+authloading-cloud\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const bookFrames = appCss.match(/@keyframes\s+authloading-book\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    // 是"上下分离"，不是旋转（§6.8 登记这条例外时写的就是"只上下、不旋转"）
    expect(cloudFrames).toContain("translateY(-16px)");
    expect(bookFrames).toContain("translateY(16px)");
    expect(`${cloudFrames}${bookFrames}`).not.toContain("rotate");
  });

  it("图标尺寸与跳动幅度成对（放大图标要同步折算，别让「轻」偷偷变重）", () => {
    const size = Number(appCss.match(/\.authloading__logo\s*\{[^}]*width:\s*(\d+)px/)?.[1]);
    const amplitude = Number(
      appCss.match(/@keyframes\s+authloading-cloud\s*\{[\s\S]*?translateY\(-(\d+)px\)/)?.[1],
    );
    expect(size, "读不到 `.authloading__logo` 的宽度").toBeGreaterThan(0);
    expect(amplitude, "读不到云的位移幅度").toBeGreaterThan(0);

    expect(size, "图标尺寸改了就把这条一起改（并重新折算幅度）").toBe(96);
    // 用户单位 → 显示 px：viewBox 是 512，这条换算正是 `DESIGN.md` 里写的"各约 3px"
    expect(Math.round((amplitude * size) / 512)).toBe(3);
  });

  it("减速偏好由全局块接管（这屏不另写一套）", () => {
    const reduced =
      appCss.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(reduced, "全局的 prefers-reduced-motion 块不见了").not.toBe("");
    expect(reduced).toContain("animation-duration: 0.01ms");
  });

  it("不提前闪出登录 / 注册表单（登录态还没判定）", () => {
    const { container } = render(<AuthLoading />);

    expect(container.querySelector(".authcard")).toBeNull();
  });
});

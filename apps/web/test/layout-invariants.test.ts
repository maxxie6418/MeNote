/**
 * 结构与视觉不变量守卫（DESIGN.md §2.2 / §2.5 / §8-4）。
 *
 * 为什么需要：这些值是 DESIGN.md 里标【实测】的硬约束（是"结构不变量"，换视觉方向也不变），
 * 而现在只有"实现时照抄原型"这一层保障——任何人改一行 CSS 都不会有东西拦住他。
 * 这个用例不测布局（jsdom 没有排版引擎），它守的是**声明值**：谁改了这些数字，用例立刻红，
 * 逼他回去重跑 `prototype/verify-prototype.js` 并重新测量。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const tokens = read("../src/app/theme/tokens.css");
const app = read("../src/app/theme/app.css");

function value(css: string, pattern: RegExp): number {
  const matched = css.match(pattern);
  if (!matched?.[1]) throw new Error(`没找到声明：${pattern}`);
  return Number(matched[1]);
}

/** 从 `--name: 12px` 这类令牌里取值（只看第一个匹配，即浅色主题块） */
const tokenPx = (name: string): number =>
  value(tokens, new RegExp(`--${name}:\\s*(\\d+)px`));

/** 从选择器块里取属性值 */
const rulePx = (css: string, selector: string, prop: string): number =>
  value(css, new RegExp(`${selector}\\s*\\{[^}]*${prop}:\\s*(\\d+)px`));

describe("结构尺寸令牌（DESIGN.md §2.2【已定】）", () => {
  it("顶栏 54、功能栏 294、列表 330、设置导航 184、圆角 10/14", () => {
    expect(tokenPx("topbar-h")).toBe(54);
    expect(tokenPx("fnbar-w")).toBe(294);
    expect(tokenPx("list-w")).toBe(330);
    expect(tokenPx("settings-nav-w")).toBe(184);
    expect(tokenPx("radius")).toBe(10);
    expect(tokenPx("radius-lg")).toBe(14);
  });
});

describe("功能栏几何（DESIGN.md §2.5-2 不变量）", () => {
  it("54 + 12 + 38 + 12 + 136 = 252：导航区顶部 y=252 的算式不能变", () => {
    const topbar = tokenPx("topbar-h");
    const fnTopPadding = rulePx(app, "\\.fnbar__top", "padding");
    const newButton = rulePx(app, "\\.btn-new", "height");
    const composerMargin = rulePx(app, "\\.composer", "margin-top");
    const composerHeight = 136; // 由录入框三行内容决定，原型实测值

    expect(topbar).toBe(54);
    expect(fnTopPadding).toBe(12);
    expect(newButton).toBe(38);
    expect(composerMargin).toBe(12);
    expect(topbar + fnTopPadding + newButton + composerMargin + composerHeight).toBe(252);
  });

  it("录入框三行结构：输入区 40–180 可纵向 resize、附加项固定 26 且不换行、模式行同排", () => {
    expect(rulePx(app, "\\.composer__input", "min-height")).toBe(40);
    expect(rulePx(app, "\\.composer__input", "max-height")).toBe(180);
    expect(app).toMatch(/\.composer__input\s*\{[^}]*resize:\s*vertical/);

    // 附加项容器：固定高度 + nowrap，禁用 display:none 塌陷（DESIGN.md §2.5-2）
    expect(rulePx(app, "\\.composer__extras", "height")).toBe(26);
    expect(app).toMatch(/\.composer__extras\s*\{[^}]*flex-wrap:\s*nowrap/);
    expect(app).not.toMatch(/\.composer__extras[^{]*\{[^}]*display:\s*none/);

    // 模式行：左模式切换 + 右发布按钮，同一行
    expect(app).toMatch(/\.composer__modes\s*\{[^}]*display:\s*flex/);
  });

  it("页面不滚动：滚动只发生在各栏内部（DESIGN.md §2.7）", () => {
    expect(app).toMatch(/body\s*\{[^}]*overflow:\s*hidden/);
    for (const selector of ["\\.fnbar__scroll", "\\.listpane__scroll", "\\.settings__body"]) {
      expect(app).toMatch(new RegExp(`${selector}\\s*\\{[^}]*overflow-y:\\s*auto`));
    }
  });
});

describe("组件硬性规范（DESIGN.md §3.2 / §5.5）", () => {
  it("组件里不出现硬编码颜色（必须走令牌）", () => {
    // 允许：tokens.css 定义值、app.css 里的 0/100% 之类无颜色；这里只扫十六进制与 rgb()
    const hexInApp = app.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgbInApp = app.match(/\brgba?\(/g) ?? [];
    expect(hexInApp).toEqual([]);
    expect(rgbInApp).toEqual([]);
  });

  it("图标统一 1.6px 描边、无填充、继承文字色（DESIGN.md §5.5）", () => {
    expect(app).toMatch(/\.ic\s*\{[^}]*stroke-width:\s*1\.6/);
    expect(app).toMatch(/\.ic\s*\{[^}]*fill:\s*none/);
    expect(app).toMatch(/\.ic\s*\{[^}]*stroke:\s*currentColor/);
  });

  it("渐变也必须由令牌拼装（DESIGN.md §3.2-2：渐变里的裸色值扫不到）", () => {
    expect(app).toContain("var(--primary-grad)");
    expect(tokens).toMatch(/--primary-grad:\s*linear-gradient\([^)]*var\(--primary\)/);
  });
});

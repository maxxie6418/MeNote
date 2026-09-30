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
import { assertNoColourLiterals } from "./helpers/css-colors";

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

describe("配色令牌（DESIGN.md §3.2-3 / §3.3【已定】）", () => {
  /** 取令牌块里的 `--name:value` 对（只看颜色类：值里带 # / rgb / linear-gradient） */
  const colorPairs = (block: string): Map<string, string> =>
    new Map(
      [...block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)]
        .filter((match) => /#|rgba?\(|linear-gradient/.test(match[2] ?? ""))
        .map((match) => [match[1] ?? "", (match[2] ?? "").trim()]),
    );

  const lightBlock = tokens.match(/:root\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const darkBlock = tokens.match(/:root\[data-theme="dark"\]\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

  it("浅色与深色的颜色令牌成对（尺寸/字族类不参与）", () => {
    expect(lightBlock).not.toBe("");
    expect(darkBlock).not.toBe("");

    const light = colorPairs(lightBlock);
    const dark = colorPairs(darkBlock);
    expect(light.size).toBeGreaterThanOrEqual(30);

    const missing = [...light.keys()].filter((name) => !dark.has(name));
    expect(missing, `深色块缺颜色令牌：${missing.join("、")}`).toEqual([]);
  });

  it("主色是 Cloudflare 橙，且橙底文字为深墨（白字压橙只有 2.58:1）", () => {
    const light = colorPairs(lightBlock);
    expect(light.get("primary")).toBe("#f6821f");
    expect(light.get("on-primary")).toBe("#1d1d1d");
    // 橙色作文字色必须走专门令牌（#f6821f 压白只有 2.58:1）
    expect(light.get("primary-ink")).toBe("#b45309");
  });

  it("旧的 Claude 暖色不得残留", () => {
    for (const stale of ["#d97757", "#b4543a", "#faf9f5", "#f4f2eb", "#eeece3", "#e8e4d9"]) {
      expect(tokens.toLowerCase()).not.toContain(stale);
      expect(app.toLowerCase()).not.toContain(stale);
    }
  });
});

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

  /*
    轻量即时渲染宿主（编辑拓展阶段 B / Task B5）：输入态**继续用 `.composer__input`**，
    所以上面那条三行结构不变量同时守住了它；这里补呈现态自己的约束——
    Markdown 段距不能把录入框撑高（限高 + 内部滚动），否则三行 136px 的结构就不成立了。
  */
  it("快捷输入呈现态：限高 + 内部滚动，且不靠 hover 才能回到编辑", () => {
    expect(rulePx(app, "\\.quick-composer__view", "max-height")).toBe(180);
    expect(app).toMatch(/\.quick-composer__view\s*\{[^}]*overflow-y:\s*auto/);
    // 呈现态是"点击继续编辑"的入口：触屏要有 44px 命中区（不是只有 hover 才算可点）
    expect(app).toMatch(/@media\s*\(pointer:\s*coarse\)\s*\{[^}]*\.quick-composer__view\s*\{[^}]*min-height:\s*44px/);
    // 呈现态里的 markdown 容器按录入框排版，不套阅读区的 740px 宽与 80px 底距
    expect(app).toMatch(/\.quick-composer__view\s+\.markdown-body\s*\{[^}]*max-width:\s*none/);
  });

  it("快捷输入的命令菜单：向上弹出、限高滚动（录入框在窗口底部，向下弹会被裁掉）", () => {
    expect(app).toMatch(/\.cmd-menu\s*\{[^}]*bottom:\s*calc\(100%\s*\+\s*6px\)/);
    expect(rulePx(app, "\\.cmd-menu", "max-height")).toBe(232);
    expect(app).toMatch(/\.cmd-menu\s*\{[^}]*overflow-y:\s*auto/);
  });

  it("页面不滚动：滚动只发生在各栏内部（DESIGN.md §2.7）", () => {
    expect(app).toMatch(/body\s*\{[^}]*overflow:\s*hidden/);
    for (const selector of ["\\.fnbar__scroll", "\\.listpane__scroll", "\\.settings__body"]) {
      expect(app).toMatch(new RegExp(`${selector}\\s*\\{[^}]*overflow-y:\\s*auto`));
    }
  });

  it("加密空间贴底固定：容器 flex:none，且不在滚动区里（M2-2 验收点）", () => {
    expect(app).toMatch(/\.fnbar__vault\s*\{[^}]*flex:\s*none/);
    expect(app).toMatch(/\.fnbar__vault\s*\{[^}]*padding:/);
    // 贴底固定靠"不在滚动容器里"实现，结构由 fnbar.test.tsx 的 DOM 断言守住
  });

  it("录入框模式行的分段控件占满余下宽度（原型 .mode-tabs 的 flex:1/min-width:0）", () => {
    expect(app).toMatch(/\.segmented--compact\s*\{[^}]*flex:\s*1/);
    expect(app).toMatch(/\.segmented--compact\s*\{[^}]*min-width:\s*0/);
  });
});

describe("组件硬性规范（DESIGN.md §3.2 / §5.5）", () => {
  it("组件里不出现硬编码颜色（必须走令牌，DESIGN.md §3.2-1「没有例外」）", () => {
    /*
      2026-09-27 补强：原来只扫 `app.css` 的 `#hex` 与 `rgb(`——`hsl(` 与**颜色关键字**
      （`white` / `black` / `red`…）会被**静默放过**，正是"扫不到"的那一类漏洞。
      现在走可自证的 `assertNoColourLiterals`（见 `helpers/css-colors.ts` 与 `css-colors.test.ts`），
      它认 `hsl(`、认颜色关键字、且只看颜色类属性的值（不会把 `white-space` 误判成颜色）；
      "**src 下全部样式文件 + 全部源码文件**"由 `css-colors.test.ts` 用 Vite 的
      `import.meta.glob` 铺开（那边不依赖 Node 文件系统 API，与本包的 tsconfig shim 不冲突）。
    */
    assertNoColourLiterals(app, "app.css");
  });

  it("图标统一 1.6px 描边、无填充、继承文字色（DESIGN.md §5.5）", () => {
    expect(app).toMatch(/\.ic\s*\{[^}]*stroke-width:\s*1\.6/);
    expect(app).toMatch(/\.ic\s*\{[^}]*fill:\s*none/);
    expect(app).toMatch(/\.ic\s*\{[^}]*stroke:\s*currentColor/);
  });

  it("`IconName` 的每个名字都有对应字形，反之亦然（一一对应，2026-09-27 补守卫）", () => {
    /*
      为什么值得守：`Icon` 用 `<use href="#i-名字">` 取字形——**名字在而字形不在，屏幕上就是一片空白**，
      而且不会有任何报错。此前只是人工核对过（当时 20 ↔ 20），加了 `more` 之后正好钉住它。
    */
    const icon = read("../src/app/ui/Icon.tsx");
    const unionBlock = /export type IconName =([\s\S]*?);/.exec(icon)?.[1] ?? "";
    const names = [...unionBlock.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort();
    const symbols = [...icon.matchAll(/id="i-([a-z-]+)"/g)].map((m) => m[1]).sort();

    expect(names.length).toBeGreaterThanOrEqual(20);
    expect(names, "有名字没有字形（会渲染成空白）").toEqual(symbols);
  });

  it("渐变也必须由令牌拼装（DESIGN.md §3.2-2：渐变里的裸色值扫不到）", () => {
    expect(app).toContain("var(--primary-grad)");
    expect(tokens).toMatch(/--primary-grad:\s*linear-gradient\([^)]*var\(--primary\)/);
  });
});

/**
 * 2026-09-29 用户反馈的界面异常的守卫（"Memo/待办状态切换条不对、笔记本树菜单压住数字"）。
 *
 * 为什么守**声明值**：jsdom 没有排版引擎，"位置不对 / 被压住"在渲染用例里测不出来；
 * 但这两处的成因都是**少了一条声明**——Memo 页头没跟着待办一起定宽、树行右侧没给
 * 绝对定位的菜单留位置。把声明钉住，再犯就红。
 */
describe("页头视图切换与树行右侧的留白（2026-09-29 修复）", () => {
  /** 去掉注释再匹配：注释里也会出现这些选择器（本文件别处同样做法） */
  const css = app.replace(/\/\*[\s\S]*?\*\//g, " ");

  it("Memo 与待办页头那条视图切换共用同一条定宽规则（否则 Memo 那条会被 compact 的 flex:1 拉宽）", () => {
    const rule =
      /^\.tkhead__main \.segmented,\s*\n\.memopanel__head \.segmented\s*\{([^}]*)\}/m.exec(css)?.[1] ??
      "";
    expect(rule, "两个页头没有共用定宽规则——Memo 那条会漂到页头中间").not.toBe("");
    expect(rule).toMatch(/flex:\s*none/);
    expect(rule).toMatch(/min-width:\s*176px/);

    const itemRule =
      /^\.tkhead__main \.segmented__item,\s*\n\.memopanel__head \.segmented__item\s*\{([^}]*)\}/m.exec(
        css,
      )?.[1] ?? "";
    expect(itemRule, "定宽之后还要让两个按钮平分").toMatch(/flex:\s*1/);
  });

  it("笔记本树的行右侧给「更多」菜单留出位置（不许压住行尾计数）", () => {
    const row = /^\.tree-row\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "";
    const menu = /^\.tree-row__menu\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "";
    expect(row, "`.tree-row` 没有规则").not.toBe("");
    expect(menu, "`.tree-row__menu` 没有规则").not.toBe("");

    const padding = /padding:\s*([^;]+)/.exec(row)?.[1]?.trim() ?? "";
    const parts = padding.split(/\s+/);
    expect(parts, "`.tree-row` 的 padding 要写成四值，右侧留了多少才看得见").toHaveLength(4);

    /** 把 `var(--sp-N)` 与裸 px 都折算成数字 */
    const px = (raw: string): number => {
      const token = /var\(--sp-(\d+)\)/.exec(raw)?.[1];
      if (token !== undefined) {
        return Number(new RegExp(`--sp-${token}:\\s*(\\d+)px`).exec(tokens)?.[1]);
      }
      return Number.parseFloat(raw);
    };

    // 菜单占一列 = `right: <offset>` + 13px 图标；行的右内边距必须不小于它
    const offset = px(/right:\s*([^;]+)/.exec(menu)?.[1]?.trim() ?? "0");
    const reserved = px(parts[1] ?? "0");
    expect(reserved, "行右侧留得不够，绝对定位的菜单会压住计数").toBeGreaterThanOrEqual(offset + 13);
  });
});

/**
 * 功能栏标签区（2026-09-29 用户要求："标签区域要贴底部固定，不要被笔记本里的内容推挤；
 * 大概预留底部三分之一到四分之一的位置；不要按列显示标签，要用标签按钮显示"）。
 *
 * 声明值守卫：起固定作用的是 `flex: none`（不然会被上面的导航区挤），
 * 起"按钮铺开"作用的是 `.tags` 的 `flex-wrap: wrap`（写成 column 就变成一列了）。
 * DOM 层的那两条（与滚动区并列、位置在导航区之后）在 `fnbar.test.tsx`。
 */
describe("功能栏标签区：贴底固定 + 按钮铺开（2026-09-29）", () => {
  const css = app.replace(/\/\*[\s\S]*?\*\//g, " ");

  it("标签区贴底固定：`flex:none` + 预留底部 1/4～1/3 的高度 + 自己滚动", () => {
    const rule = /^\.fnbar__tags\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "";
    expect(rule, "`.fnbar__tags` 没有规则").not.toBe("");

    expect(rule, "少了 flex:none 就会被上面的内容推挤").toMatch(/flex:\s*none/);
    const height = Number(/height:\s*(\d+)%/.exec(rule)?.[1]);
    expect(height, "高度占比读不出来（用户要求约 1/3～1/4）").toBeGreaterThan(0);
    expect(height).toBeGreaterThanOrEqual(25);
    expect(height).toBeLessThanOrEqual(34);
    expect(rule, "矮窗口下要给一个可用下限").toMatch(/min-height:\s*\d+px/);
    expect(rule, "放不下时本区要能自己滚").toMatch(/overflow-y:\s*auto/);
  });

  it("标签用按钮铺开：`.tags` 换行排列，任何 `.tags` 规则都不许改成纵向", () => {
    const rule = /^\.tags\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "";
    expect(rule, "`.tags` 没有规则").not.toBe("");
    expect(rule).toMatch(/display:\s*flex/);
    expect(rule, "少了 flex-wrap:wrap 就会排成一列").toMatch(/flex-wrap:\s*wrap/);
    // 兜底：别处在 `.tags` 上写纵向排列也不行（同选择器 + 新属性，css-cascade 抓不到这种）
    expect(css, "`.tags` 被改成纵向排列了").not.toMatch(/\.tags\s*\{[^}]*flex-direction:\s*column/);
  });
});

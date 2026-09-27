/**
 * **样式覆盖守卫**（2026-09-27 新增；当天即从"棘轮"收紧为**严格断言**）。
 *
 * 背景：v0.4.42 发现表格屏**整屏没有样式**（74 个类名里 64 个没规则）；顺着同一条检查扫全仓，
 * 更发现 **M4 前端整体都没做样式**——合计 **50 个类名没有规则**。这类缺口**没有任何机制会拦**：
 * 用例查的是 DOM 与行为，样式表里少一条规则不会让任何断言变红。
 *
 * **清零过程**：表格 64（v0.4.43 按用户原型）→ memo / 待办（v0.4.44 按用户原型）→
 * 笔记列表 / 首页导航 / 零散类（v0.4.45）→ 回收站页 + 版本面板 / 版本对比（v0.4.46，
 * 这两屏没有用户原型页，按 `DESIGN.md` 令牌与同族语言补）。现在**断言"一个都不能少"**。
 *
 * **扫描器覆盖两种写法**（第一版只扫字面量，漏掉了模板拼接出来的类名）：
 * `className="a b"` 与 ``className={`a b--${kind} ${cond ? "c--x" : "c--y"}`}``。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../src/app/theme/app.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  " ",
);
const tokens = readFileSync(new URL("../src/app/theme/tokens.css", import.meta.url), "utf8");

const sources = import.meta.glob("../src/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * 白名单：**用到但不需要样式规则**的类名（每条都要写理由）。
 *
 * 注意 `.tablegrid__pad` **不在这里**——它已经拿到 `pointer-events: none` 的规则；
 * 高度确实由行内 `style` 给，但那也需要一条规则把它从命中/交互里摘出去。
 */
const NO_STYLE_NEEDED: Readonly<Record<string, string>> = {};

/**
 * 从 className 里取出所有类名 → 声明它的文件。
 *
 * **覆盖两种写法**（2026-09-27 补）：
 * 1. `className="a b"` —— 字面量；
 * 2. `className={`a b--${kind} ${cond ? "c--x" : "c--y"}`}` —— 模板拼接。
 *    模板里：静态片段按空白切开（尾随 `--` 这种前缀也收，它靠"有没有 `.前缀…` 的规则"判）；
 *    插值表达式里出现的**字符串字面量**（如 `"c--x"`）同样作为候选类名收进来。
 *
 * 第一版只扫写法 1，于是 `trashrow__icon`、`versiondiff__line--*`、`size-tag--*`、
 * `columndef__row--active` 这些**全是模板拼出来的**类名被静默漏掉——正是"扫不到"的又一例。
 */
function usedClasses(): Map<string, string> {
  const out = new Map<string, string>();
  const add = (name: string, path: string): void => {
    if (name && !out.has(name)) out.set(name, path);
  };

  for (const [path, source] of Object.entries(sources)) {
    for (const match of source.matchAll(/className="([^"]+)"/g)) {
      for (const name of (match[1] ?? "").split(/\s+/)) add(name, path);
    }

    for (const match of source.matchAll(/className=\{`([\s\S]*?)`\}/g)) {
      const body = match[1] ?? "";
      /*
        插值里的字符串字面量：`${cond ? "a" : "b"}` 里的 "a"/"b" 要收，但**比较操作数**不算
        （`${tone === "warn" ? …}` 里的 "warn" 是取值不是类名——第一版把它当成缺失类名报了出来）。
      */
      for (const strings of body.matchAll(/\$\{([^}]*)\}/g)) {
        const expression = (strings[1] ?? "").replace(/[=!]==?\s*"[^"]*"/g, " ");
        for (const literal of expression.matchAll(/"([^"]*)"/g)) {
          for (const name of (literal[1] ?? "").split(/\s+/)) add(name, path);
        }
      }
      // 静态片段：把插值挖掉再按空白切（尾随 `--` 的前缀保留）
      const staticPart = body.replace(/\$\{[^}]*\}/g, " ");
      for (const name of staticPart.split(/\s+/)) add(name, path);
    }
  }
  return out;
}

function hasRule(className: string): boolean {
  if (app.includes(`.${className}`) || tokens.includes(`.${className}`)) return true;
  /*
    BEM 前缀（模板里 `${kind}` 拼出来的 `x__y--`）：只要**基类**或**任一该前缀的修饰规则**存在即算覆盖。
    理由：修饰类不一定需要独立规则（例如类型图标块各类型共用一套外观，不给每型写一条配色——
    那还会违反"颜色不单独表意"）。这一条仍然能抓住"整个家族都没有规则"的情况。
  */
  const prefix = className.match(/^(.*--)$/)?.[1];
  if (prefix) {
    const base = `${prefix.slice(0, -2)}`;
    if (app.includes(`${prefix}`) || hasRule(base)) return true;
  }
  return false;
}

describe("样式覆盖（每个用到的类名都有规则）", () => {
  it("src 下所有 className 都能在 tokens.css / app.css 里找到规则", () => {
    const used = usedClasses();
    // 防"零个类名也算通过"的假绿
    expect(used.size).toBeGreaterThan(100);

    const missing = [...used.entries()]
      .filter(([name]) => !(name in NO_STYLE_NEEDED))
      .filter(([name]) => !hasRule(name))
      .map(([name, path]) => `${name}（${path}）`);

    // 已到 0：改为**严格断言**——不许再出现裸类名（棘轮阶段用的预算已撤掉）
    expect(missing, `这些类名没有样式规则，屏幕会是裸的：\n${missing.join("\n")}`).toEqual([]);
  });

  it("自证：扫描器真的能发现「有用到但没规则」的类名", () => {
    // 用一个只存在于测试里的假类名反向验证 `hasRule`：它必须为 false
    expect(hasRule("menote-style-coverage-selfcheck")).toBe(false);
    // 而真实存在的类名必须为 true（否则上面那条断言等于没写）
    expect(hasRule("tablegrid__scroll")).toBe(true);
    expect(hasRule("tablegrid__th-name")).toBe(true);
    expect(hasRule("gallery__grid")).toBe(true);
    expect(hasRule("columndef__type-option")).toBe(true);
  });

  it("自证：**模板拼接**出来的类名也扫得到（第一版漏掉过这一类）", () => {
    const used = usedClasses();
    // 这些只出现在模板字面量里（`className={`… --${kind}`}`），不是 `className="…"`
    expect(used.has("trashrow__icon"), "trashrow__icon 应被扫到").toBe(true);
    expect(used.has("versiondiff__line--"), "versiondiff__line-- 前缀应被扫到").toBe(true);
    expect(used.has("size-tag--"), "size-tag-- 前缀应被扫到").toBe(true);
    // 插值里的字符串字面量也要收（条件三选一那种写法）
    expect(used.has("columndef__row--active"), "插值里的字面量类名应被扫到").toBe(true);
  });
});

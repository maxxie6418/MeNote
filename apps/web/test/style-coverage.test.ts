/**
 * **样式覆盖守卫**（2026-09-27 新增，棘轮式）。
 *
 * 背景：v0.4.42 发现表格屏**整屏没有样式**（74 个类名里 64 个没规则）；顺着同一条检查扫全仓，
 * 更发现 **M4 前端整体都没做样式**——回收站页 24 个、版本面板/对比 25 个、另有若干零散类名，
 * 合计 **50 个类名没有规则**。这类缺口**没有任何机制会拦**：用例查的是 DOM 与行为，
 * 样式表里少一条规则不会让任何断言变红。
 *
 * 本用例是**棘轮**：`UNSTYLED_BUDGET` 只许**往下减**。补完一整屏就把它调小；
 * 减到 0 之后改成严格断言（`toEqual([])`），从此不许再出现裸屏。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 允许"暂时还没样式"的类名上限。
 *
 * 现状：**49**（表格 64 个已在 v0.4.43 清零；memo 与待办在 v0.4.44 按原型对齐后只剩
 * `memo__cancel` 一个新增规则）。剩下的集中在**回收站页（24）与版本面板/对比（25）**，
 * 外加首页 / 隐私胶囊 / 设置的几处零散类名。每补完一屏就调小；到 0 时改成 `toEqual([])`。
 */
const UNSTYLED_BUDGET = 49;

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

/** 从 className 里取出所有类名 → 声明它的文件 */
function usedClasses(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, source] of Object.entries(sources)) {
    for (const match of source.matchAll(/className="([^"]+)"/g)) {
      for (const name of (match[1] ?? "").split(/\s+/)) {
        if (name && !out.has(name)) out.set(name, path);
      }
    }
  }
  return out;
}

function hasRule(className: string): boolean {
  return app.includes(`.${className}`) || tokens.includes(`.${className}`);
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

    expect(
      missing.length,
      `没有样式规则的类名有 ${missing.length} 个（预算 ${UNSTYLED_BUDGET}）：\n${missing.join("\n")}`,
    ).toBeLessThanOrEqual(UNSTYLED_BUDGET);
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
});

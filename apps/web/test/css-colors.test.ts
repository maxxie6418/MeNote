/**
 * `findColourLiterals` 的自证（2026-09-27）。
 *
 * 规矩：下"全部合规"这类结论前，先喂**已知坏例与已知好例**。这条尤其必要——
 * 第一版守卫只认 `#hex` 与 `rgb(`，`hsl(` 与颜色关键字**会被静默放过**（正是"扫不到"的漏洞）。
 */
import { describe, expect, it } from "vitest";
import { assertNoColourLiterals, findColourLiterals } from "./helpers/css-colors";

describe("裸颜色值检查的自证", () => {
  it("十六进制 / rgb / hsl / 颜色关键字 → 都抓得到", () => {
    const bad = [
      ".a { color: #fff; }",
      ".b { background: rgb(1 2 3); }",
      ".c { border-color: rgba(0,0,0,.5); }",
      ".d { outline-color: hsl(20 90% 50%); }",
      ".e { color: white; }",
      ".f { box-shadow: 0 0 4px black; }",
      ".g { color: var(--fg, #333); }",
    ].join("\n");
    const found = findColourLiterals(bad).map((entry) => entry.literal);
    expect(found).toContain("#fff");
    expect(found).toContain("rgb(");
    expect(found).toContain("rgba(");
    expect(found).toContain("hsl(");
    expect(found).toContain("white");
    expect(found).toContain("black");
    expect(found).toContain("#333");
  });

  it("令牌与合法关键字 → 不误报（这三类是最容易踩的误报）", () => {
    const good = [
      ".a { color: var(--fg); }",
      ".b { background: var(--bg-soft); }",
      ".c { color: transparent; }",
      ".d { fill: currentColor; }",
      ".e { background: inherit; }",
      ".f { box-shadow: none; }",
      // 属性名里带颜色词，不是颜色值（第一版把我的 `white-space` 当成了 white）
      ".g { white-space: nowrap; }",
      ".h { background-image: var(--primary-grad); }",
    ].join("\n");
    expect(findColourLiterals(good)).toEqual([]);
  });

  it("只扫「颜色类属性的值」——非颜色属性里的色词不算", () => {
    expect(findColourLiterals(".a { font-family: Black; }")).toEqual([]);
    expect(findColourLiterals(".b { color-profile: sRGB; }")).toEqual([]);
  });
});

describe("源码（.ts/.tsx）与全部样式文件里都不许有裸色值", () => {
  /**
   * 内联样式（`style={{ color: "#fff" }}`）与 SVG 属性（`fill="#000"`）最容易绕过 CSS 那道守卫，
   * 所以再扫一遍源码。规则同样来自 `DESIGN.md` §3.2-1「一切颜色走令牌……没有例外」。
   *
   * 用 Vite 的 `import.meta.glob`（raw）取文件：不依赖 Node 文件系统 API，
   * 与本包 tsconfig 只 shim 少数 Node 类型的情况不冲突。
   */
  const sources = import.meta.glob("../src/**/*.{ts,tsx}", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;
  const styles = import.meta.glob("../src/**/*.css", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  it("src 下所有 .ts/.tsx 都没有裸色值（注释除外）", () => {
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThan(50);

    const offenders: string[] = [];
    for (const [path, source] of files) {
      // 去掉注释，避免"文档里举例写了 #fff"被误判
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
      for (const literal of stripped.match(/#[0-9a-fA-F]{6}\b|\brgba?\(|\bhsla?\(/g) ?? []) {
        offenders.push(`${path}: ${literal}`);
      }
    }
    expect(offenders, `源码里出现裸色值：${offenders.join("、")}`).toEqual([]);
  });

  it("样式文件（tokens.css 除外）都走令牌", () => {
    const entries = Object.entries(styles).filter(([path]) => !path.endsWith("tokens.css"));
    expect(entries.length).toBeGreaterThanOrEqual(1);
    for (const [path, css] of entries) assertNoColourLiterals(css, path);
  });
});

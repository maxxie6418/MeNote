/**
 * CSS 里的"裸颜色值"检查（`DESIGN.md` §3.2-1【已定】：「一切颜色走令牌。禁止在组件里写
 * 十六进制、`rgb()`、颜色关键字……**没有例外**」）。
 *
 * **为什么单独抽成函数**：原来这条守卫直接写在 `layout-invariants.test.ts` 里，只扫 `app.css`、
 * 只认 `#hex` 与 `rgb(`。抽出来以后：①可以**自证**（喂已知坏例与好例，见 `css-colors.test.ts`）；
 * ②覆盖面补齐——认 `hsl(`、认**颜色关键字**、能扫不止一个 CSS 文件。
 *
 * 三条防误报的规矩（都是踩过的坑）：
 * 1. **只看"颜色类属性的值"**，不看属性名——否则 `white-space: nowrap` 会被当成颜色关键字；
 * 2. `var(--red)` 里的 `red` 是**令牌名**，不是颜色值；
 * 3. `transparent` / `currentColor` / `inherit` / `initial` / `unset` / `none` / `auto` 是合法关键字，
 *    不参与判定。
 */
import { expect } from "vitest";

/** 承载颜色的属性（判值不判名） */
const COLOUR_PROPS = [
  "color",
  "background",
  "background-color",
  "background-image",
  "border",
  "border-color",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline",
  "outline-color",
  "box-shadow",
  "text-shadow",
  "fill",
  "stroke",
  "caret-color",
  "accent-color",
  "column-rule",
  "column-rule-color",
  "text-decoration-color",
];

/** CSS 颜色关键字里"最常见的那些"（不追求完备，够拦住手写颜色即可） */
const COLOUR_KEYWORDS = [
  "white",
  "black",
  "red",
  "green",
  "blue",
  "gray",
  "grey",
  "silver",
  "maroon",
  "navy",
  "olive",
  "teal",
  "aqua",
  "fuchsia",
  "lime",
  "purple",
  "yellow",
  "orange",
  "pink",
  "brown",
  "gold",
  "coral",
  "salmon",
  "crimson",
  "indigo",
  "violet",
  "beige",
  "ivory",
  "khaki",
  "lavender",
];

/** 合法的非颜色关键字（值等于它们时不算违规） */
const ALLOWED_KEYWORDS = new Set([
  "transparent",
  "currentcolor",
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
  "none",
  "auto",
  "normal",
]);

export interface ColourLiteral {
  /** 属性名（`color` / `background` …） */
  property: string;
  /** 属性值原文 */
  value: string;
  /** 命中的裸色值（`#fff` / `rgb(…)` / `hsl(…)` / `red`） */
  literal: string;
}

/** 找出这段 CSS 里所有"裸颜色值"（令牌定义文件本身不要传进来） */
export function findColourLiterals(css: string): ColourLiteral[] {
  const out: ColourLiteral[] = [];
  const propPattern = new RegExp(
    `(^|[;{])\\s*(${COLOUR_PROPS.join("|")})\\s*:\\s*([^;}]+)`,
    "gi",
  );

  for (const match of css.matchAll(propPattern)) {
    const property = (match[2] ?? "").trim().toLowerCase();
    const value = (match[3] ?? "").trim();

    // `#hex` / `rgb(` / `rgba(` / `hsl(` / `hsla(`
    for (const literal of value.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? []) {
      out.push({ property, value, literal });
    }

    // 颜色关键字：逐个词看，跳过 var(--x) 里的令牌名
    const withoutVars = value.replace(/var\(\s*--[^)]*\)/g, " ");
    for (const word of withoutVars.match(/[a-zA-Z]+/g) ?? []) {
      const lower = word.toLowerCase();
      if (ALLOWED_KEYWORDS.has(lower)) continue;
      if (COLOUR_KEYWORDS.includes(lower)) out.push({ property, value, literal: word });
    }
  }
  return out;
}

/** 断言这段 CSS 里没有裸颜色值；失败时把命中项列出来 */
export function assertNoColourLiterals(css: string, label: string): void {
  const found = findColourLiterals(css);
  expect(
    found.map((entry) => `${entry.property}: ${entry.value}（裸色值 ${entry.literal}）`),
    `${label} 里出现裸颜色值，必须走令牌（DESIGN.md §3.2-1）`,
  ).toEqual([]);
}

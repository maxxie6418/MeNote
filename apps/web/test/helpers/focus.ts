/**
 * 焦点可见性守卫（`DESIGN.md` 禁止项 #11：「用 `outline:none` 抹掉焦点；让可点击元素不可键盘触达」）。
 *
 * **为什么这条要单独守**：全局有一条 `:focus-visible { outline: 2px solid var(--primary) }`，
 * 看起来"有它就不会丢焦点"。但**特异性**会让局部规则赢——`.searchbox input`（0,1,1）>
 * `:focus-visible`（0,1,0），而 `.composer__input`（0,1,0）与它同级但**写在后面**。
 * 于是只要某条规则写了 `outline: none`，全局焦点环就被抹掉，除非它**自己或它的容器**
 * 提供了别的可见指示（`border-color` / `box-shadow` 之类）。
 *
 * 所以这里守的是"**谁被允许写 `outline: none`**"：白名单必须带理由，且白名单里的条目要真实存在
 * （防止"改完了白名单还留着"变成一张空头支票）。
 *
 * 两个必须防的坑（都是实际踩过的）：
 * 1. **先剥注释**——CSS 注释里写「禁止用 `outline:none` 抹掉焦点」会把自己判成违规；
 * 2. 只看**声明体**里的 `outline`，不看选择器名。
 */

/** 剥掉 CSS 注释（只用于扫描；不改原文件） */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** 找出所有"声明体里抹掉 outline"的规则选择器（已剥注释、已规范化空白） */
export function findOutlineSuppressors(css: string): string[] {
  const clean = stripCssComments(css);
  const out: string[] = [];
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? "").trim().replace(/\s+/g, " ");
    const body = match[2] ?? "";
    if (/outline\s*:\s*(none|0)\b/.test(body)) out.push(selector);
  }
  return out;
}

/**
 * 断言"抹掉 outline"的规则**只有白名单里那些**（每条都要写清为什么安全）。
 *
 * 返回白名单里"已经不存在"的条目，便于在用例里单独断言（避免白名单过期）。
 */
export function checkOutlineWhitelist(
  css: string,
  allowed: Readonly<Record<string, string>>,
): { unexpected: string[]; stale: string[] } {
  const found = findOutlineSuppressors(css);
  const unexpected = found.filter((selector) => !(selector in allowed));
  const stale = Object.keys(allowed).filter((selector) => !found.includes(selector));
  return { unexpected, stale };
}

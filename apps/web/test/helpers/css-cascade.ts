/**
 * 级联覆盖扫描器（`css-cascade.test.ts` 用）。
 *
 * 解决的问题：**同一个选择器 + 同一个属性在同一个文件里被写了两次、取值不同**。
 * 同一特异性下**后出现者胜**——于是"把新取值追加在文件某处"这种写法，只要后面还有一条
 * 同名旧规则，新取值就**永远不会生效**，而且**没有任何机制会报错**（用例查 DOM，
 * `style-coverage` 查"类名有没有规则"，都不看谁赢）。
 *
 * 本仓库真实踩过两次：
 * 1. v0.4.46 修掉 `.home-nav__title`（旧规则在文件末尾，后出现者胜，把中段的覆盖赢了）；
 * 2. v0.4.44–v0.4.50 的「按用户原型对齐」整批取值：对齐块写在文件中段，M2 时代的
 *    `.memopanel*` / `.timeline*` / `.memo` / `.taskpanel*` / `.kanban*` / `.taskcard*`
 *    旧块写在文件后段，整整 **15 个属性**被压回旧值，线上一直不是原型的样子（v0.5.1 才修）。
 *
 * **口径**（与 `findLaterOverrides` 一一对应）：
 * - 只比**同一选择器文本**（特异性相同）；跨选择器的优先级问题不在这里管。
 * - **`@media` / `@supports` 块内**的规则一律跳过：它是"另一个条件下才成立"的取值，
 *   覆盖外层是正常写法（本仓的 `@media (hover: none)` 命中区补偿就是这种）。
 *   —— 注意：这一条是**踩过坑才定下来的**，第一版扫描器在解析内层规则时把 `@media`
 *   的 `}` 也算成了自己的收尾，于是媒体查询上下文丢失，把合法的 `@media` 覆盖报成违规。
 * - 取值**完全相同**的重复不算违规（无害；但也没有存在的理由，清掉更好）。
 * - 注释里的 `选择器 { … }` 不算规则（先剥注释，且保留换行以便报行号）。
 * - `!important` 不建模：同一属性里写了 `!important` 的，本仓目前只出现在媒体查询块内
 *   （已被跳过）；若将来在普通块里出现，这条守卫会**漏报**，需要时再补。
 */

export interface CascadeDeclaration {
  property: string;
  value: string;
}

export interface CascadeRule {
  /** 逗号选择器列表展开后的单个选择器（已 trim） */
  selector: string;
  declarations: readonly CascadeDeclaration[];
  /** 1 起的行号（该条规则的起始行） */
  line: number;
  /** 所在的 `@media` / `@supports` 条件；不在条件块内时为 `null` */
  media: string | null;
}

export interface CascadeOverride {
  selector: string;
  property: string;
  fromValue: string;
  fromLine: number;
  toValue: string;
  toLine: number;
}

/** 剥注释、保留换行（行号不会漂） */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
}

function lineAt(css: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < css.length; i += 1) if (css[i] === "\n") line += 1;
  return line;
}

/** 某个 `{` 配对的 `}` 的下标（越界时返回 css.length） */
function matchingBrace(css: string, open: number): number {
  let depth = 1;
  for (let i = open + 1; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return css.length;
}

function splitDeclarations(body: string): CascadeDeclaration[] {
  const out: CascadeDeclaration[] = [];
  for (const part of body.split(";")) {
    const text = part.trim();
    if (!text) continue;
    const colon = text.indexOf(":");
    if (colon === -1) continue;
    out.push({ property: text.slice(0, colon).trim(), value: text.slice(colon + 1).trim() });
  }
  return out;
}

/**
 * 把样式表解析成规则清单（顺序即源码顺序）。
 *
 * 叶子块解析完后直接把游标推到它的 `}` 上，**不再触发 `}` 的处理**——所以条件块的栈不会被
 * 内层规则误弹（第一版就是在这里丢的上下文）。条件块自身不跳过，它的 `}` 会正常弹栈。
 */
export function parseRules(css: string): CascadeRule[] {
  const text = stripComments(css);
  const rules: CascadeRule[] = [];
  const stack: { head: string; conditional: boolean }[] = [];

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === "{") {
      let start = i - 1;
      while (start >= 0 && !"}{;".includes(text[start] as string)) start -= 1;
      const head = text.slice(start + 1, i).trim();
      const media = stack.filter((entry) => entry.conditional).map((entry) => entry.head);
      const mediaContext = media.length > 0 ? media.join(" && ") : null;

      if (head.startsWith("@")) {
        stack.push({ head, conditional: true });
        continue;
      }

      const close = matchingBrace(text, i);
      const declarations = splitDeclarations(text.slice(i + 1, close));
      for (const selector of head.split(",").map((part) => part.trim()).filter(Boolean)) {
        rules.push({ selector, declarations, line: lineAt(text, start + 1), media: mediaContext });
      }
      i = close; // 停在 `}` 上，下一轮 ++ 正好越过它——**不能**落在 `}` 上，否则会误弹条件块的栈
      continue;
    }

    if (ch === "}") stack.pop();
  }

  return rules;
}

/**
 * 找出"同选择器 + 同属性被更后出现的规则用**不同取值**覆盖"的每一处。
 *
 * 返回空数组 = 每个属性在文件里只有一处取值来源（或重复处取值完全相同），
 * 读样式时不必再靠目视判断谁赢。
 */
export function findLaterOverrides(rules: readonly CascadeRule[]): CascadeOverride[] {
  const bySelector = new Map<string, CascadeRule[]>();
  for (const rule of rules) {
    if (rule.media !== null) continue; // 条件块内的覆盖是正常写法
    const list = bySelector.get(rule.selector);
    if (list) list.push(rule);
    else bySelector.set(rule.selector, [rule]);
  }

  const out: CascadeOverride[] = [];
  for (const [selector, list] of bySelector) {
    if (list.length < 2) continue;
    const order: string[] = [];
    const byProperty = new Map<string, { value: string; line: number }[]>();
    for (const rule of list) {
      for (const declaration of rule.declarations) {
        if (!byProperty.has(declaration.property)) {
          byProperty.set(declaration.property, []);
          order.push(declaration.property);
        }
        byProperty.get(declaration.property)?.push({ value: declaration.value, line: rule.line });
      }
    }
    for (const property of order) {
      const entries = byProperty.get(property) ?? [];
      if (entries.length < 2) continue;
      const first = entries[0] as { value: string; line: number };
      const last = entries[entries.length - 1] as { value: string; line: number };
      if (first.value === last.value) continue;
      out.push({
        selector,
        property,
        fromValue: first.value,
        fromLine: first.line,
        toValue: last.value,
        toLine: last.line,
      });
    }
  }
  return out;
}

/** 给人看的失败信息（谁被谁压掉、在哪一行） */
export function describeOverrides(overrides: readonly CascadeOverride[]): string {
  return overrides
    .map(
      (item) =>
        `${item.selector} { ${item.property} }  L${item.fromLine}「${item.fromValue}」` +
        ` → 被 L${item.toLine}「${item.toValue}」覆盖（后者赢）`,
    )
    .join("\n");
}

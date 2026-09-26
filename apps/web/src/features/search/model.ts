/**
 * 搜索的纯逻辑（功能拆解 M10、需求 §11；M2-6）。
 *
 * 三条口径：
 * 1. **离线优先**：索引与检索都在本地完成，默认**不发网络请求**（唯一的例外是索引没建完时回退
 *    服务端，那是界面层的选择，不在本模块）。
 * 2. **中文优先**：用 `Intl.Segmenter('zh', { granularity: 'word' })` 分词；环境没有它时退化为
 *    "ASCII 按非字母数字切 + 中文二元组"。因此**命中判定用子串**（对中文最稳），分词结果只用于
 *    加分与排序——避免"分词切错就搜不到"。
 * 3. **片段交给 React 渲染**：片段以 `{ before, match, after }` 返回，不生成 HTML 字符串，
 *    调用方用 `<mark>` 拼（不引入 `dangerouslySetInnerHTML`）。
 */

/** 分词：优先用 Intl.Segmenter，退化为二元组 */
export function tokenize(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];

  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (locale: string, options: { granularity: string }) => {
        segment: (input: string) => Iterable<{ segment: string; isWordLike?: boolean }>;
      };
    }
  ).Segmenter;

  if (typeof Segmenter === "function") {
    const segmenter = new Segmenter("zh", { granularity: "word" });
    const out: string[] = [];
    for (const part of segmenter.segment(trimmed)) {
      const token = part.segment.trim().toLowerCase();
      // 只要"像词"的片段：纯标点/空白丢掉
      if (token === "" || !/[\p{L}\p{N}]/u.test(token)) continue;
      out.push(token);
    }
    if (out.length > 0) return [...new Set(out)];
  }

  return [...new Set(bigramFallback(trimmed))];
}

/** 无 Segmenter 时的退化分词：ASCII 词按非字母数字切，CJK 连续段取二元组（单字也保留） */
export function bigramFallback(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  const ascii = lower.match(/[a-z0-9]+/g) ?? [];
  out.push(...ascii);

  const cjkRuns = lower.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? [];
  for (const run of cjkRuns) {
    const chars = [...run];
    if (chars.length === 1) {
      out.push(chars[0] as string);
      continue;
    }
    for (let i = 0; i < chars.length - 1; i += 1) {
      out.push(`${chars[i]}${chars[i + 1]}`);
    }
  }
  return out;
}

/** 建索引用的文本：标题 + 标签 + 正文（标签加 `#` 前缀，方便整词命中） */
export function buildSearchText(input: {
  title: string | null;
  tags: readonly string[];
  body: string;
}): string {
  return [input.title ?? "", input.tags.map((tag) => `#${tag}`).join(" "), input.body]
    .filter((part) => part !== "")
    .join("\n");
}

export interface SearchableRow {
  item_id: string;
  text: string;
  haystack: string;
  tokens: string;
  updated_at: number;
}

export interface SnippetParts {
  before: string;
  match: string;
  after: string;
}

export interface SearchHit {
  itemId: string;
  score: number;
  snippet: SnippetParts;
}

const SNIPPET_RADIUS = 40;

/** 取高亮片段：以第一个命中的词（或整串查询）为中心，左右各留一段上下文 */
export function makeSnippet(text: string, match: string): SnippetParts {
  const flat = text.replace(/\s+/g, " ").trim();
  if (match === "") return { before: flat.slice(0, SNIPPET_RADIUS * 2), match: "", after: "" };

  const index = flat.toLowerCase().indexOf(match.toLowerCase());
  if (index === -1) return { before: flat.slice(0, SNIPPET_RADIUS * 2), match: "", after: "" };

  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(flat.length, index + match.length + SNIPPET_RADIUS);
  return {
    before: (start > 0 ? "…" : "") + flat.slice(start, index),
    match: flat.slice(index, index + match.length),
    after: flat.slice(index + match.length, end) + (end < flat.length ? "…" : ""),
  };
}

/**
 * 在索引行里检索。
 *
 * 命中判定：**每个查询词都要出现**（AND，子串匹配）；分词结果用于加分。
 * 排序：分数降序 → 最近更新降序（结果稳定，不随索引顺序抖动）。
 */
export function searchRows(query: string, rows: readonly SearchableRow[]): SearchHit[] {
  const tokens = tokenize(query);
  const needle = query.trim().toLowerCase();
  if (needle === "" || tokens.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const row of rows) {
    if (!tokens.every((token) => row.haystack.includes(token))) continue;

    let score = 0;
    if (row.haystack.includes(needle)) score += 5;
    const rowTokens = new Set(row.tokens.split(" ").filter(Boolean));
    for (const token of tokens) {
      if (rowTokens.has(token)) score += 2;
      if (row.haystack.startsWith(token)) score += 1;
    }
    // 命中位置越靠前越高（标题在最前）
    const first = row.haystack.indexOf(tokens[0] as string);
    const positionBonus = first === -1 ? 0 : Math.max(0, 3 - Math.floor(first / 20));
    score += positionBonus;

    const longest = [...tokens].sort((a, b) => b.length - a.length)[0] as string;
    hits.push({
      itemId: row.item_id,
      score,
      snippet: makeSnippet(row.text, row.haystack.includes(needle) ? query.trim() : longest),
    });
  }

  return hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const rowA = rows.find((row) => row.item_id === a.itemId);
    const rowB = rows.find((row) => row.item_id === b.itemId);
    return (rowB?.updated_at ?? 0) - (rowA?.updated_at ?? 0);
  });
}

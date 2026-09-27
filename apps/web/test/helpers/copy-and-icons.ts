/**
 * 文案红线与"图标只能用 sprite"的守卫（`DESIGN.md` 禁止项 #9 / #10）。
 *
 * #9：**不得出现**与"服务端明文 + 前端门禁"模型不符的文案（"已加密存储""数据已加密"…）。
 * #10：不得用 emoji 作图标或状态标记；不得用字体图标或外部图标库。
 *
 * 两条都**先自证再断言**（喂已知坏例），避免"扫描器没写对却报 0 处"的假绿——
 * 这个坑本程踩过三次（`Select-String -List`、多根目录 `-Include`、正则被 `=>` 搞乱）。
 */

/** #9 的禁语（设计 §9.3 文案红线） */
export const FORBIDDEN_COPY = ["已加密存储", "数据已加密", "加密存储"];

/**
 * 找出文案红线（返回命中的禁语，**长的优先、被包含的不重复报**）。
 *
 * 为什么要去重：`"加密存储"` 是 `"已加密存储"` 的子串——不去重的话一句话报两条，
 * 修起来的人会以为有两处问题（自证用例第一次跑就撞到了这一点）。
 */
export function findForbiddenCopy(text: string): string[] {
  const hits = FORBIDDEN_COPY.filter((phrase) => text.includes(phrase));
  return hits.filter((phrase) => !hits.some((other) => other !== phrase && other.includes(phrase)));
}

/**
 * #10 的 emoji 扫描：用 **Unicode 属性类**，不硬编码码位范围。
 *
 * 第一版硬编码 `[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}…]`，自证时发现 **`✅`（U+2705）扫不到**
 * ——它落在 Dingbats 区（2700–27BF）之外，正是"扫不到"那类漏洞。
 * 现在：`\p{Emoji_Presentation}`（默认就是表情形态的字符）或 `\p{Emoji}` + 变体选择符 `\uFE0F`
 * （`⚠️` 这种"文字形态 + 变体符"才当表情用）。
 *
 * 有意**不**把 `✓`（U+2713）/ `×`（U+00D7）/ `⋮⋮`（U+22EE）算进来——它们没有 Emoji 属性，
 * 是排版符号；"拿文字符号当图标"另有约束（界面稿要求用 sprite 图标），由逐个用例钉住。
 */
const EMOJI_RE = /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/gu;

/** 找出文本里的 emoji（返回逐个命中） */
export function findEmoji(text: string): string[] {
  return [...text.matchAll(EMOJI_RE)].map((match) => match[0]);
}

/** 剥掉注释，避免"文档里举例写了 emoji / 禁语"被误判（颜色那轮踩过的同类坑） */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

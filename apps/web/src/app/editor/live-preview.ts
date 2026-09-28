/**
 * 即时渲染（live preview）：正文直接呈现渲染样式，**光标所在行显示源码**。
 *
 * 这是 `wiki/` 里早已定下的需求与技术路线，不是新发明：
 * - 设计文档 §7.1：类 Typora / Obsidian 的即时渲染，四档编辑模式之一（默认仍是双栏）；
 * - 项目架构 §3.3：**基于 Lezer 语法树的装饰**（`Decoration.replace` / `widget`），
 *   **只对视口内的节点计算装饰**，光标所在行显示源码。
 *
 * 三条实现纪律（每条都对应一个真实的坑）：
 * 1. **只算视口**：Lezer 的树是**懒解析**的（建 state 后只覆盖开头一小段），所以插件里用
 *    `ensureSyntaxTree(state, 视口末端, 预算)` 把可见区补上；预算不够就退回部分树——
 *    那一屏先按源码显示，下一帧再渲染。**不要对整篇算装饰**。
 * 2. **中文输入法**：`view.composing` 期间**不重算**装饰，只把已有装饰按变更映射
 *    （`RangeSet.map`）。重算会把输入法正在组合的字/候选区替换掉，中文优先的产品不能踩这条。
 * 3. **隐藏掉的标记要进 `atomicRanges`**：否则方向键与退格会"钻"进看不见的 `**` 里，
 *    光标看着卡住不动。
 *
 * 首期（2026-09-28）覆盖**文本级**元素：标题 / 强调 / 删除线 / 行内代码 / 链接 / 引用 /
 * 列表 / 分隔线 / 代码块底色；**图片给占位块**。表格与代码围栏保持源码——
 * 逐项覆盖表与后续计划见 `docs/modules/Menote-即时渲染-设计-v1.md`。
 */
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

/** 补解析的时间预算（超出就先用部分树；与 CM6 自带高亮器同一量级） */
const PARSE_BUDGET_MS = 50;

/**
 * 标记类节点：即时渲染把它们藏起来，只留内容。
 *
 * **`CodeMark` 不在这一组**（它同时用于行内代码与代码围栏，处理方式不同）：见下面 switch 里的
 * `CodeMark` 分支——行内代码的反引号藏起来，**代码块的围栏保留可见**（首期不做围栏折叠）。
 */
const HIDDEN_MARKS = new Set(["HeaderMark", "EmphasisMark", "StrikethroughMark", "QuoteMark"]);

/**
 * 内容类节点 → 装饰类名。
 *
 * **不给表格与代码围栏做装饰**（首期有意不做）：它们的源码原样保留，
 * 免得"看着像表格但不能编辑"这种半成品。
 */
const CONTENT_CLASSES: Record<string, string> = {
  StrongEmphasis: "cm-live-strong",
  Emphasis: "cm-live-em",
  Strikethrough: "cm-live-strike",
  InlineCode: "cm-live-code",
};

/**
 * 标题层级 → 行装饰类名。
 *
 * 字号**只用现有 6 档刻度**（`tokens.css` 的 `--fs-display/title/body-lg/body/small/micro`），
 * 不新增令牌、不写裸 px：h1 20 / h2 17 / h3 14 / h4 13 / h5 12 / h6 11。
 * h5/h6 比正文小是刻意的（与 Obsidian 一致：小标题本就比正文小）。
 */
const HEADING_CLASSES: Record<string, string> = {
  ATXHeading1: "cm-live-h1",
  ATXHeading2: "cm-live-h2",
  ATXHeading3: "cm-live-h3",
  ATXHeading4: "cm-live-h4",
  ATXHeading5: "cm-live-h5",
  ATXHeading6: "cm-live-h6",
};

/** 列表的项目符号（换成 `•`）；有序列表的数字保留——数字本身有信息量 */
const BULLET_MARKS = new Set(["-", "*", "+"]);

/** 链接的样式（内联链接给 label，裸 URL 给自己） */
const linkMark = Decoration.mark({ class: "cm-live-link" });
/** 引用行的行样式（左侧一条竖线） */
const quoteLine = Decoration.line({ class: "cm-live-quote" });
/** 代码块的行样式（底色；围栏与语言保持源码可见） */
const codeBlockLine = Decoration.line({ class: "cm-live-codeblock" });
/** 分隔线所在行（藏掉 `---` 之后靠它画一条线） */
const ruleLine = Decoration.line({ class: "cm-live-hr" });

/** 项目符号占位 */
class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-bullet";
    span.textContent = "•";
    return span;
  }
}

/**
 * 图片占位块（首期不做内联图片）。
 *
 * **只显示 alt 文本**：alt 里本来就带着附件状态（上传中写的是「上传中：文件名」），
 * 而地址里的 sha256 是内部标识，界面不该出现（M4 界面稿 §7.4）。
 */
class ImagePlaceholderWidget extends WidgetType {
  readonly alt: string;

  constructor(alt: string) {
    super();
    this.alt = alt;
  }

  override eq(other: ImagePlaceholderWidget): boolean {
    return other.alt === this.alt;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-image";
    span.textContent = this.alt.trim() === "" ? "图片" : `图片 · ${this.alt}`;
    span.title = "图片暂不内联显示；光标移到这一行可以看源码";
    return span;
  }
}

const bulletWidget = Decoration.replace({ widget: new BulletWidget() });

export interface LivePreviewInput {
  state: EditorState;
  /** 装饰区间（浏览器里是视口；测试里可传全文） */
  from: number;
  to: number;
  /**
   * 光标（或选区）覆盖的行区间：这一片**显示源码**。
   * 单光标就是它所在的那一行；跨行选区是整个跨度（这样复制出来的仍是带标记的 md）。
   */
  activeRange: { from: number; to: number } | null;
}

export interface LivePreviewDecorations {
  /** 作用于文档的装饰 */
  decorations: DecorationSet;
  /** 被藏掉/替换掉的区间：进 `atomicRanges`，方向键与退格不许钻进去 */
  atomic: DecorationSet;
}

/**
 * **纯函数**：`EditorState` + 区间 → 装饰集。
 *
 * 单独抽出来的理由（重要）：全仓测试都把 CodeMirror 整个 mock 掉（真实 CM6 要布局 API，
 * jsdom 跑不动），而"哪些标记被藏了、活动行有没有露源码"这条逻辑必须能进 CI。
 * 装饰构建只依赖 state 与语法树，不需要视图，所以能在 jsdom 里逐条断言。
 */
export function buildLivePreviewDecorations(input: LivePreviewInput): LivePreviewDecorations {
  const { state, from, to, activeRange } = input;
  const tree = ensureSyntaxTree(state, to, PARSE_BUDGET_MS) ?? syntaxTree(state);
  const doc = state.doc;
  const ranges: Range<Decoration>[] = [];
  const atomicRanges: Range<Decoration>[] = [];

  /** 命中活动行（或跨行选区）的区间不隐藏：这就是"光标所在行显示源码" */
  const inActive = (start: number, end: number): boolean =>
    activeRange !== null && start <= activeRange.to && end >= activeRange.from;

  const hide = (start: number, end: number): void => {
    if (end <= start || inActive(start, end)) return;
    const range = Decoration.replace({}).range(start, end);
    ranges.push(range);
    atomicRanges.push(range);
  };

  /**
   * 藏标记时**连它后面那个空格一起藏**（标题 `## ` 与引用 `> `）。
   *
   * 不藏那个空格的话，渲染出来的标题/引用会带一个前导空格——比"少藏一个字符"显眼得多。
   * 列表名目不需要（`- ` 的空格正好是 `•` 与文字之间的间距）。
   */
  const hideMarkWithSpace = (start: number, end: number): void => {
    const hasSpace = doc.sliceString(end, end + 1) === " ";
    hide(start, hasSpace ? end + 1 : end);
  };

  const addLine = (lineDecoration: Decoration, pos: number): void => {
    ranges.push(lineDecoration.range(doc.lineAt(Math.min(pos, doc.length)).from));
  };

  /** 内联链接 `[label](url)` 的 label 区间；不是内联链接时返回 null */
  const inlineLabelRange = (link: { from: number; to: number; firstChild: unknown }): {
    from: number;
    to: number;
  } | null => {
    if (doc.sliceString(link.from, Math.min(link.from + 1, link.to)) !== "[") return null;
    const marks: Array<{ from: number; to: number }> = [];
    let child = link.firstChild as { name: string; from: number; to: number; nextSibling: unknown } | null;
    while (child) {
      if (child.name === "LinkMark") marks.push({ from: child.from, to: child.to });
      child = child.nextSibling as typeof child;
    }
    const first = marks[0];
    const second = marks[1];
    return first && second ? { from: first.to, to: second.from } : null;
  };

  tree.iterate({
    from,
    to,
    enter: (node) => {
      const heading = HEADING_CLASSES[node.name];
      if (heading) {
        addLine(Decoration.line({ class: heading }), node.from);
        return;
      }

      const contentClass = CONTENT_CLASSES[node.name];
      if (contentClass) {
        ranges.push(Decoration.mark({ class: contentClass }).range(node.from, node.to));
        return;
      }

      if (HIDDEN_MARKS.has(node.name)) {
        // 标题 `##` 与引用 `>` 后面那个空格一起藏（否则渲染结果带前导空格）
        if (node.name === "HeaderMark" || node.name === "QuoteMark") {
          hideMarkWithSpace(node.from, node.to);
        } else {
          hide(node.from, node.to);
        }
        return;
      }

      switch (node.name) {
        case "CodeMark": {
          // 行内代码的反引号藏起来；**代码块的围栏保留**（藏了会在块头留一个空行，很难看）
          if (node.node.parent?.name !== "FencedCode") hide(node.from, node.to);
          return;
        }
        case "Blockquote": {
          // 引用的每一行都画左侧竖线（跨多行的引用也成立）
          const last = doc.lineAt(Math.min(node.to, doc.length));
          for (let line = doc.lineAt(node.from); line.number <= last.number; line = doc.line(line.number + 1)) {
            addLine(quoteLine, line.from);
            if (line.number === last.number) break;
          }
          return;
        }
        case "FencedCode": {
          const last = doc.lineAt(Math.min(node.to, doc.length));
          for (let line = doc.lineAt(node.from); line.number <= last.number; line = doc.line(line.number + 1)) {
            addLine(codeBlockLine, line.from);
            if (line.number === last.number) break;
          }
          return;
        }
        case "HorizontalRule": {
          hide(node.from, node.to);
          addLine(ruleLine, node.from);
          return;
        }
        case "Image": {
          if (inActive(node.from, node.to)) return; // 光标在这一行：看源码（含地址）
          const range = Decoration.replace({
            widget: new ImagePlaceholderWidget(altOf(doc, node.from, node.to)),
          }).range(node.from, node.to);
          ranges.push(range);
          atomicRanges.push(range);
          return;
        }
        case "ListMark": {
          const text = doc.sliceString(node.from, node.to);
          if (BULLET_MARKS.has(text)) {
            if (inActive(node.from, node.to)) return;
            const range = bulletWidget.range(node.from, node.to);
            ranges.push(range);
            atomicRanges.push(range);
          }
          return;
        }
        case "Link": {
          const label = inlineLabelRange(node.node);
          if (label) {
            ranges.push(linkMark.range(label.from, label.to));
            // 方括号与地址一起藏起来（地址里的 sha256 是内部标识，界面上不该出现）
            for (const child of childrenOf(node.node)) {
              if (child.name === "LinkMark" || child.name === "URL") hide(child.from, child.to);
            }
          }
          return;
        }
        case "Autolink": {
          // `<https://…>`：语法树是独立的 `Autolink` 节点（不是 `Link`），只藏尖括号，
          // 地址本身就是要显示的文字
          for (const child of childrenOf(node.node)) {
            if (child.name === "LinkMark") hide(child.from, child.to);
          }
          const url = node.node.getChild("URL");
          if (url) ranges.push(linkMark.range(url.from, url.to));
          return;
        }
        case "URL": {
          // 裸 URL（GFM autolink）：父级不是 Link，文字本身要留着，只上链接样式
          if (node.node.parent?.name !== "Link") ranges.push(linkMark.range(node.from, node.to));
          return;
        }
        default:
          return;
      }
    },
  });

  return {
    decorations: Decoration.set(ranges, true),
    atomic: Decoration.set(atomicRanges, true),
  };
}

/** 图片的 alt：`![alt](url)` 里两个 LinkMark 之间的内容（没有就空串） */
function altOf(doc: EditorState["doc"], from: number, to: number): string {
  const text = doc.sliceString(from, to);
  const matched = /^!\[([\s\S]*?)\]/.exec(text);
  return (matched?.[1] ?? "").replace(/\n/g, " ").trim();
}

/** 直接子节点清单（`SyntaxNode` 的 firstChild/nextSibling 链） */
function childrenOf(node: {
  firstChild: unknown;
}): Array<{ name: string; from: number; to: number }> {
  const out: Array<{ name: string; from: number; to: number }> = [];
  let child = node.firstChild as { name: string; from: number; to: number; nextSibling: unknown } | null;
  while (child) {
    out.push({ name: child.name, from: child.from, to: child.to });
    child = child.nextSibling as typeof child;
  }
  return out;
}

/** 光标（或选区）覆盖的行区间；单光标就是它所在那一行 */
export function activeRangeOf(state: EditorState): { from: number; to: number } | null {
  if (state.selection.ranges.length === 0) return null;
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const range of state.selection.ranges) {
    from = Math.min(from, state.doc.lineAt(range.from).from);
    to = Math.max(to, state.doc.lineAt(range.to).to);
  }
  return { from, to };
}

/** 视图里那个只算视口的插件 */
class LivePreviewPlugin {
  decorations: DecorationSet;
  atomic: DecorationSet;

  constructor(view: EditorView) {
    const built = buildFor(view);
    this.decorations = built.decorations;
    this.atomic = built.atomic;
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      // 先映射位置：这样即使下面不重算，装饰也不会指向已经不存在的区间
      this.decorations = this.decorations.map(update.changes);
      this.atomic = this.atomic.map(update.changes);
    }
    // 输入法组合期间**不重算**（位置已由映射保住）：重算会把组合中的字替换掉、光标乱跳
    if (update.view.composing) return;
    // `focusChanged` 要一起看：聚焦时"光标那一行"才露源码，失焦时整篇渲染（见 `buildFor`）
    if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged) {
      const built = buildFor(update.view);
      this.decorations = built.decorations;
      this.atomic = built.atomic;
    }
  }
}

function buildFor(view: EditorView): LivePreviewDecorations {
  const { from, to } = view.viewport;
  return buildLivePreviewDecorations({
    state: view.state,
    from,
    to,
    /*
      「光标所在行显示源码」只在**编辑器真的聚焦时**成立。
      否则刚打开一篇笔记（CM6 的选区默认落在文档开头）会让第一行一直露着 `##`——
      看着像"没渲染"。失焦状态下整篇按渲染呈现，点进哪一行哪一行才回到源码。
    */
    activeRange: view.hasFocus ? activeRangeOf(view.state) : null,
  });
}

/** 即时渲染扩展（`Editor` 按模式挂它） */
export function livePreview(): Extension {
  const plugin = ViewPlugin.fromClass(LivePreviewPlugin, {
    decorations: (instance) => instance.decorations,
  });

  return [
    plugin,
    // 藏掉的标记成为"原子区间"：方向键/退格一次跨过去，不会停在看不见的标记中间
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  ];
}

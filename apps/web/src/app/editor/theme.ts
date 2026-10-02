/**
 * CodeMirror 6 的**结构性**基座主题（`EditorView.baseTheme`）。
 *
 * 为什么单独有这一个文件：观感类样式（颜色、字号、留白）一律走 `app.css` 的
 * 令牌（`DESIGN.md` §3.2-1「一切颜色走令牌，没有例外」），而下面这几条是
 * **令牌管不着、只能由编辑器自己声明**的：
 *
 * 1. **焦点环**。CM6 默认给 `contenteditable` 留了浏览器焦点环。编辑器有自己的光标
 *    与活动行，再套一圈外描边就是"这个控件没做完"的样子。
 * 2. **浮层底色**。`.cm-tooltip` / `.cm-panels` 默认自带白底 + 描边 + 阴影。
 *    这里只**拆掉**默认底（颜色由 `app.css` 按令牌给），不自己定色。
 * 3. **面板层级**。浮层必须压在正文之上，否则被 `overflow` 裁掉。
 *
 * 参考做法来自外部项目 inkstone 的 `src/client/editor/theme.ts`（同为 9 行量级的收口）。
 * 那边还有一整套 `closeBrackets` / `drawSelection` / `search` 等功能扩展——那些要引新依赖，
 * 不在本轮范围（见 `docs/archive/Menote-编辑器性能与样式收口-实施计划-v1.md` §三）。
 */
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export function editorBaseTheme(): Extension {
  return EditorView.baseTheme({
    // 填满宿主给的编辑区（`app.css` 里 `.cm-editor { min-height: 100% }` 管的是下限）
    "&": { height: "100%" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit" },
    // 拆默认底，交给 `app.css` 按令牌重上
    ".cm-tooltip": { border: "none", background: "transparent" },
    ".cm-panels": { zIndex: "20" },
  });
}

# Menote 即时渲染首期 · 实施计划 v1

| 项 | 值 |
|---|---|
| 文档版本 | v1.1 |
| 文档状态 | 已完成（归档；首期已落地并经真实 Chrome 实测） |
| 目的和适用范围 | 「即时渲染」编辑模式**首期**（文本级元素 + 图片占位）的实施计划：目标、拆步、涉及文件、验收点、实测结果、遗留 |
| 权威级别 | 历史参考（临时规则，任务已完成） |
| 最后更新日期 | 2026-09-28 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1.1 | v0.5.5 | 2026-09-28 | 收官：首期落地（代码提交见 CHANGELOG），补 §四 实测与 §五 遗留 | deepseek-v4.1-flash |
| v1 | v0.5.5 | 2026-09-28 | 首版：可行性探针结论、拆步、涉及文件、验收点 | deepseek-v4.1-flash |

## 一、目标与范围（用户 2026-09-28 拍板）

- **做**：文本级元素——标题 / 粗体 / 斜体 / 删除线 / 行内代码 / 链接 / 引用 / 无序与有序列表 / 分隔线；**图片给占位块**；**光标所在行显示源码**（按行，架构文档原文）。
- **不做**：GFM 表格内联、代码块语言高亮、任务清单可勾选、图片内联、front matter 处理、`#标签` chip（逐条理由与后续顺序见设计文档 §七）。
- 设计与覆盖表：`docs/modules/Menote-即时渲染-设计-v1.md`。

## 二、开工前的可行性探针（不进仓库，一次性脚本）

| 探针 | 结论 |
|---|---|
| Lezer 节点清单 | 首期要的元素树里全都有现成节点名（`ATXHeading*`/`HeaderMark`、`StrongEmphasis`/`EmphasisMark`、`Strikethrough`、`InlineCode`/`CodeMark`、`Link`/`LinkMark`/`URL`、`Autolink`、`Blockquote`/`QuoteMark`、`ListMark`、`Task`/`TaskMarker`、`Table*`、`FencedCode`…） |
| 装饰原语 | `Decoration.replace/mark/line`、`WidgetType`、`ViewPlugin.fromClass`、`EditorView.decorations`、`EditorView.atomicRanges.of` 全部可用 |
| **关键发现 1** | `markdown()` 默认 base 是**纯 CommonMark**：表格/任务清单/删除线/裸 URL 都没解析。换 `markdown({ base: markdownLanguage })` 后全部出现，且**不需要新增依赖** |
| **关键发现 2** | 语法树**懒解析**：建 state 后只覆盖前 ~3011 字符。所以必须 `ensureSyntaxTree(视口末端, 预算)` |
| 成本 | 视口 4KB 装饰 0.4–1.1ms / 397 处；800KB 文档敲一个字（增量解析 + 局部装饰）headless 中位 26ms、最慢 42ms |

## 三、拆步（实际执行）

| 步 | 内容 | 落点 |
|---|---|---|
| 1 | 契约与设置页：`EditorModeSchema` 加 `live`；第四档解禁；用例同步 | `packages/shared/src/settings.ts`、`SettingsPanel.tsx`、`ui.test.tsx` |
| 2 | 核心纯函数 + 插件 + 两个 widget | `apps/web/src/app/editor/live-preview.ts`（新增） |
| 3 | 编辑器接线：`live` prop（Compartment）、GFM base、行号互斥 | `Editor.tsx` |
| 4 | 正文区第四档与单栏渲染 | `NoteWorkspace.tsx` |
| 5 | 样式（只用现有令牌） | `app.css` 的 `.cm-live-*` |
| 6 | 用例 19 条（覆盖表逐项 + 活动行 + 原子区间） | `apps/web/test/live-preview.test.ts`（新增） |
| 7 | 真机实测与截图 | 见 §四 |

## 四、验收点与实测结果

| # | 验收点 | 结果 |
|---|---|---|
| 1 | 首期元素逐项渲染，且 `**`/`~~`/md 链接地址/sha256 不出现在可见文本里 | ✅ 实测通过（逐行核对 `.cm-content`） |
| 2 | 光标所在行显示源码；其余行渲染 | ✅ 实测：点进「引用」行只该行露 `> 引用一行` |
| 3 | 失焦时整篇渲染（本轮加的细化，避免"刚打开像没渲染"） | ✅ 实测 |
| 4 | 真实按键输入不吃掉标记 | ✅ 实测：点进渲染文本后真实键盘输入，切回仅编辑可见 `**粗体**` 原样保留 |
| 5 | `仅编辑 ↔ 即时渲染` 不重建文档 | ✅ 实测：切换后 `.cm-content` 仍是同一个 DOM 节点 |
| 6 | 即时渲染下行号不显示 | ✅ 实测 |
| 7 | 设置页第四档可选 | ✅ 实测 `disabled=false` |
| 8 | lint / typecheck / 全套用例 | ✅ web 795 → **814**（+19）；lint、typecheck 全绿 |

> **一次测试方法的翻车（记下来）**：第一版"打字"用 `document.execCommand("insertText")` 模拟，
> 结果它绕过 CM6 的输入管线、直接把 DOM 改动喂回去，**把一整段正文吃掉了**（看着像致命 bug）。
> 换成 `agent-browser keyboard type`（真实按键事件）后行为完全正常。**教训：编辑器行为只能用真实输入事件验，
> `execCommand` 这类直接改 DOM 的写法不算数。**

## 五、遗留（不在首期，按建议顺序见设计文档 §七）

1. **中文输入法人工验收**（最高优先，自动化测不了）；
2. 长文档深滚动复核（800KB 级）；
3. GFM 表格内联、图片内联、代码块语言高亮、任务清单可勾选、front matter 处理、`#标签` chip；
4. `DESIGN.md` 补一节即时渲染的视觉细则（**改它需要用户点头**，本轮未动）；
5. 移动端（随移动端布局一并做）。

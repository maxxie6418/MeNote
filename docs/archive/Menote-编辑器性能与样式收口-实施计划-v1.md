# Menote 编辑器性能与样式收口 实施计划 v1

| 项 | 值 |
|---|---|
| 文档版本 | v1.1 |
| 文档状态 | **已完成（已归档 2026-10-02）**：六步全部落地（v0.6.5）。验收点 3–6 属真机人工项，未逐项验证（见 §四末行） |
| 目的和适用范围 | 参照外部项目 [inkstone](https://github.com/shuaiplus/inkstone) 的两处成熟做法，收口 MeNote 编辑器的**打字卡顿**与**样式不统一**。本计划只覆盖**共享编辑器本体**（`apps/web/src/app/editor/`）与其样式；不碰分包策略、不碰 `wiki/`、不改 `DESIGN.md` |
| 权威级别 | 临时规则（实施计划；产品口径仍以 `wiki/` 与 `DESIGN.md` 为准） |
| 最后更新日期 | 2026-10-01 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1.1 | v0.6.9 | 2026-10-02 | 归档：六步全部落地（v0.6.5），移入 `docs/archive/`。§四验收点 3–6（试验页观感、长任务读数等真机人工项）未逐项验证，特此留档 | GLM-5.3-Flash |
| v1 | v0.6.5 | 2026-10-01 | 初稿：拆成「装饰重算节流」与「样式收口」两步 | MiniMax-M3.1-Flash-Preview |

---

## 一、问题与依据

### 1.1 性能：每次事务都同步重算装饰

`apps/web/src/app/editor/live-preview.ts` 的插件原本在
`docChanged / viewportChanged / selectionSet / focusChanged` **任一**成立时就**同步**跑一遍
`buildLivePreviewDecorations()`，里面含 `ensureSyntaxTree(state, 视口末端, 50ms)`。

后果：长文档里**敲一个字**和**按一次方向键**都要付一次语法树补解析预算。
本仓库自己的实测（`docs/modules/Menote-即时渲染-设计-v1.md` §六）记的是 800KB 文档
"敲一个字"增量解析 + 局部装饰中位 26ms。

inkstone 的做法（`src/client/editor/live-preview.ts`）：打字时**不重算 HTML**，
只把没被这次改动碰到的块的缓存与行号一起平移；整篇重解析推迟到停手 90ms 之后。

### 1.2 样式：三处不统一

1. **预览与即时渲染各写一套排版**。`.cm-live-*`（`app.css` 原 729–833）与
   `.markdown-body`（原 845–879）并行维护，注释里靠"与预览同口径"人工对齐。
   实测已经漂了：`.markdown-body` **完全没有** `strong / em / del / 标题字号 / 引用 / 分隔线`
   的规则，预览侧标题走浏览器默认（h1 约 32px），编辑器侧走 6 档刻度（20px）——
   同一篇文档在两档里标题大小完全不同。
2. **CodeMirror 自带外观一条都没收口**。全仓没有任何 `EditorView.theme` / `baseTheme`，
   也没有 `.cm-tooltip` / `.cm-panels` / `.cm-cursor` / `.cm-selectionBackground` /
   `.cm-gutters` / `.cm-placeholder` 的样式，浮层与选区全是库默认外观。
3. **两档正文宽度不一致**。只有即时渲染档收窄到 740px，仅编辑档满幅铺开，
   切档时整块正文横向跳一次。（且 740px 是 `DESIGN.md` §2.3 的已定稿口径，仅编辑档本来就没守住。）

## 二、拆步与涉及文件

| 步 | 做什么 | 涉及文件 |
|---|---|---|
| 1 | 装饰重算节流：打字走停手防抖，光标/滚动走帧合并；`destroy` 撤定时器 | `apps/web/src/app/editor/live-preview.ts` |
| 2 | 新增 `baseTheme`，收口焦点环 / tooltip 底 / 面板层级等结构性覆盖 | `apps/web/src/app/editor/theme.ts`（新增） |
| 3 | 编辑器挂上 `baseTheme` + `drawSelection` | `apps/web/src/app/editor/Editor.tsx` |
| 4 | 样式收口：两档同宽、补齐 CM6 外观、预览与即时渲染共用排版规则 | `apps/web/src/app/theme/app.css` |
| 5 | 记档到即时渲染设计文档 | `docs/modules/Menote-即时渲染-设计-v1.md` |
| 6 | `CHANGELOG` + 版本号 | `CHANGELOG.md`、根 `package.json` |

## 三、明确不做（本轮）

- **不改分包策略**。wiki 架构 §14.1「编辑器与渲染各自独立分包，不进首屏」是定稿，
  照 inkstone 取消分包需要用户先点头，本轮不碰。
- **不改 `key={item.id}`**。切条目重建视图是另一条路（"换文档不换视图"），会改变
  "切条目丢撤销历史"这个现有行为，留给下一轮单独拍板。
- **不引入 CM6 新依赖**（`@codemirror/autocomplete` / `search` / `language` 的
  `foldGutter` 等）。这些是功能扩展不是样式收口，且要动 `package.json` 生产依赖。
- **不改 `DESIGN.md`**。本轮只把实现对齐到它已有的口径（740px、令牌），不加新令牌。

## 四、验收点

1. `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿（web 用例数不低于改前）。
2. `apps/web/test/live-preview.test.ts` 全绿——**纯函数 `buildLivePreviewDecorations`
   的签名与行为一字未改**，节流只发生在插件层。
3. 设置 › 编辑试验页：四档来回切，正文左右起止线不再横向跳。
4. 同页：预览档与即时渲染档，同一篇文档的标题、强调、行内代码、链接**看起来一致**。
5. 同页：切到仅编辑档，光标、选区、活动行、行号槽、tooltip 面板都不再是库默认外观。
6. 长任务读数：800KB 样文（`编辑器试验` 存储）连续打字，长任务次数与最长耗时相对改前下降。
   **本机无登录态，线上逐屏点验仍需人工**（见交付说明）。

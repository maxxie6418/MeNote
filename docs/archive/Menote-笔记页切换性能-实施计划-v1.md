# Menote 笔记页「切换笔记卡顿」实施计划 v1

| 项 | 值 |
|---|---|
| 文档版本 | v1.2 |
| 文档状态 | **A、B 两步均已完成并验证**（v0.5.3） |
| 目的和适用范围 | 修用户反馈的「笔记页切换笔记很卡、有延迟」。范围限**笔记区列表与正文区的渲染成本**与**选中态与正文加载的耦合**；不动数据模型、API、同步协议、视觉取值 |
| 权威级别 | 模块规则（本屏执行口径；结论并入 `wiki/` 或 `DESIGN.md` 后再升级） |
| 最后更新日期 | 2026-09-27 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1.2 | v0.5.3 | 2026-09-27 | B 步落地并验证：**占位不牵动列表**（`openingId` 显式标记 + `applySelectedId` 移回正文到位那一批 + `NoteList` 加 `memo`）——第一版把选中态提前抬，实测让缓存命中路径 72ms → 250ms，已改掉；缓存未命中时反馈 6–8ms 出现（改前要等正文 123–1759ms） | deepseek-v4.1-flash |
| v1.1 | v0.5.3 | 2026-09-27 | A 步落地并**同口径复量**：2000 篇下"点一行 → 界面换过去" 249ms → **26.8ms（中位）**，长任务 137–227ms → 基本消失；顺带按 500 行预算把 Memo 写入拆到 `features/memos/useMemoWrite.ts` | deepseek-v4.1-flash |
| v1 | v0.5.3 | 2026-09-27 | 首版：诊断（真实 Chrome 实测）→ A/B 两步方案与验收点 | deepseek-v4.1-flash |

---

## 一、起因与实测

用户反馈：**笔记页切换笔记很卡、有延迟**；追问确认"每一篇都卡，包括刚打开过的那篇"，用的是**线上部署**。

先排除了两条：
- **不是网络**：正文已在本地（刚打开过的那篇命中 `bodies` 缓存）时不发请求，仍然卡；
- **不是正文体积**：1.5MB 的长笔记（CodeMirror 只渲染视口）与 4KB 笔记差别很小。

在一个**完全隔离的本地环境**（独立临时 D1/R2/KV，不碰 `apps/web/.wrangler/state`）用真实 Chrome（headless，dev 构建，另用去掉 StrictMode 的对照跑过，量级一致）量到：

| 当前列表条数 | 点一行 → 界面真的换过去 | 主线程长任务（`PerformanceObserver` longtask） |
|---|---|---|
| 200 | 28–45ms | 无 |
| **2000** | **128–234ms（中位 ~191ms）** | **137–227ms 一条不间断** |
| 2000 + 一篇 1.5MB 长笔记 | 285ms | — |

**成本 ≈ 列表行数 × ~0.1ms + 约 20–30ms 固定开销**。

两条独立成因：

1. **列表整表重渲染**（随规模增长的那一项）。`NoteList` 把所有行一次性铺出来、无虚拟化，每行还现场构造 `DropdownMenu` 的 items（含 `folders.map`、`new Date` 格式化）。而且它**不只在切换时重渲染**：`NotesPane` 每次渲染都新建 `list={<NoteList … />}` 与全部内联回调，而编辑器每敲一个字都会 `setSnapshot` → `workspace` 换身份 → App 重渲染 → 列表整表重渲染。**根因是回调/props 身份不稳定** —— 只加 `memo` 无效。
2. **正文区整体重挂**（约 20–30ms 固定开销）。`NotesPane` 用 `key={selectedId}`、`NoteWorkspace` 内部用 `key={item.id}`；`MarkdownPreview` 每次渲染都重跑 `renderMarkdown`（markdown-it + DOMPurify）。
3. **选中与读正文耦合**：`open()` 里 `setSelectedId()` 排在 `await editor.load()` 之后（[useNotesWorkspace.ts:323–343](../../apps/web/src/features/notes/useNotesWorkspace.ts)），期间界面**没有任何反馈**（列表高亮都不动、无 loading）。本地命中时是几毫秒；正文不在本机时是**一整个 RTT**（2026-09-27 `8bc8476` 起 `load()` 会去服务端补拉）。用 200ms 模拟往返实测：点下去 **153ms 时界面与没点一样**，284ms 才换过去。

## 二、A 步：消掉整表重渲染（本步）

做法：**先把身份稳定化，再在行上落 `memo`**。顺序不能反——不稳定的 props 会让 `memo` 完全失效。

| # | 动作 | 涉及文件 |
|---|---|---|
| A-1 | `onLocalWrite` 经 ref 转发，对外暴露一个恒定身份的包装；`selectedId` / `initialBody` 同时存 ref（渲染用 state）。于是 `refresh` / `open` / `changeTitle` / `createNote` / `patchItem` / `moveItemToVault` 身份不再随每次渲染与每次选中而变 | `features/notes/useNotesWorkspace.ts` |
| A-2 | 传给列表的动作全部 `useCallback` 包一层；`vault` 对象 `useMemo` | `app/workarea/NotesPane.tsx` |
| A-3 | 加密空间文件夹数组 `useMemo`、移入/移出 `useCallback`；`onToast` 直接传稳定的 `pushToast` | `app/NotesSlot.tsx`、`app/App.tsx` |
| A-4 | 行抽成 `NoteRow`（`React.memo`），props 一律**原始值或稳定引用**（`item` / `selected` / `summary` / `unlocked` / `folders` / 回调 / `vault`） | 新增 `features/notes/ui/NoteRow.tsx`；`features/notes/ui/NoteList.tsx` |
| A-5 | `renderMarkdown` + 附件装饰按 `source` / `attachments` 记忆化 | `app/editor/MarkdownPreview.tsx` |

**不做**（留给后续）：列表虚拟化（行高不固定、要动滚动容器、移动端布局未定稿）；`refresh()` 的全表扫描瘦身；标题输入的防抖与入队节奏调整。

## 三、B 步：解耦选中与读正文（已完成，v0.5.3）

**做法（最终版，与首版方案的差别在 §3.2）**：`open()` 分两阶段。

1. **阶段 1（同步、无 await）**：只抬一个**显式的** `openingId` —— 正文区立刻换成「正在打开…」占位
   （`NotesPane` 在 `docLoading` 为真时不挂 `NoteWorkspace`：既不把上一篇的正文/标题留在屏上，
   旧编辑器的自动保存定时器也随之停下）。同时清掉上一篇的跨标签页/冲突提示。
2. **阶段 2（异步）**：创建编辑器 → `await editor.load()`（本地命中 1–5ms；不在本机则一次服务端往返）
   → **取代检查**（`editorRef.current !== editor` 就整段退出：连点两篇时后点的赢）
   → `applyInitialBody` + `applySelectedId` + `docVersion.epoch + 1` + 清 `openingId` 一次提交落地
   → `syncConflictState` → 再次取代检查 → `editor.start()`。

`NotesWorkspace` 新增两个字段：`docLoading`（正文未到）与 `docEpoch`（每次正文到位 +1，进正文区 key）。
`editorIdRef` 让 `notifyUploaded` 只认"属于当前显示这一篇"的回调（上一篇迟到的回调不再改掉这一篇的打开基准）。

### 3.1 为什么 `docEpoch` 要进 key
`NoteWorkspace.previewSource` 是 mount 时初始化的 state：同一篇"按最新内容重新载入"时 id 不变，
不重挂就一直是旧内容（编辑器也不吃 `initialValue` 的后续变化）。把 `docEpoch` 拼进 key 后，
重新载入真的会换上新正文。

### 3.2 为什么最终**没有**在阶段 1 抬 `selectedId`（实测取舍）
首版是"阶段 1 同时抬 `selectedId`（列表高亮立刻动）+ 占位"。实现后做同口径对照（隔离环境 + 真实 Chrome，
2000 篇，dev 构建）发现**缓存命中这条最常见路径明显变慢**：

| 缓存命中（中位） | 点行 → 正文画出来 |
|---|---|
| 不带 B（临时 stash 掉源文件做对照） | **72ms**（分布 25–398ms） |
| 首版 B（阶段 1 抬 `selectedId`） | **250.8ms** |
| **最终版 B（占位不牵动列表）** | **91.8ms**（分布 71–94ms，无离群） |

原因：`selectedId` 是**整张列表的选中项**，抬它会让列表与 App 整棵树多提交一次；
而正文通常 1–5ms 就到，那次提交纯属白花。改成"只抬占位"后，那次提交变得很便宜——
前提是列表要被 `memo` 跳过（本次给 `NoteList` 外壳加了 `memo`，它的 props 在 A 步已全部稳定）。

**取舍点（已钉进用例）**：缓存未命中时，列表高亮**要等正文到**才移动，早反馈由正文区占位承担。
这是有意的——用"高亮早 200ms"换"每次切换少一整棵树的提交"。

### 3.3 验收（B 步）
- 新增 `test/notes-open-feedback.test.tsx`（3 例）：①正文不在本机时点下去立刻出现「正在打开…」、
  没有编辑器与标题输入框，且**高亮仍停在上一篇**（把 §3.2 的取舍钉住），正文到后选中态与正文同批落地；
  ②连点两篇——先点的慢请求（80ms）回来不覆盖后点的（5ms）；③「按最新内容重新载入」真的换上新正文。
- **回退验证过**：把阶段 1 的 `setOpeningId(id)` 注释掉 → 用例 ① 立刻红（找不到 `正在打开`），恢复即绿。
- **同口径复量（隔离环境 + 真实 Chrome，2000 篇 + 一篇 840KB 服务端笔记）**：
  - 缓存未命中（清掉本地正文缓存）：**占位 6–8ms 出现**（改前是"界面一动不动"，直到正文就绪才换），
    正文 123ms / 439ms / 1759ms（大笔记那次要等取回 + 落库 + 全文渲染）；
  - 缓存命中：占位 7–9ms、正文 71–94ms（见 §3.2 表）。
- `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿，全套 **1108**（shared 62 / mdcore 65 / **web 773**（+5）/ worker 208）。

### 3.4 顺带修掉的一处既有缺陷
`notifyUploaded` 此前用"当前选中项"写打开基准：上一篇编辑器迟到的上传回调会把**这一篇**的基准改掉
（跨标签页提示因此可能误报/漏报）。现在按 `editorIdRef` 只认自己的那一篇。

## 四、验收点

A 步：

1. ✅ **只有变化的行重渲染**：50 行的列表，只改 `selectedId` → 只有 2 行被再次渲染
   （`test/notes-list-memo.test.tsx`，用"字段 getter 计数"钉住；**先在旧实现上跑到红**：50 行全渲染）。
2. ✅ **无关 props 变化不重渲染任何行**：`summaries` 换一个新对象但内容不变 → 0 行重渲染（同一用例）。
3. ✅ **同口径复量**（隔离环境 + 真实 Chrome，脚本同前一轮）：2000 篇下"点一行 → 标题/高亮/预览都换过去"
   **249ms → 26.8ms（中位，5 次：27.9 / 23.8 / 66.1 / 27.6 / 28.2）**；
   `PerformanceObserver` 的 longtask **由每次一条 137–227ms 变为基本没有**（4 次里 3 次 0 条，1 次 51ms）。
4. ✅ `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿；列表行结构用例（`notes-list-row.test.tsx`）未改断言即通过。
   全套 **1105**（shared 62 / mdcore 65 / **web 770**（+2 新用例）/ worker 208）。

**顺带**（不是本步目标，但被行数预算逼出来的）：`useNotesWorkspace.ts` 因本次稳定化代码顶到 500 行预算，
按仓库既有做法把 **Memo 写入**（`publishMemo` / `updateMemo`）拆到 `features/memos/useMemoWrite.ts`，
行为一字未改（`useNoteCreation` / `useVaultScope` / `useItemPatchActions` 都是同一先例）。

## 五、风险

- **身份稳定化是"改语义"的手法**：ref 与 state 必须同步更新，漏一处会出现"读到上一个选中项"的错。对策：只在三处写 ref（open / notifyUploaded / reloadSelected），并补一条"连续切换两篇后 `refresh()` 用的是最新选中项"的用例。
- **`memo` 的失效条件必须复查**：任何传给行的对象/函数只要每次渲染新建，整表重渲染就回来了。A-2/A-3 就是为此，验收点 1/2 会在回归时立刻报出来。
- 纯前端渲染层改动，**不涉及 schema / API / 视觉取值**，不改 `DESIGN.md` 与 `wiki/`。

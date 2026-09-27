# Menote 笔记页「切换笔记卡顿」实施计划 v1

| 项 | 值 |
|---|---|
| 文档版本 | v1.1 |
| 文档状态 | **A 步已完成并验证**（v0.5.3）；B 步待开 |
| 目的和适用范围 | 修用户反馈的「笔记页切换笔记很卡、有延迟」。范围限**笔记区列表与正文区的渲染成本**与**选中态与正文加载的耦合**；不动数据模型、API、同步协议、视觉取值 |
| 权威级别 | 模块规则（本屏执行口径；结论并入 `wiki/` 或 `DESIGN.md` 后再升级） |
| 最后更新日期 | 2026-09-27 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
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

## 三、B 步：解耦选中与读正文（A 验证后开）

点下去先落选中态（列表高亮立刻动、正文区给骨架），正文到货再填；`open()` 不再把 `setSelectedId` 放在 `await` 之后。

**为什么必须单独一步**：它改的是交互时序，会碰三处被用例钉着的纪律——编辑器 `key`/重挂语义、`previewSource`（切模式不能显示回旧内容）、跨标签页"打开时基准 `initialBody`"（`test/note-workspace.test.tsx`、`test/notes-remote-change.test.tsx`、`test/note-editor.test.ts`）。单独提交、单独用例，出问题可单独回滚。

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

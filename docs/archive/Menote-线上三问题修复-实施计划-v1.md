# Menote 线上三问题修复 · 实施计划 v1

| 项 | 值 |
|---|---|
| 文档版本 | v1.1 |
| 文档状态 | 已完成（归档；三条全部落地并经真实 Chrome 复量） |
| 目的和适用范围 | 修复用户在已部署版本上反馈的三个问题：①新建条目不落到当前笔记本、层级看不出来；②新建笔记标题输入丢字；③Memo / 待办与原型页差异大且显示异常。本文只讲**怎么改、改哪里、怎么验**；屏幕形态的取值一律以 `DESIGN.md` 与用户原型 `deliverables/pages-redesign-2026-09-27/` 为准，不新增视觉规范 |
| 权威级别 | 历史参考（临时规则，任务已完成） |
| 最后更新日期 | 2026-09-28 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1.1 | v0.5.4 | 2026-09-28 | 收官：三条全部落地（代码提交 `ef78fac`），补 §四 复量结果与 §五 遗留 | deepseek-v4.1-flash |
| v1 | v0.5.4 | 2026-09-28 | 首版：三问题的定位证据（实测数字）、修法、落点、验收点 | deepseek-v4.1-flash |

## 〇、定位证据（本地 HEAD `faf0eeb`，真实 Chrome 实测）

| 问题 | 根因 | 实测 |
|---|---|---|
| 2 标题丢字 | 标题框受控于 `allItems` 里那份**已落库**的标题，而每次按键都 `await refresh()`（6 张表 + 全量正文摘要 + 搜索索引重扫），异步回来把输入框按回旧值 | 808 条笔记下按 60ms/字输入 10 字：**最终只剩 1 个字（丢 9 个）**，每次按键 DOM 都被回写，主线程长任务 **294ms** |
| 3a Memo 异常 | `MemoItem` 的 `.memo__body` 自带 `markdown-body`，`MarkdownPreview` 又渲染一层 → 阅读区样式（`max-width:740px; margin:0 auto; padding:20px 24px 80px`）**叠了两层**；另缺原型的主干线 `.tl::before` 与 740px 内容上限 | 单行 Memo 卡片 **275px**（原型 **97px**）；把该规则临时压掉复测 **252px → 52px**；`.tl::before` 计算值 `content: none`；时间轴 **1096px**（原型 740px） |
| 3b 待办异常 | `.tkhead{display:flex}` 把 `.tkhead__main` 压成内容宽（原型 `.tkhead` 不是 flex）；看板下 `.taskpanel__body` 只写 `width:80%` 缺 `flex:none`，在 `flex:1` 的 flex item 上不生效（原型正是 `flex:none;width:80%`） | `.tkhead__main` **604px**（原型 1146px）→「视图切换 / 添加待办」挤在页头中间；看板下滚动容器仍 **1146px**、看板 **1106px**（原型 877px） |
| 1 落点与层级 | `useNoteCreation.createNote` 只有**加密空间**分支传 `folder_id`，普通笔记本走 `createLocalNote`（`folder_id: null`）→ 一律落根目录 | 建「工作」并选中后点「新建笔记」：`工作 / 0 条` 不变；根「笔记本」出现 `未命名笔记`（1 条）。子夹嵌套只有 16px 缩进，无引导线、不可折叠、列表无路径 |

## 一、修法（按落地顺序）

### A. 问题 2：标题输入（最高频，先落）

1. `NoteWorkspace`：标题框改为**本地即时回显**——`useState` 持有 `title`，随 `item.id` 同步；`onChange` 只更新本地 state + 抬一个"待提交"标记。
2. 提交时机：空闲 `TITLE_COMMIT_IDLE_MS`（400ms）、失焦、以及**卸载/切换条目前**（`useEffect` cleanup 与 `onBlur` 都提交），保证不丢字。提交用最新值，提交后若 `item.title` 与提交值不同（别处改过）则以最新外部值为准。
3. `useNotesWorkspace.changeTitle` 改**轻提交**：写 `items` + `enqueueMetaPatch` + **就地更新 `allItems` 里那一行**（`setAllItems` 映射），**不再每次 `await refresh()`**；搜索索引与摘要由既有的同步回调/下一次 `refresh()` 收口。
4. 口径不变：仍然走 outbox 的 `patch_meta`（离线优先、幂等），不改 API 契约。

### B. 问题 3：Memo 与待办回到原型取值

1. `app.css`：`.markdown-body` 只留**排版**（`line-height` 等）；`max-width:740px; margin:0 auto; padding:var(--sp-5) var(--sp-6) 80px` 收进 **`.docpane__body .markdown-body`**（等于正文阅读区专属）。同批删掉已无人使用的 `.doc-body`（grep 确认全仓无引用）。
2. `MemoItem`：去掉 `.memo__body` 上重复的 `markdown-body` 类名（`.memo__body > .markdown-body > :first-child` 那两条规则随之改成 `.memo__body > :first-child`）。
3. `app.css`（写进**前部「原型对齐块」**，不得追加到文件尾）：新增 `.timeline::before`（1px `var(--line)`、`left:104px`、`top/bottom: var(--sp-2)`）；`.timeline` 加 `max-width:740px; margin:0 auto`（原型 `.page--memo{--cap:740px}` 的落点），`.memo-empty` 同样居中。
4. `app.css`：`.tkhead` 去掉 `display:flex`（保留 `position:relative; flex:none; border-bottom`）→ `.tkhead__main` 自然占满整行、右侧控件回到页头右端。
5. `app.css`：`.taskpanel--board .taskpanel__body` 补 `flex:none`（连同既有 `width:80%; margin:0 auto`），看板整体收窄居中生效。
6. `css-cascade.test.ts` 的取值断言必须全绿——所有取值只在前部那一处给。

### C. 问题 1：新建落到当前笔记本 + 层级可见（形态 A）

1. `useNoteCreation.createNote`：解析目标文件夹——`view.kind === "notebook"` 时取 `view.folderId ?? null`，否则 `null`；`inEncSpace` 由 `isInVault(folders, folderId)` 判定（加密空间分支与普通笔记本**合成一条路径**，行为不变）。这样首页/功能栏/列表空状态的「新建笔记」与录入框「笔记」档全部跟随当前笔记本。
2. `Composer` 的「笔记」档胶囊：文案由写死的「根目录」改为**当前笔记本名**（无笔记本上下文时为「根目录」）；`App` 把名字传进去。胶囊的 `title` 说明同步改写。
3. 层级可见（不改数据模型、不新增页面骨架）：
   - `FolderTree`：父项加**折叠三角**（`aria-expanded`，默认展开，折叠状态留在组件内）；`.tree__children` 加**引导线**（左边一条 1px 细线）；
   - 列表头：显示**路径**「笔记本 › 子夹」（根视图仍是「全部笔记」）——由 `useNotesWorkspace` 增加 `viewPath`（或等价派生值）供 `ItemListHead` 渲染，取值来自 `folders` 的父子关系；
   - 行内不加所属笔记本标签（那是方案 B，本轮不做）。

## 二、验收点

| # | 验收 | 方式 |
|---|---|---|
| 1 | 808 条笔记下连续输入标题 10 个字，**一个字不丢**，输入过程无长任务回写 | 真实 Chrome 同口径复量（与本次定位脚本相同） |
| 2 | 单行 Memo 卡片高度回到 ~97px 量级；`.timeline` 有主干线且内容宽 740px | 真实 Chrome 量 `.memo` / `.tl::before` / `.timeline` |
| 3 | `.tkhead__main` 占满页头宽（≈1146px）；看板下 `.taskpanel__body` 收到 80% 并居中 | 真实 Chrome 量几何 |
| 4 | 选中「工作 › 本周」后新建笔记，**列表里立刻出现**（不再落根目录） | 用例 + 真实 Chrome |
| 5 | 树可折叠、有引导线；列表头显示路径 | 用例（jsdom）+ 真实 Chrome |
| 6 | `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿；`css-cascade` / `style-coverage` / `design-rules` 等守卫不红 | 命令 |

## 三、有意不做

- 不改数据模型、不动 API 契约、不加用户设置项。
- 不做"全部笔记按笔记本分组"、不做行内笔记本标签、不把笔记本写进 URL（方案 B / C，本轮未选）。
- 不动 `.memopanel__filters` 的位置（差异清单已记：原型把它移进页内二级侧栏，属另一族问题）。

## 四、验收结果（2026-09-28，真实 Chrome + 同一套量法复量）

改动提交 `ef78fac`。左右两端都是**同一台机器、同一个本地库（808 条笔记）**下的实测。

| 验收点 | 改前 | 改后 | 原型 |
|---|---|---|---|
| 标题输入 10 字（60ms/字）丢字 | **丢 9 个**（最终只剩 1 个字；每次按键都被异步回灌按回旧值） | **丢 0 个**（无任何回灌；长任务出现在停止输入 353ms / 862ms 之后的提交路径上，不在输入路径上） | —— |
| 单行 Memo 卡片高 | 275px | **52px** | 97px（原型那条带 foot 行，我们这条没有） |
| 时间轴宽 | 1096px（无上限） | **740px** | 740px（`.page--memo{--cap:740px}`） |
| 主干线 `.tl::before` | `content: none`（没有） | **1px `rgb(224,224,224)` @ `left:104px`** | 1px `#e0e0e0` @104px |
| `.tkhead__main` 宽（页头主体） | 604px（右侧控件停在页头中间） | **1146px（占满）** | 1146px |
| 看板下滚动容器宽 | 1146px（`width:80%` 未生效） | **917px（居中）** | 917px |
| 看板宽 / 列宽 | 1106px / 358px | **877px / 282px** | 877px / 282px |
| 选中「工作」后新建笔记 | `工作 / 0 条` 不变，笔记落根目录 | **`工作 / 1 条`，列表里立刻出现**；子夹同理，列表头显示 `工作 › 本周` | —— |
| 笔记本树 | 只有 16px 缩进 | **折叠三角（`aria-expanded`）+ 子层引导线 + 缩进**，父项可收起 | —— |
| 录入框「笔记」档落点提示 | 写死「根目录」 | **当前笔记本名**（无上下文时「根目录」） | —— |

命令：`pnpm lint` / `pnpm typecheck` 全绿；全套 **1130**（shared 62 / mdcore 65 / web 795（+22）/ worker 208）。

## 五、遗留（本轮不做，另行评估）

- **提交路径上仍有约 180ms 的长任务**：标题提交（防抖后）会经"本地写入 → 同步推送 → `refreshAll()`"，
  而 `refresh()` 每次都要读 6 张表（含 `listItemSummaries()` 把**全部正文**读进内存）。它**不挡输入**
  （已在停止输入 ~350ms 之后），但库里条目多时是一次可见的停顿。可行的后续：摘要改为增量/懒取，
  或把 `refresh` 拆成"列表元数据"与"摘要"两档。属独立性能项，建议与 M5 的清单一起排。
- **改标题不进本地搜索索引**：`refreshSearchIndex()` 按 `sync_seq` 增量，而改标题不动 `sync_seq`
  ——所以改完标题后按新标题搜不到，直到这条被同步推高 `sync_seq`。此**改前就存在**（每次 `refresh()`
  同样会跳过），本次不扩大范围，登记待办。

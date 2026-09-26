# Menote M2 实施计划（组织与录入）

| 项 | 值 |
|---|---|
| 文档版本 | v1.2 |
| 文档状态 | **生效（执行中）**——前置已满足：DESIGN.md 视觉章与 §4.3 间距刻度已定稿（v1.2）、`wiki/components.md` 比对已完成、Q 项已拍板（见 §1.3）。`components.md` 的 5 处措辞收敛按用户意见**后置**到"页面比较完整后"再讨论，不作为开工阻塞 |
| 目的和适用范围 | M2「组织与录入」的可执行拆步：把 M1 成型的骨架填成日常可用的记录工具（笔记本/文件夹、Memo、待办、标签、搜索、首页、设置） |
| 权威级别 | 模块规则（执行依据）。与 `wiki/` 冲突时以 wiki 为准并停下确认 |
| 最后更新日期 | 2026-09-26 |

修改记录：

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型 |
|---|---|---|---|---|
| v1 | v0.1.2 | 2026-09-26 | 初稿：M2 十个步骤、涉及文件、验收点、待拍板 Q 项与收口口径 | deepseek-v4.1-flash |
| v1.1 | v0.2.2 | 2026-09-26 | 补 §1.2「M1 遗留清单」（M1 收口时判定可移入 M2 的 6 项，含真机两设备验证与桌面 PBKDF2 实测值、线上实例审计结论）；修正小节编号（此前 1.1→1.3→1.4→1.2 重复错序），并同步 M1 归档计划与 CHANGELOG 里的交叉引用 | deepseek-v4.1-flash |
| v1.2 | v0.2.3 | 2026-09-26 | **开工**：Q 项全部拍板（Q4 不做，其余按建议；隐私锁 M2 只做外观与占位、基本行为留 M3），§1.3 改为结论表并补隐私锁口径；状态由「评审中」改「生效（执行中）」 | deepseek-v4.1-flash |

**上游依据**：`docs/todo/Menote-开发计划-v1.md`（v1.2）§三 M2；`wiki/Menote-功能拆解-v2.md` M02/M03/M06/M07/M09/M18；`wiki/components.md`；`DESIGN.md`；`docs/modules/Menote-同步引擎设计-v1.md` §5（M2 边界）。

**范围边界**：M2 不含隐私锁行为（M08，只落 `PrivacyCapsule` / `VaultNode` 的外观与占位）、表格（M05）、附件与图片（M10）、版本历史（M11）、回收站界面（M12）、分享/导出/备份（M5）、MCP/数据管理/实例管理其余页/PWA 完整离线（M6）。**Memo 图片不在 M2**（依赖 M4 附件管线，见开发计划 §三 M2 第 6 条）。

---

## 一、M2 开工前必须定的事

### 1.1 文档

| # | 事项 | 原因 |
|---|---|---|
| 1 | **DESIGN.md §3 视觉语言定稿 + §4.3 间距刻度定稿**，并同批处理 §3.4 的四个连带问题（收敛字号、收敛圆角、改回归脚本色板断言、扫描 `linear-gradient` 内色值） | M2 是"界面框架填内容"的里程碑，令牌未定会在每个组件里产生返工 |
| 2 | `wiki/components.md` 复核（M2 用到的组件是否都已列名与定 props） | 组件名是实现契约 |

### 1.2 M1 遗留清单（M2 开工前或开工初期清掉，别丢）

M1 已收口（`docs/archive/Menote-M1-实施计划-v1.md`），但有几项当时判定"可移入 M2"或依赖真机，集中记在这里：

| # | 遗留项 | 来源 | 说明 |
|---|---|---|---|
| 1 | **真机两设备验证** | M1-11 验收 | 同机两个浏览器 profile 已验过（含断网补传）；还缺**手机 + 桌面**两台真机走"注册 → 建笔记 → 互见 → 断网编辑 → 联网补传"。顺带量一次手机上 PBKDF2 600k 的耗时（风险表 #2）——**桌面机代理值已测：中位数 95 ms、最慢 100 ms**（Node 22 WebCrypto，与浏览器同参），离 2 秒红线很远，预计手机端无需降到 310k。**线上实例已审计（2026-09-26）：8 项全过**——首页/图标/`_headers` 的 CSP 与安全头都生效、`has_users: true`（owner 已注册）、线上 JS 含 v0.1.16+ 的提示串，且**产物 hash 与本地 v0.2.2 构建完全一致**（`index-9ryxuogI.js`），说明 Workers Builds 一直跟着推送在重建 |
| 2 | 上传失败列表界面 | M1-12 | 队列项已有"失败列表"语义与状态栏提示（显示"上传失败"），缺**手动重试/查看原因**的界面 |
| 3 | 增量补丁 `PATCH /api/items/:id/body` | M1-12 | ≥64KB 且改动 <25% 且 ≤20 操作时走补丁（设计稿已定，M1 只走整篇 PUT） |
| 4 | `POST /api/batch`、`POST /api/items/:id/trash` + `/restore` | M1-12 | 批量与回收站接口；回收站界面属 M4，接口可先落 |
| 5 | BroadcastChannel 广播 | M1-12 | 多标签页"已在其他标签页修改"提示（M1 只做了选主） |
| 6 | `/api/health?deep=1` 返回 `schema_version` | M1-12（可选） | 便于线上确认自愈迁移到哪一版 |

### 1.3 Q 项（**已拍板**·用户确认 2026-09-26）

| Q | 事项 | 结论 |
|---|---|---|
| Q19 | Memo 如何编辑 | ✅ 按建议：时间轴中原位展开为输入框，`Ctrl+Enter` 保存、`Esc` 取消 |
| Q21 | 三个设置项归属 | ✅ 按建议："全部离线缓存"→通用；Memo 快照周期→备份；全量 ZIP 导出→数据管理 |
| Q23 | 去掉清单标记时是否删除 `task` 字段 | ✅ 按建议：删除 |
| Q26 | 快捷菜单放不放"新建" | ✅ 按建议：第一版不放 |
| Q9 | Memo 能否置顶 | ✅ 按建议：可以；置顶显示在时间轴最上方，待办视图不受影响 |
| Q17 | 标签能否重命名/合并/删除 | ✅ 按建议：第一版不做 |
| Q12 | 删除文件夹的三件套 | ✅ 按建议：确认框写清影响数量；连同内容进回收站并保留原路径；恢复时原文件夹不在则回根目录 |
| Q24 | 标题与正文第一行是否联动 | ✅ 按建议：按钮新建不预填一级标题；标题仍为「未命名笔记」且正文首行是一级标题时自动取用；用户手动改过后不再联动 |
| Q4 | "仅本次查看"档位下 Memo 死路 | ❌ **不做**（用户 2026-09-26 决定：不需要） |
| Q6 | 门禁锁定时刚写的 Memo 怎么显示 | ✅ 按建议：提示"已发布（隐私浏览中，解锁后可见）"，时间轴仍占位 |
| Q7 | 首页锁定时的 Memo 部分 | ✅ 按建议：「今日待办」「最近动态」中来自 Memo 的部分显示"已锁定"占位；统计卡片始终计入 |

**隐私锁的口径（用户 2026-09-26 补充）**：M2 **只做外观与占位**（`PrivacyCapsule`、`VaultNode`、锁定态 Memo 的占位显示），锁的实际行为（解锁、门禁、计时）**先实现基本功能、后续再拓展**——基本行为落在 M3（M08），M2 不引入可用的加密路径。因 Q4 不做，"仅本次查看"档位在 M2/M3 都不需要特殊处理。

---

## 二、步骤总览

| 步 | 主题 | 依赖 |
|---|---|---|
| M2-0 | 前置：DESIGN 定稿 + Q 项拍板 | M1 收口 |
| M2-1 | `packages/mdcore`：front matter、标签与任务字段派生 | M2-0 |
| M2-2 | 界面框架填充（功能栏四区 / 录入框三行 / 双栏视图集合） | M2-0 |
| M2-3 | 笔记本与文件夹（≤2 层、移动、重命名、删除） | M2-2 |
| M2-4 | Memo（时间轴 / 瀑布流 / 录入 / 编辑 / 置顶 / 转笔记） | M2-1、M2-2 |
| M2-5 | 待办（列表 / 看板 / 任务字段 / 状态流转） | M2-1、M2-2 |
| M2-6 | 搜索（`search.worker.ts` + MiniSearch + 分词） | M2-1 |
| M2-7 | 设置 10 分类 + 通用页 + 快捷菜单 | M2-2 |
| M2-8 | 首页（统计 / 快捷方式 / 快速导航） | M2-3~6 |
| M2-9 | 同步补全（`user_settings` 入载荷、batch、trash/restore、BroadcastChannel） | M2-3 |
| M2-10 | 走查与收口 | 全部 |

---

## 三、逐步拆解

### M2-1 `packages/mdcore`

> **状态：✅ 已完成（v0.2.4）**。落地：`frontmatter.ts`（有界 YAML 子集解析 + **行级安全改写**，未知键如表格 `columns`/`views` 原样保留）、`tags.ts`（YAML tags + 正文 `#标签` 合并去重，剔除代码块与 URL 锚点）、`tasks.ts`（字面量 `todo/doing/done`、`high/medium/low`，读取兼容中文，ISO 日期校验真实存在）、`markdown.ts`（首行一级标题取值、录入框首行作标题）；**零运行时依赖**（自己实现子集解析，不引 YAML 库）；35 个用例覆盖解析、改写保真、容错降级、标签语法边界。

**涉及文件**：`packages/mdcore/src/`（`frontmatter.ts`、`tags.ts`、`tasks.ts`、`markdown.ts`）、`packages/mdcore/test/`、`packages/mdcore/package.json`。

**验收点**
- 标签来源：YAML `tags` 字段 + 正文 `#标签`；派生结果与 `items.tags` 的 JSON 数组一致。
- 任务字段：`task: { status, due, priority }` 从 YAML 解析；状态/日期/优先级可为空。
- 派生逻辑**前后端同一份实现**（Worker 保存时写派生列，前端本地算显示）。
- 纯函数、零浏览器/Worker 专有 API（`packages/*` 不得依赖 `apps/*`，ESLint 已护栏）。

### M2-2 界面框架填充

> **状态：✅ 已完成（v0.2.5）**。落地：`app/ui/` 抽出 `SegmentedControl`（盒式）/ `NavItem` / `Chip`（三形态）；`app/fnbar/` 落 `Composer`（三行结构 + 笔记档发布）+ `NavSegmented`（浏览三段，下划线页签）+ `NavList`（最近编辑/收藏）+ `NotebookGroup` + `TagGroup`（标签云）+ `VaultNode`（贴底固定）；`app/workarea/` 落 `TwoPane` / `ItemListHead` / `EmptyDocPanel`；`features/notes/views.ts` 落视图筛选与标签统计。验收点逐条有用例：三行结构不变量（附加项恒 26px/nowrap/不塌陷）、两种导航造型可区分、加密空间是滚动容器的兄弟、功能栏内无账户区、note 档无加密胶囊、Ctrl+Enter 发布。
>
> **三处范围决定**（按"不做空入口"的既有口径）：① 浏览三段的首页 / Memo / 待办**禁用并说明原因**（M2-8 / M2-4 / M2-5），造型先就位以便对照"两条导航造型区分"这条验收；② 笔记本组只落组头（文件夹树 / `+` 菜单在 M2-3），`+` 按钮禁用说明原因；③ 加密空间按用户口径**只做外观与占位**，禁用并说明 M3 启用。`Ctrl/Cmd+K` 聚焦搜索留到 M2-6（搜索框目前仍是禁用占位，先接会比"无反应"更糟）。

**涉及文件**：`apps/web/src/app/fnbar/`（`Composer` 及三行子组件、`NavSegmented`、`NavList`、`NotebookGroup`、`TagGroup`、`VaultNode`）、`apps/web/src/app/workarea/`（`TwoPane`、`ItemListHead`、`EmptyDocPanel`）、`apps/web/src/app/ui/`（`SegmentedControl`、`UnderlineTabs`、`Chip`、`Pill`、`Capsule`、`Menu`、`Modal`、`Toast`、`Placeholder`、`InfoHint` 等）。

**验收点**
- **不变量**【实测】：快速录入框总高 136px、其下方导航区顶部 y = 252px 不变；切模式只换内容不换高度，附加项容器固定 26px 高 + nowrap、**不得**用 `display:none` 塌陷。
- 两条导航造型保持区分：浏览三段=下划线页签；录入框模式切换=盒式分段控件。
- 加密空间**贴底固定**、不随导航滚动、无分组小标题。
- 功能栏内不出现账户区。
- 录入框三行顺序：输入区（min 40 / max 180px，可纵向 resize）/ 模式附加项 / 模式行（左模式切换 + 右发布按钮，同一行）。
- 三档附加项：`memo` 空容器占位（不隐藏）、`task` 截止 + 优先级、`note` 首行作标题 + 根目录（**无加密胶囊**）。
- 快捷键：`Ctrl/Cmd+K` 聚焦顶栏搜索、`Ctrl/Cmd+Enter` 发布、`Esc` 依次关闭浮层；提示写在按钮 `title` 上不占独立行。
- 移动端兼容底线（禁止项 #16/#17）。

### M2-3 笔记本与文件夹

> **状态：✅ 完成（v0.2.7；删除项按下方修正移至 M4）**。
> 已落地：服务端创建/改名/移动与两层校验（M1 完成，`depthUnder` + MAX_FOLDER_DEPTH）；客户端文件夹本地写与入队（`createLocalFolder` / `renameLocalFolder` / `moveLocalFolder` / `enqueueFolderPatch`）、计数与行内摘要、`NotebookPanel`（组头 + `+` 菜单 + 内联命名）、`FolderTree`（两层、计数、待上传标记、节点「更多」菜单）、`NbAddButton`（表格项占位禁用）、条目行标记（置顶/收藏/摘要）与行内「更多」菜单（移动到…／置顶／收藏）、按文件夹筛选视图；共享控件 `Modal`/`Overlay` 落地（重命名与移动走弹窗）；文件夹规则抽成 `features/notes/folders.ts`（`folderDepthFor` / `canCreateChildFolder` / `folderMoveTargets`，非法移动目标带原因）。
>
> **计划修正（v0.2.6）**：验收点里的"删除（Q12）"整体**后移到 M4**——本计划的范围边界已把回收站界面划给 M4/M12，且 outbox 无删除类 op；没有回收站的删除对用户不可逆。Q12 的规则（确认框写清"文件夹及其中 N 条内容、M 个子文件夹将移入回收站"、保留原路径、恢复时父不在则回根目录）继续作为 **M4 的验收依据**。
>
> **条目菜单的其余项**分属 M3（加密）、M4（版本/删除）、M5（分享/导出）。

**涉及文件**：`apps/web/src/features/notes/`（`FolderTree`、`FolderNode`、`NbAddButton`、移动/重命名菜单）、`apps/worker/src/routes/folders.ts` + `services/folders.ts`（补全）、`apps/web/src/data/db/`（文件夹仓储）。

**验收点**
- 最多两层嵌套；**第二层文件夹不提供"新建子文件夹"入口**；"移动到…"里超过三层的目标置灰并说明原因，**服务端同样校验**。
- `+` 菜单 = 新建文件夹 / 新建表格（表格项 M2 只占位）。
- 重命名走 `meta_rev`，多设备并发改名以后写为准、**不生成冲突副本**。
- 删除（Q12）：确认框写清"文件夹及其中 N 条内容、M 个子文件夹将移入回收站"；保留原路径；恢复时原文件夹不在则回根目录。
- 条目列表行显示：标题、摘要、修改时间、同步状态、置顶/收藏标记（加密标识 M3 接）。
- **最近编辑 / 收藏 / 标签三个视图与笔记本同构**（列表 + 正文双栏，点条目在右列直接打开），三者**都不含 Memo**（Q8）。
- 侧滑详情**不由条目列表触发**（禁止项 #15）。

### M2-4 Memo

> **状态：✅ 完成（v0.2.10；三项按范围后移，见下）**。
> 已落地：录入框 Memo 档**乐观发布**（先落本地标"待上传"，outbox 后台上传，写入免密）；正文写了 `- [ ]` 时提示**「设为清单？」**（点了才带标记，删掉清单项标记自动作废）；`MemoPanel` / `MemoTimeline` / `MemoItem` 的**按天时间轴**（天边界按设置时区，默认 `Asia/Shanghai`）、渲染后的正文、标签、时间、清单小图标、置顶标记；顶部**标签筛选 + 日期范围筛选**与**「添加」按钮**；**原位编辑**（Q19：`Ctrl+Enter` 保存 / `Esc` 取消，`memo_at` 不变）；**不提供收藏**（Q8）；**Memo 转笔记**（Q10：`converted_to` 关联、标题取首行 ≤50 字、清单字段不带走、原 Memo 保留并显示链接、转换后直接打开新笔记）；浏览三段的 Memo 项由禁用转为可用。
>
> **后移项**：① **图片瀑布流**（`MemoWaterfall`）→ **M4**（依赖附件管线，没有图片时它是空壳）；② **`MemoLockedPlaceholder`** → **M3**（门禁行为在 M3，现在做就是死代码）；③ **软删 Memo** → **M4**（与文件夹删除同一处理，没有回收站的删除不可逆）；④ Q11 的 Memo 冲突副本规则（时间戳相同、带冲突标记）并入 M4 的同步冲突路径。

**涉及文件**：`apps/web/src/features/memos/`（`MemoPanel`、`MemoTimeline`、`MemoWaterfall`、`MemoItem`、`MemoLockedPlaceholder`）、`apps/web/src/app/fnbar/`（Memo 模式）、`packages/mdcore`（Memo 格式）。

**验收点**
- 时间轴按天分组倒序，按设置时区（默认 `Asia/Shanghai`）分组；显示渲染正文、标签、时间；清单 Memo 带待办小图标。
- 顶部标签筛选 + 日期范围筛选。
- 发布乐观：立即出现在时间轴并标"待上传"；发布后清空输入框；写入**永远免密**。
- `#标签` 支持；`- [ ]` 触发"设为清单？"提示（**带图片的 Memo 不提示** — M4 起才有图片）。
- Memo 可单独编辑（Q19 原位展开，`Ctrl+Enter` 保存、`Esc` 取消）与删除（软删）；`memo_at` 编辑不变。
- Memo 不提供"收藏"；置顶按 Q9。
- Memo 转笔记（Q10）：单向，原 Memo 保留并显示"已转为笔记"链接，新笔记落根目录并直接打开，清单字段从 YAML 去掉。
- Memo 视图不含"清单"tab；顶部有「添加」按钮。
- **图片相关（M06-02）不在 M2**：M2 不显示图片入口，不出现"最多 5 张"的校验（随 M4 引入）。

### M2-5 待办

**涉及文件**：`apps/web/src/features/tasks/`（`TaskPanel`、`TaskListView`、`TaskKanban`、`TaskFilterBar`、`TaskLockedPlaceholder`）、`packages/mdcore`（任务字段读写）。

**验收点**
- 独立导航项「待办」（Memo 之后），支持列表 / 看板切换。
- 看板点卡片改状态或拖到另一列 → **即修改该条 Memo 的 YAML 并自动保存**。
- 列表按状态、日期、优先级排序与筛选，**纯本地**。
- 新建清单 Memo 默认状态"待办"；待办模式发布后保持待办模式。
- 清单 Memo 仍出现在 Memo 时间轴（不动数据模型）。
- 去掉清单标记时删除 `task` 字段（Q23）；带图片时"设为清单"置灰（M4 起才有意义）。
- **定死 `task_status` / `task_priority` 的存储字面量**（语义见功能拆解 M07-03：待办 / 进行中 / 已完成；高 / 中 / 低），并补一条迁移给 `items` 加 CHECK（M1 建表时刻意未加，见《数据模型与迁移设计》§6）。
- 项目/子任务/提醒通知**不做**。

### M2-6 搜索

**涉及文件**：`apps/web/src/workers/search.worker.ts`、`apps/web/src/features/search/`（`SearchPanel`）、`apps/web/src/data/db/`（`searchIndex` 表）、`apps/web/src/app/topbar/SearchBox.tsx`（启用）。

**验收点**
- 入口在顶栏，`Ctrl/Cmd+K` 聚焦；结果在主操作区（列表列 `wide` 单栏）；**清空后回到进入前的视图**。
- 范围：标题、正文、标签；可按类型/文件夹/标签/时间过滤；结果高亮片段。
- 默认离线可用、不发网络请求（唯一的例外是下面那条兜底）；`Intl.Segmenter('zh',{granularity:'word'})` + 中文二元组兜底。
- 索引按 `sync_seq` 增量更新，序列化进 `searchIndex`。
- 索引未建完时回退服务端 `GET /api/search`（`instr()` 子串扫描，**不用 `LIKE '%…%'`**），结果顶部提示"正在建立本地索引，当前结果可能不完整"。
- 空搜索结果给出口；**M2 阶段隐私过滤位集中在一处**（`in_enc_space` / `enc_self` 均为 0，M3 只改一处）。

### M2-7 设置

**涉及文件**：`apps/web/src/features/settings/`（`SetNav`、`SetCard`、`SetRow`、`Toggle`、`RadioSet`、`Field`、按分类拆的卡片 `cardGeneral` / `cardAccount` / `cardQuickMenu` / `cardEditor` / …，由 `setPageBody(id)` 装配）、`apps/web/src/app/topbar/AccountQuickMenu.tsx`、`apps/worker/src/routes/settings.ts`（`user_settings` 读写）、`apps/web/src/data/db/`（`settings` 表）。

> 组件名以 `wiki/components.md` 为准（§379 的卡片命名、§5.6 的 `AccountEntry` + `AccountQuickMenu`）；components.md 规定"组件名是实现契约，改名先回报"，本文不另造名。

**验收点**
- 两栏分页：左列 184px 分类导航 + 右侧当前分类内容，**一次只渲染一个分类**；默认落「通用」；离开设置再回来仍停在原分类。
- 导航最终形态 10 个分类，顺序为：通用 / 账户与安全 / 编辑器 / 隐私锁 / 版本与回收站 / 备份 / 分享 / MCP / 数据管理 / 实例管理（**仅 owner 可见**，带 `owner` 标记）。
- **但只显示本里程碑已实现的分类**（避免点进去空页面）：M2 落地「通用」「账户与安全」「编辑器」「隐私锁（只读说明占位）」「版本与回收站（打开回收站入口占位，回收站本体 M4）」，其余（备份 / 分享 / MCP / 数据管理 / 实例管理）等各自里程碑再进导航。M1 已落地的「账户与安全」「实例管理」在 M2 补全内容。
- 页头显示「当前分类名 · 一行简述 · 分类总数」。
- 通用页：启动视图（首页/最近编辑/收藏，默认首页）、时区（默认 `Asia/Shanghai`）、主题三档（默认浅色，切换**不整页重渲染**）、快捷菜单配置（5 个候选，主题切换与立即锁定默认开）。
- **编辑器页**：默认编辑模式（双栏 / 仅编辑 / 仅预览 / 即时渲染 —— 即时渲染细则【后续定】，M2 只落前三档，第四档置灰并说明）（M04-03、M18-02）。
- 未选首页时功能栏不显示首页项，浏览三段由其余两项等分。
- 账户快捷菜单：账户头 → 可配置功能项 → 定底「设置」「退出登录」；菜单内主题切换**切完不收起菜单**；「立即锁定」带状态（M3 才真正生效）。
- Q21 的三个设置项归位。
- 设置项保存方式按需求建议：即时生效并同步。

### M2-8 首页

**涉及文件**：`apps/web/src/features/home/`（`HomePanel`、`StatCards`、`TodayTasks`、`RecentActivity`、`ShortcutGrid`、`QuickNav`）。

**验收点**：数据全部由本地元数据计算、**不发额外请求**；统计**始终计入**加密空间内条目与单篇加密条目（不因锁定/解锁改变）；来自 Memo 的部分在门禁锁定时以"已锁定"占位（Q7）；各卡片有空态。

### M2-9 同步补全

> 归属说明（与《同步引擎设计》§5 一致）：增量补丁、`POST /api/batch`、trash/restore、BroadcastChannel 这四项**同时列在 M1-12 与本节**，做在哪一步由当时排期决定；若 M1 已做完，本节只做验收复核，不重复实现。

**涉及文件**：`apps/worker/src/services/sync.ts`（增加 `user_settings` 实体）、`apps/worker/src/routes/items.ts`（`POST /api/batch`、trash/restore）、`apps/web/src/data/sync/`（BroadcastChannel）、`apps/web/src/features/notes/ui/`（上传失败列表）。

**验收点**
- `GET /api/sync` 增加 `user_settings`（含 `sync_seq`），客户端游标仍是单一序列。
- `POST /api/batch` 单批 ≤45 条语句，逐操作独立判定冲突并逐个返回结果。
- `POST /api/items/:id/trash` / `/restore`（含文件夹连同内容）；永久删除仍属 M4（墓碑表）。
- 多标签页：BroadcastChannel 广播"某条目已更新""游标已推进"；同条目并发编辑提示"已在其他标签页修改"，不静默覆盖。
- 冲突通知栏的「对比两者」/「保留某一份」（M13-04 的另一半；M1 只做了副本 + Toast）。

### M2-10 走查与收口

- 按功能拆解 v2 的验收口径逐条走查 M02 / M03 / M06（除图片）/ M07 / M09 / M18。
- `prototype/verify-prototype.js` 与 `verify-framework.js` 覆盖的交互路径在实现中均可走通（含 136px / y=252 不变量）。
- `pnpm lint` / `typecheck` / `test` / `build` / `check:size` 全绿。
- 线上可访问；CHANGELOG 记条目；**收口时 `version` → `0.3.0`**。

---

## 四、风险与对策

| # | 风险 | 对策 |
|---|---|---|
| 1 | DESIGN 令牌未定导致组件返工 | M2-0 卡死：§3/§4.3 未定稿不开工界面 |
| 2 | 隐私门禁的判定散落在各视图，M3 要改十几处 | M2 就把 `canShowIn` 集中到一个 `data/` 或 `app/` 模块，各视图只调它 |
| 3 | `Intl.Segmenter` 中文分词质量不达标 | M2-6 先用真实笔记样本评测；不足则加二元组权重、或在 M2 收尾评估外部分词方案（**引入依赖前先问**） |
| 4 | 首页统计与需求 §6.9"锁定时不显示条目数"的口径张力 | 按功能拆解新增④（首页本地统计始终计入；§6.9 的"不显示条目数"只指导航中的空间节点），并在 v7.5 一并修订需求 |
| 5 | 设置分类里塞进未实现内容 | 只显示已实现分类；未实现的分类等其里程碑再进导航 |

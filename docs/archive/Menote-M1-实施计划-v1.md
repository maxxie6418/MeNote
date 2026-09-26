# Menote M1 实施计划（核心闭环）

| 项 | 值 |
|---|---|
| 文档版本 | v1.1 |
| 文档状态 | **完成（已归档）**——M1 于 2026-09-26 收口（应用版本 v0.2.0）。未做项已集中记入 `docs/todo/Menote-M2-实施计划-v1.md` §1.2「M1 遗留清单」 |
| 目的和适用范围 | M1「核心闭环」的可执行拆步：注册登录 → 建笔记 → 编辑保存 → 第二台设备同步看到。每步给出涉及文件、验收点与验证命令 |
| 权威级别 | 模块规则（执行依据）。与 `wiki/` 冲突时以 wiki 为准并停下确认 |
| 最后更新日期 | 2026-09-26 |

修改记录：

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型 |
|---|---|---|---|---|
| v1 | v0.1.2 | 2026-09-26 | 初稿：M1 十三个步骤、涉及文件、验收点、验证命令与收口口径 | deepseek-v4.1-flash |
| v1.1 | v0.2.0 | 2026-09-26 | 标记完成并归档：M1 十二步全部执行（M1-12 的可选项按判定移入 M2，见 M2 计划 §1.2「M1 遗留清单」）；补记实测结论（dev 链路 17 项断言、浏览器全链路走查、断网补传、云端三项核对） | deepseek-v4.1-flash |

**上游依据**：`docs/todo/Menote-开发计划-v1.md`（v1.2）§三 M1；`docs/modules/Menote-数据模型与迁移设计-v1.md`；`docs/modules/Menote-同步引擎设计-v1.md`；`docs/modules/Menote-认证与会话设计-v1.md`。

**范围边界**：M1 不做表格、附件与图片、版本历史、回收站界面、隐私锁、分享、备份、搜索界面、Memo 与待办、首页。M1 的界面是**可用的最简闭环**，但骨架（顶栏 6 块 + 左右两栏 + 列表/正文双栏）按 DESIGN.md 一次成型，M2 只填内容。

---

## 一、步骤总览

| 步 | 主题 | 依赖 | 可并行 |
|---|---|---|---|
| M1-0 | 三份设计稿评审通过 | — | — |
| M1-1 | 迁移自愈执行器 + 第一条迁移（8 张表） | M1-0 | 与 M1-2 并行 |
| M1-2 | `packages/shared` 类型与 Valibot schema | M1-0 | 与 M1-1 并行 |
| M1-3 | 认证服务与路由（M01-01~05） | M1-1、M1-2 | — |
| M1-4 | 会话中间件 + CSRF + 响应头 | M1-3 | — |
| M1-5 | items / folders 服务与路由 | M1-4 | 与 M1-6 并行 |
| M1-6 | sync 路由最小版 | M1-4、M1-5 | — |
| M1-7 | 前端数据层（Dexie + 仓储） | M1-2 | 与 M1-3~6 并行 |
| M1-8 | 同步引擎（outbox / 推拉 / 选主 / 冲突副本） | M1-6、M1-7 | — |
| M1-9 | 编辑器（CodeMirror 6 + 自动保存） | M1-8 | — |
| M1-10 | 界面骨架 + 登录注册 + 列表 + 最小设置 | M1-3、M1-9 | — |
| M1-11 | 线上部署与两设备验证 | M1-10 | — |
| M1-12 | 收尾（补丁保存 / batch / trash-restore / BroadcastChannel） | M1-11 | 可移入 M2 |

---

## 二、逐步拆解

### M1-0 前置评审

- 评审 `docs/modules/` 三份设计稿；**用户点头后才动代码**。
- 评审通过后把设计结论回写 `wiki/`（需用户同意，清单见三份设计稿的末章）。
- **验收点**：三份稿状态由"评审中"改为"生效"；`wiki/` 同步项获得批准。

### M1-1 迁移自愈执行器 + 第一条迁移

**涉及文件**
- `apps/worker/src/db/migrations/0001_init.ts`（**18 条语句**：8 张 `CREATE TABLE` + 10 条 `CREATE INDEX`，内容照抄《数据模型与迁移设计》§3.2）
- `apps/worker/src/db/selfheal.ts`（执行器：版本检查 → 抢锁 → 执行 → 校验 → 写版本）
- `apps/worker/src/db/index.ts`（导出 `ensureSchema`）
- `apps/worker/src/index.ts`（在最外层调用一次 `ensureSchema`，入口仍 ≤100 行）
- `apps/worker/test/schema.test.ts`
- `apps/worker/src/db/migrations/.gitkeep`（说明改为"可选手工通道"）

**验收点**
- 空库首个请求后，8 张表与全部索引齐备（`sqlite_master` 断言）。
- `ensureSchema` 连打两次幂等；并发两请求只执行一轮；中途失败返回 503 且 `schema_version` 不前移。
- `items` 的 CHECK 生效（空标题笔记被拒、无标题 Memo 通过、Memo 带 `folder_id` 被拒、`size_bytes` 超限被拒）。
- 入口文件仍 ≤100 行（ESLint `max-lines` 通过）。
- **注**：DDL 与约束行为已在 SQLite（`node:sqlite`）上预演通过（《数据模型与迁移设计》§3.2 末注），这里要的是在真实 workerd + D1 上复验一遍。

**验证**：`pnpm test`、`pnpm lint`。

### M1-2 共享类型与 schema

**涉及文件**
- `packages/shared/src/`：`SyncResponse`、`ItemMeta`、`FolderMeta`、`X-Menote-Meta` 的 Valibot schema、认证请求/响应类型、上限/阈值常量（沿用架构 §2.3"常量（上限、阈值）"的既有口径，**不新增 `API_VERSION` 这类 wiki 里没有的命名**）
- `packages/shared/package.json`（新增 `valibot` 依赖 —— **引入生产依赖，开工前需用户点头**）
- `packages/shared/test/`（schema 往返与非法输入用例）
- `apps/web/package.json` / `apps/worker/package.json` 不需改（workspace 依赖已在）

**验收点**：两端 `import` 同一份类型；非法 `X-Menote-Meta` 被 schema 拒绝；`pnpm typecheck` 通过。

### M1-3 认证服务与路由（M01-01~05）

**涉及文件**
- `apps/worker/src/routes/auth.ts`、`apps/worker/src/services/auth.ts`、`apps/worker/src/services/sessions.ts`、`apps/worker/src/services/tokens.ts`
- `apps/worker/src/routes/settings.ts`（`/api/admin/registration`，仅 owner）
- `apps/worker/test/auth.test.ts`、`apps/worker/test/isolation.test.ts`
- `.dev.vars.example`（`AUTH_PEPPER`）——**先改根 `.gitignore` 才能提交**（现状 `.dev.vars*` 把它一并屏蔽，见《认证与会话设计》§6）
- `wrangler.jsonc`（加 `secrets.required`）

**验收点**（照《认证与会话设计》§3）
- prelogin 对存在/不存在的用户名返回**同形状**响应；连续两次相同不存在用户名返回同一假盐。
- **注册重复用户名要捕获唯一约束异常并映射为 422 `invalid`**（实测 `UNIQUE COLLATE NOCASE` 抛异常而非"0 行"）。
- 改密请求体为 `{ loginKey, newLoginKey, newKdf? }`，新盐由服务端生成、verifier 由服务端算（浏览器拿不到 `AUTH_PEPPER`）。
- 首位注册者 `role='owner'`；并发两个首次注册只有一个成为 owner；注册开关关闭时非首位注册返回 403。
- 登录错误统一 401 文案；第 5 次失败起 429 且带剩余秒数。
- 改密后当前设备会话仍有效、其他设备会话失效。
- 两用户隔离：A 的 token 读 B 的资源返回 404。

**验证**：`pnpm test`。

### M1-4 会话中间件 + CSRF + 响应头

**涉及文件**
- `apps/worker/src/middleware/session.ts`（新建目录；架构目录树缺失，需同步补 `wiki/`）
- `apps/worker/src/middleware/csrf.ts`、`apps/worker/src/middleware/security-headers.ts`
- `apps/worker/src/index.ts`（挂中间件）
- `apps/worker/test/csrf.test.ts`

**验收点**
- 无 Cookie / 过期会话 → 401 `unauthenticated`，过期行被删除。
- 非 GET 缺 `X-Menote: 1` 或 Origin 不匹配 → 403 `csrf`。
- `/api/health` 不受 CSRF 约束。
- **dev 实测**：Vite 插件下 Origin 与 `URL.origin` 一致；`Secure` Cookie 在 `http://localhost` 被接受（Chrome / Firefox 各验一次）。不一致时只加 dev 分支，不改生产逻辑。
- 会话 `last_seen_at` / `expires_at` 24 小时内只写一次（可用请求计数断言）。

### M1-5 items / folders 服务与路由

**涉及文件**
- `apps/worker/src/routes/items.ts`、`apps/worker/src/routes/folders.ts`
- `apps/worker/src/services/items.ts`、`apps/worker/src/services/folders.ts`
- `apps/worker/src/db/tables.ts`（SQL 常量）
- `apps/worker/test/items.test.ts`

**验收点**（协议见《同步引擎设计》§3）
- `PUT /api/items/:id`：客户端生成 ULID；重复提交幂等（1 行、`rev` 不增、第二次 200）。
- `GET /api/items/:id/body`：`ETag=content_hash`，`If-None-Match` 命中 304。
- `PUT /api/items/:id/body`：**先做预检读**（`rev != base_rev` 且哈希相同 → 直接 200 不写库；哈希不同 → 直接 409 不写库），再走 3 语句 batch；判定读 `results[0].meta.changes`；正文用带 `rev + content_hash` 双守卫的 `INSERT ... ON CONFLICT(item_id) DO UPDATE`（**不能用裸 `INSERT` 或裸 `UPDATE`**）；**并发同 `base_rev` 的覆盖竞态用例必测**——失败者不得覆盖胜者已提交的正文（见《同步引擎设计》§3.4、§6 用例 11/13/14）。
- `PATCH /api/items/:id/meta` 独立判定 `meta_rev`。
- 新建文件夹 + 条目归属；`folder_id` 非法（不存在 / 属于他人）→ 422。

### M1-6 sync 路由最小版

**涉及文件**
- `apps/worker/src/routes/sync.ts`、`apps/worker/src/services/sync.ts`
- `apps/worker/test/sync.test.ts`

**验收点**（《同步引擎设计》§3.2、§3.3、§6）
- `GET /api/sync?cursor=N` 只回元数据；items/folders 各 ≤200 行；`next_cursor` / `has_more` 正确。
- **同一 `sync_seq` 组不被切开**；且 `next_cursor = min(items 末端, folders 末端)`（两类独立查询的截断点不同，取大值会永久漏拉）。
- 游标不漏拉：写入 N 条后分页拉取，客户端集合与服务端逐一相等。
- `sync_seq`：主写入用子查询取"将要写入的值"，计数器由条件语句推进；**不用 `RETURNING`、不拆成两次请求**。
- 软删行随增量下发（含 `deleted_at`）。
- 多用户隔离。

### M1-7 前端数据层

**涉及文件**
- `apps/web/src/data/db/`（Dexie schema、仓储函数：`items` / `bodies` / `drafts` / `folders` / `outbox` / `syncState`）
- `apps/web/src/data/api/`（fetch 封装：`X-Menote: 1`、15s 超时、错误码 → 领域错误映射）
- `apps/web/test/`（Vitest + `fake-indexeddb`）
- `apps/web/package.json`（`dexie`、`fake-indexeddb`）

**验收点**：仓储 CRUD 与 `liveQuery` 订阅可用；outbox 合并规则（最新正文 + 最早 `baseRev`）有单测；Dexie 版本升级可清库重建。

### M1-8 同步引擎

**涉及文件**
- `apps/web/src/data/sync/engine.ts`、`push.ts`、`pull.ts`、`conflict.ts`、`leader.ts`（Web Locks）
- `apps/web/test/sync-*.test.ts`

**验收点**（《同步引擎设计》§4、§6）
- 离线编辑 → 入 outbox；`online` 后自动补传。
- 409 + `content_hash` 相同 → 视为成功、outbox 清空（响应丢失场景）。
- 409 + 内容不同 → 生成冲突副本条目（新 ULID、标题含"冲突副本"），原条目保留服务端版本。
- 退避序列 1/2/4/8…≤60s（fake timers 断言）；超时 15s。
- 两标签页只有一个在推拉（Web Locks）。
- `full_resync: true` 分支：清空本地重建，未上传改动先导出。

### M1-9 编辑器

**涉及文件**
- `apps/web/src/app/editor/Editor.tsx`（CodeMirror 6 封装）、`markdown.ts`（markdown-it + DOMPurify）
- `apps/web/src/features/notes/model.ts`、`ui/`（`DocHead` / `DocModeSwitch` / `DocStatusBar`）
- 动态 `import()` 编辑器分包（首屏 ≤200 KB gzip，`pnpm check:size` 会卡）

**验收点**：**三种编辑模式可用**（双栏实时预览为默认、仅编辑 / 仅预览；即时渲染模式的细则【后续定】，M1 不做）；停止输入 2s 保存、持续输入 30s 一次、>256KB 放宽 5s/60s；本地草稿恒 2s 落盘；状态栏显示大小与三态（已同步/待上传/上传失败）；达 1,900,000 字节阻止保存并提示；预览不改写 DOM（DOMPurify）；GFM 可用。

> M04-03 的"默认编辑模式"设置项落在 M2-7 的「编辑器」分类（M1 设置壳不含该分类）；模式在编辑器顶部可临时切换。

### M1-10 界面骨架 + 登录注册 + 列表 + 最小设置

**涉及文件**
- `apps/web/src/app/`：`AppShell`、`app/topbar/`（6 块：`BrandLogo` / `Breadcrumb` / `SearchBox`（M1 只做占位不可用）/ `SyncPill` / `PrivacyCapsule`（M1 不显示）/ `AccountEntry`）、`app/fnbar/`（`NewNoteButton` + 最简导航）
- `apps/web/src/features/auth/`（`LoginPage` / `RegisterPage` / `AuthGate`）
- `apps/web/src/features/notes/ui/`（`ListPane` / `ItemRow` / `DocPane`）
- `apps/web/src/features/settings/`（左列 184px 分类导航 + 「通用」+「账户与安全」+「实例管理」；默认落**通用**，只放主题三档）
- `apps/web/src/main.tsx`（路由表 + Provider，≤100 行）
- `apps/web/src/app/theme.css`（令牌层；颜色/字号/圆角/间距**从原型取值并标注"临时值，待 DESIGN §3 定型后替换"**）

**验收点**
- 顶栏恒为 6 块且顺序不可变；`body` 不滚动，每层一个滚动容器（DESIGN.md §2.7）。
- 空状态给出"为什么空 + 下一步做什么"；`InfoHint` 不承载警告/错误/计数（禁止项 #8）。
- 所有可点元素键盘可达 + `focus-visible`；图标按钮带 `aria-label`（DESIGN.md §6.2）。
- 未登录访问任意路由 → 登录页；注册开关关闭时登录页不显示注册入口。
- 新建笔记 → 落根目录、标题「未命名笔记」、正文不预填（Q24 建议案）。
- 移动端兼容底线：弹性布局、非仅悬停可操作、`viewport` 允许缩放（禁止项 #16/#17）。

### M1-11 部署与两设备验证

- `pnpm build && npx wrangler deploy`（首次部署自动供给 D1；首个请求触发自愈建表）。
- **不要提交** wrangler 回写的 `database_id`。
- 真机验证：桌面浏览器 + 手机（或两个浏览器 profile）注册登录 → 建笔记 → 两台互见 → 断网编辑 → 联网补传。
- **验收点**：线上 `/api/health` 正常；两设备数据一致；断网恢复后无丢失；无 `console.error` 未处理异常。

### M1-12 收尾（可移入 M2）

- `PATCH /api/items/:id/body` 增量补丁（≥64KB 且改动 <25% 且 ≤20 操作）。
- `POST /api/batch`；`POST /api/items/:id/trash` + `/restore`。
- BroadcastChannel 广播与"已在其他标签页修改"提示。
- 上传失败列表界面。
- `/api/health?deep=1` 返回 `schema_version`（可选）。

---

## 三、M1 收口口径

| 项 | 要求 |
|---|---|
| 功能 | 拆解 M01-01~05、M04-01/04/05（+ M04-03 的三种基础模式）、M13-01/02/03/**04（M1 只走"服务端版本保留 + 本地内容另存冲突副本 + 提示"分支；"对比两者 / 保留某一份"的完整界面属 M2）** 的验收口径逐条走通 |
| 质量 | `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿；`pnpm check:size` 通过 |
| 线上 | 生产可访问，两设备真实一致 |
| 文档 | 三份设计稿状态改为"生效"；`wiki/` 同步项执行完毕；`CHANGELOG.md` 记条目 |
| 版本 | 开发期改动只动修订号（0.1.3、0.1.4…），**收口时一次性 `version` → `0.2.0`** |

---

## 四、风险与对策

| # | 风险 | 对策 |
|---|---|---|
| 1 | 同步条件 batch 写脏（冲突时正文仍被覆盖） | M1-5 的集成测试必须先写、先红后绿；冲突用例断言 `item_bodies` 未变 |
| 2 | WebCrypto PBKDF2 600k 在低端机超时 | M1-3 用真机实测一次；超 2s 则降到 310k 并写回设计稿 §2.1 |
| 3 | dev 下 `Secure` Cookie / Origin 校验把本地所有写操作拦死 | M1-4 第一天单独验这两条，失败再加 dev 分支 |
| 4 | 首屏体积因 CodeMirror 超 200 KB | 编辑器与 markdown 渲染动态 `import()` 分包；`check:size` 只统计 `index.html` 直接引用的脚本 |
| 5 | 骨架在 M1 做成"临时壳"，M2 推倒重搭 | M1 就用 `AppShell`/`Topbar`/`ListPane`/`DocPane` 原语（DESIGN.md 禁止项 #5） |
| 6 | 设计稿评审拖期导致 M1 空转 | M1-1（迁移+DDL）与 M1-2（类型）不依赖同步细节，可先并行 |

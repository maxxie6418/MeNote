# CHANGELOG

> 每次改动在最上方追加；日期用小标题，同一天条目不重复写日期。版本号规范见 AGENTS.md「版本号规范」：主版本号仅用户主动提出变更；次版本号随里程碑收口 +0.1；修复/优化/小功能 +0.0.1（同一问题分批调整可合并后一次 +0.0.1）；纯文档改动沿用当前版本号。

## 2026-09-26

- v0.1.6 / 7e3cce0 — M1-5 条目与文件夹：条目四个端点（`PUT /api/items/:id` 新建幂等、`GET /api/items/:id/body` 带 ETag/304、`PUT /api/items/:id/body` 带 `If-Match` + `X-Menote-Hash`、`PATCH /api/items/:id/meta`）与文件夹两个端点（创建、改名/移动，层级上限 2 层）；写路径统一「预检读 → 一个 batch（主写入以 rev 为条件 + 正文带 rev/content_hash 双守卫的 upsert + 计数器条件推进）」，冲突整批无改动；SQL 常量与白名单列组装集中到 `db/tables.ts`；`shared` 补 `folders` 与 `text`（`utf8ByteLength`/`countCodePoints`，与 SQLite 的码点口径对齐）；补 M1-4 的安全响应头；**新增 16 个集成测试**（并发同基版本保存只有一个成功且落败者不覆盖正文、条件 batch 过期时正文与计数器都不动、响应丢失重放视为成功、Memo 形状约束、413 硬上限、文件夹层级与自环、多用户隔离）；设计稿《同步引擎设计》新增 §3.5 记录实现口径（文件夹接口、应答形状、服务端不重算哈希的取舍）
- v0.1.5 / d1ea369 — M1-3 认证与会话：服务层 `tokens`（令牌生成、SHA-256、HMAC、**常量时间比较**、prelogin 假盐派生）、`sessions`（建/解/销、滑动续期且每天最多写一次）、`auth`（prelogin、注册单语句判定首位 owner、登录节流、改密并使其他设备会话失效）、`settings`（注册开关走 `app_meta` 键）；中间件 `session`（`requireSession` + Cookie 读写，Secure 仅在 https 下开）与 `csrf`（`X-Menote` 主防线 + Origin 次防线）；路由 `auth`（prelogin/login/register/logout/me/password）与 `settings`（`/api/admin/registration` 仅 owner）；SQL 常量集中到 `db/tables.ts`，新增 `DomainError` 由入口统一转架构 §4.3 错误体；`shared` 补 `AuthSessionResponse` 与 **ULID 生成器**（主键时间有序）；`wrangler.jsonc` 声明 `secrets.required = ["AUTH_PEPPER"]` 并在 vitest 注入测试 pepper；新增 15 个认证集成测试（首位注册即 owner、注册开关与非 owner 拒绝、假盐确定性与大小写、节流冷却、改密失效其他会话、CSRF 两路、伪造令牌不 500、测试环境 pepper 绑定）
- v0.1.4 / 283e66e — M1-2：`packages/shared` 落协议契约——新增 base64url（无填充、两端共用、非法字符不静默丢弃）、`limits.ts`（上限与阈值常量，逐条注明来源）、`items.ts`（ItemMeta / FolderMeta / ItemWriteMeta 与 `X-Menote-Meta` 编解码）、`sync.ts`（SyncResponse / 保存应答 / 冲突 detail）、`auth.ts`（KDF 参数、用户名规则、认证请求响应）；类型一律由 Valibot schema 经 `InferOutput` 推导（schema 为唯一真相）；引入 `valibot@1.5.0`（首屏体积未受影响，仍 66.8 KB ≤ 200 KB）；`globals.d.ts` 只声明用到的 TextEncoder/TextDecoder，避免为类型引入 DOM lib 而放开浏览器专有 API；shared 单测 21 个（+17）
- v0.1.3 / a29dfb4 — M1-1 落地：运行时自愈迁移（`apps/worker/src/db/selfheal.ts`：读版本 → 抢锁 → 按序执行 → 校验对象 → 写版本，isolate 级缓存）+ 0001 首批 8 张表 / 10 个索引（新隐私模型权威 DDL，无密文列）+ `middleware/schema.ts` 表结构守卫（`/api/health` 作存活探针不依赖 D1，其余 `/api/*` 未就绪返回 503 retry_later）；新增 9 个 D1 集成测试（DDL 齐备、幂等、并发抢锁、中途失败整批回滚且版本不前移、结构漂移边界、守卫放行/拦截）；`.gitignore` 放行 `.dev.vars.example` 并新增该示例文件；AGENTS.md 补「关键阶段即时提交并推送」约定、项目简介更新为 M1 现状
- v0.1.2 / 553e1f2 — M1 评审结论回写 wiki：架构升 v1.9（§15.4/§15.5 迁移机制统一为运行时自愈、§5.1 建表指向新隐私模型权威 DDL、清理 §6.1/§6.3 的 v1.0 遗留、§15.5 机密清单删 `SESSION_SECRET`、§2.3.2 补 `/api/health` 与 `services/auth.ts` 落点并在目录树补 `middleware/`、表头版本由 v1.1 更正为 v1.9）；`wiki/guides/local-dev.md` §8 重写为「AUTH_PEPPER + 运行时自愈迁移」；功能拆解升 v2.4（Q22 定为登出不清除本机缓存、实例级设置用 `app_meta` 键）；三份 M1 专项设计稿状态改「生效」
- v0.1.2 / 553e1f2 — M1 开工前评审：新增三份专项设计（`docs/modules/` 数据模型与迁移设计、同步引擎设计、认证与会话设计），解掉四个阻塞项（迁移机制二义性与首次部署陷阱→改为运行时自愈迁移；新隐私模型缺权威 DDL→给出重写 CHECK 的权威版；同步引擎专项设计缺失；KDF/密钥/环境/设置入口口径未定）；新增 M1、M2 两份实施计划（`docs/todo/`）；开发计划升 v1.2（M04-02→M04-04/M04-05 勘误、M1 表清单补齐、M1 自带最小设置入口、界面骨架一次成型、DESIGN 视觉章时点、墓碑归 M4、Memo 图片跨里程碑边界）。定稿前用 SQLite 实测校正 DDL 与条件写模式（18 条语句、CHECK 正反例、upsert 守卫、游标取 min），据独立复核修正 20 余处，并记下三项需用户点头的发现：需求 §18.3 计数器守卫重放缺陷、`.gitignore` 屏蔽 `.dev.vars.example`、`site_settings`/登出清缓存两处定稿冲突
- v0.1.2 / 40e5113 — 评审反馈批次修复（合并记一次 +0.0.1）：run_worker_first 补 "/api"（无尾斜杠会落 SPA 回退返回 HTML）；wrangler.jsonc 显式 migrations_dir（插件默认改写到不存在的 <根>/migrations）并建 apps/worker/src/db/migrations/；ESLint 补依赖方向护栏（routes/services/db 分层 + packages 禁依赖 apps）；删除误用的 web deploy 脚本；CHANGELOG 归属勘误
- v0.1.1 / aede7bf — AGENTS.md 与 DESIGN.md 增补「移动端兼容」约定：移动端后续会做，窄屏布局定稿前不得留下仅桌面成立的写法（弹性 / 流式布局、不以悬停为唯一入口、触屏命中区、允许视口缩放、滚动仍每层一个容器）；DESIGN.md 升 v1.1 并增禁止项第 17 条
- v0.1.1 / 4f05411 — 修复 Workers Builds 部署失败（assets 缺 directory）：build 末尾在仓库根生成 .wrangler/deploy/config.json 指针，默认 `npx wrangler deploy` 即采用 Vite 产物配置；guide §6 部署说明同步更新
- v0.1.0 / 5fce691 — 版本号规范落进 AGENTS.md（主版本号仅用户主动变更；次版本号随里程碑 +0.1；修订号 +0.0.1，分批可合并）；根 package.json 同步为 0.1.0
- v0.1.0 / 7a8d42b — 重写 README：特性与技术栈（含已接入/规划状态）、快速开始、目录结构、常用命令、部署（Deploy 按钮 + Workers Builds）、文档导航与冲突优先级
- v0.1.0 / 0d26862 — 首篇操作指南 wiki/guides/local-dev.md（本地开发上手 + 部署链路）；README「怎么跑」更新
- v0.1.0 / 5b371c6 — M0 工程骨架：pnpm workspace（apps/web + apps/worker + packages/shared）、Worker /api/health、Vite 8 + React 19 前端、wrangler 部署链路（D1 自动供给 + SPA 静态资源 + CSP 头）、CI（lint / typecheck / 测试 / 构建 / 体积检查）
- 预开发 — 新增 docs/todo/Menote-开发计划-v1.md（前置准备评估 + M0-M6 里程碑规划，草案待确认）
- 预开发 / 1cc0ec5 — 文档规划指南 v1.1：补 API 与接口文档规划
- 预开发 / 9268ac1 — DESIGN.md 首稿：结构 / 交互 / 用法已定（布局尺寸、间距原则、组件用法与层级、交互与状态、无障碍底线、16 条禁止项），视觉语言整章待定；components.md 同步令牌引用
- 预开发 / f3f3585 — components.md 补 SegmentedControl 的用法交叉引用（ComposerModeTabs / DocModeSwitch 等同族，非独立控件）
- 预开发 / 0bc6d80 — 新增 wiki/components.md 组件规划（组件清单 + 落点 / 职责 / props / 复用 / 原型对应，附功能点映射矩阵与预留组件）
- 预开发 / aba789e — 新增 wiki/guides/docs-roadmap.md 文档规划指南（通用模板 + 本项目落地对照）
- 预开发 / 5f2f7e4 — deliverables/ 评审产物不入库，加入 .gitignore（修正误加）
- 预开发 / ca3674e — 按文档约定迁移主线文档至 wiki/ 并归档功能拆解 v1，新增 README（架构 v1.8）
- 预开发 / 2c61a80 — CHANGELOG 改为日期小标题格式（AGENTS.md 规则同步）
- 预开发 / b38fb20 — 草稿改为 docs/scratch/ 文件夹（一份讨论一份文件），架构升 v1.7 与 AGENTS.md 同步
- 预开发 / f68de6e — CHANGELOG 补记 scratch 目录化
- 预开发 / b24a31a — AGENTS.md 文档放哪补充 todo/ 与 scratch.md，创建对应目录与草稿文件
- 预开发 / cdeb147 — 架构 v1.6：docs/ 新增 todo/ 专项计划目录与 scratch.md 草稿区
- 预开发 / 9ad1462 — AGENTS.md 填充项目信息并修正模板残留（server.mjs 改为 Worker 入口规则），CHANGELOG 建立
- 预开发 / 45b5eb4 — 架构 v1.5：文档体系对齐 AGENTS.md（wiki/ 定稿区 + docs/ 过程区两层模型）
- 预开发 / c2908e9 — 架构 v1.4：docs/ 文档体系定稿（组件规划、方案草稿、ADR、归档目录与生命周期规则）
- 预开发 / 4cb26fb — 架构 v1.3：代码组织定稿（入口只装配规则、功能→代码落点对照表、防膨胀护栏）
- 预开发 / c4f6b47 — 架构 v1.2：一键部署到 Cloudflare（资源部署时自动创建绑定），发布主路径改为 Workers Builds
- 预开发 / 8cf0fe4 — 架构 v1.1 残留清理：目录树、Dexie 注记、R2 e/ 前缀、永久删除与分包列表与新隐私模型对齐

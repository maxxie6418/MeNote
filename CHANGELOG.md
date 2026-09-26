# CHANGELOG

> 每次改动在最上方追加；日期用小标题，同一天条目不重复写日期。版本号规范见 AGENTS.md「版本号规范」：主版本号仅用户主动提出变更；次版本号随里程碑收口 +0.1；修复/优化/小功能 +0.0.1（同一问题分批调整可合并后一次 +0.0.1）；纯文档改动沿用当前版本号。

## 2026-09-26

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

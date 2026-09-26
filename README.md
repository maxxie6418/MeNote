# Menote

面向个人与家人的轻量多端笔记应用（浏览器 PWA + Cloudflare 自托管）：Markdown 笔记、表格、Memo、待办、版本历史与隐私锁。

> 当前：M0 工程骨架已就位（pnpm workspace + Cloudflare Worker + Vite/React），业务功能自 M1（核心闭环：注册登录 → 建笔记 → 编辑保存 → 多端同步）开始。

## 文档

| 位置 | 内容 |
|---|---|
| `wiki/` | 定稿（写入与修改须经用户确认）：需求文档（设计文档 v7.4）、功能拆解 v2、项目架构 v1、ADR、操作指南 |
| `docs/todo/` | 专项计划：一个功能/任务一份实施计划（当前：Menote-开发计划-v1.md，M0–M6 里程碑） |
| `docs/modules/` | 专项功能设计文档 |
| `docs/scratch/` | 草稿：临时讨论，一份讨论一份文件 |
| `docs/archive/` | 归档：过期、被取代的文档，默认不读 |
| `prototype/` | 高保真交互原型（`menote-prototype.html`）与线框评审页（`menote-framework.html`） |
| `AGENTS.md` | AI 编程代理工作规则 |
| `DESIGN.md` | 界面与交互唯一视觉源 |

冲突时：功能与规则看 `wiki/`，长什么样看 `DESIGN.md` 与原型，某一屏的结构看 `docs/modules/`。

## 怎么跑

前置：Node.js ≥ 22、pnpm 11（`corepack enable` 或 `npm i -g pnpm`）。

```bash
pnpm install   # 安装依赖
pnpm dev       # 一条命令起前端 + Worker + 本地 D1（http://localhost:5173）
```

开发服务器由 Cloudflare Vite 插件驱动：前端跑 Vite，Worker 代码跑在本地 workerd 里，D1 绑定本地自动创建，无需 Cloudflare 账号。详细说明（目录结构、测试、部署链路）见 `wiki/guides/local-dev.md`。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 本地开发（前端 + Worker + 本地 D1） |
| `pnpm lint` | ESLint（含入口行数预算检查） |
| `pnpm typecheck` | TypeScript 全仓类型检查 |
| `pnpm test` | 单元测试 + Worker 集成测试 |
| `pnpm build` | 构建前端与 Worker 产物 |
| `pnpm check:size` | 首屏 JS 体积预算检查（≤ 200 KB gzip） |
| `pnpm deploy` | 构建并部署到 Cloudflare（需 `wrangler login`） |

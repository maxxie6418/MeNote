# Menote

[![CI](https://github.com/maxxie6418/MeNote/actions/workflows/ci.yml/badge.svg)](https://github.com/maxxie6418/MeNote/actions/workflows/ci.yml)

面向个人与家人的轻量多端笔记应用：浏览器 PWA + Cloudflare 自托管。**Markdown 是所有数据的最终规范形式**——长文笔记、表格、Memo 三种内容形态都从 md 自然延伸，随时可整体导出为 `.md`。

> 当前状态：M0 工程骨架已完成（pnpm workspace + Cloudflare Worker + Vite/React + CI，本地 `pnpm dev` 一键起前后端）。业务功能自 M1（注册登录 → 建笔记 → 编辑保存 → 多端同步）开始，路线图见 `docs/todo/Menote-开发计划-v1.md`（M0–M6）。

## 特性（设计目标）

- **本地优先、离线可用**：元数据与正文缓存在 IndexedDB，界面只读本地；写入先进 outbox，联网后按序补同步，弱网下乐观 UI。
- **三种内容形态**：Markdown 笔记、表格（多维清单，十种字段类型）、Memo 碎片时间线；待办/清单是 Memo 上叠加的标记，视图（图册、瀑布流、看板等）全部由同一份 md 派生，不改数据模型。
- **冲突不静默覆盖**：所有写入带期望版本号（乐观锁），版本不一致时生成冲突副本，由人决定取舍。
- **隐私锁**：加密空间与单篇加密，WebCrypto（PBKDF2 + AES-256-GCM），密钥只在浏览器，服务端不保管。
- **完整的内容生命周期**：自动保存与版本历史、回收站与定时永久删除、附件与图片管线。
- **可出可入**：单篇/全量导出、分享链接、外部备份到 WebDAV / S3 / Git（出站加密信封）。
- **MCP 接入**：第三方 agent 通过 Bearer 令牌读写、搜索你的笔记。
- **跑在 Cloudflare 免费额度内**：胖客户端、瘦服务端，Worker 只做鉴权与字节搬运（每请求 10 ms CPU 约束）。

## 技术栈

| 层 | 选型 | 状态 |
|---|---|---|
| 前端 | React 19 + Vite 8（PWA 规划：vite-plugin-pwa） | 已接入（M0） |
| 编辑器 / 样式 / 本地库 | CodeMirror 6、Tailwind CSS 4、Dexie（IndexedDB） | 规划（M1 起） |
| 后端 | Cloudflare Workers + Hono（同源单 Worker：静态资源 + API + MCP + Cron） | 已接入（M0） |
| 数据 | Cloudflare D1（正文与元数据）+ R2（版本、附件、快照）+ Static Assets | D1 已绑定，R2 于 M4 接入 |
| 语言 | TypeScript（严格模式），前后端统一 | 已接入（M0） |
| 接口校验 | Valibot（前后端共享 schema） | 规划（M1 起） |
| 测试 / CI | Vitest + `@cloudflare/vitest-pool-workers`（真实 workerd + 本地 D1）；GitHub Actions：lint → typecheck → test → build → 体积检查 | 已接入（M0） |
| 部署 | Workers Builds（Git 推送触发）+ Wrangler 声明式资源自动供给 | 已接入（M0） |

## 快速开始

前置：**Node.js ≥ 22**、**pnpm 11**（`corepack enable` 或 `npm i -g pnpm`）。不需要预装 Wrangler 或 Cloudflare 账号，本地开发全部离线模拟。

```bash
pnpm install   # 安装依赖
pnpm dev       # 一条命令起前端 + Worker + 本地 D1
```

- 前端：<http://localhost:5173>（改前端与 Worker 代码都即时热更新）
- API：同源 `/api/*`（如 `/api/health`），由本地 workerd 中的 Worker 处理
- D1 本地自动创建（miniflare 模拟），dev / test / deploy 三处绑定一致

完整说明（仓库结构、测试怎么跑、部署链路、已知约束）见 [`wiki/guides/local-dev.md`](wiki/guides/local-dev.md)。

## 目录结构

```text
apps/web          前端 PWA（Vite + React；入口 src/main.tsx 只做装配）
apps/worker       Cloudflare Worker（Hono；唯一入口 src/index.ts 只做装配）
packages/shared   前后端共享：常量、类型、错误码、纯函数
wrangler.jsonc    唯一 Worker 配置（仓库根）：入口、静态资源、D1 绑定
prototype/        高保真交互原型与线框评审页
wiki/             定稿区（写入与修改须经用户确认）
docs/             过程区：todo/ 实施计划、modules/ 专项设计、scratch/ 草稿、archive/ 归档
DESIGN.md         界面与交互唯一视觉源
AGENTS.md         AI 编程代理工作规则
CHANGELOG.md      每次改动一条记录
```

新增代码先查 `wiki/Menote-项目架构-v1.md` §2.3.2 的「功能 → 代码落点对照表」再落位；入口文件行数预算 ≤ 100，由 ESLint `max-lines` 强制。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 本地开发（前端 + Worker + 本地 D1） |
| `pnpm lint` | ESLint（含入口 / 路由行数预算检查） |
| `pnpm typecheck` | `tsc -b` + 各包 `tsc --noEmit` 全仓类型检查 |
| `pnpm test` | shared 单元测试 + Worker 集成测试（真实 workerd + 本地 D1） |
| `pnpm build` | 构建前端与 Worker 产物（`apps/web/dist/`） |
| `pnpm check:size` | 首屏 JS ≤ 200 KB gzip 预算检查（CI 强制） |
| `pnpm --filter @menote/web preview` | 本地以生产形态预览构建产物 |
| `pnpm deploy` | 构建并部署到 Cloudflare（需先 `wrangler login`） |

## 部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maxxie6418/MeNote)

- **一键部署**：按钮会把仓库克隆到你自己的 GitHub 账户，解析根目录 `wrangler.jsonc`，自动创建并绑定 D1 等资源，同时配置好 Workers Builds。
- **主通道是 Workers Builds**：推送到 `main` 自动构建部署；非生产分支与 PR 自动获得预览 URL。构建命令 `pnpm install --frozen-lockfile && pnpm build`，部署命令 `pnpm --filter @menote/web exec wrangler deploy -c dist/menote/wrangler.json`。
- **命令行部署**：`pnpm build && pnpm deploy`（需 `wrangler login`）。
- 注意：R2（附件，M4 接入）自动创建不豁免绑卡，未绑定支付方式时可先做 D1-only 部署。

详见 `wiki/Menote-项目架构-v1.md` §15.5 与 `wiki/guides/local-dev.md` 第六节。

## 文档导航

| 位置 | 内容 |
|---|---|
| `wiki/` | 定稿（写入与修改须经用户确认）：需求文档（设计文档 v7.4）、功能拆解 v2、项目架构 v1、组件规划、ADR、操作指南 |
| `docs/todo/` | 专项计划：一个功能/任务一份实施计划（当前：`Menote-开发计划-v1.md`，M0–M6 里程碑） |
| `docs/modules/` | 各专项功能的设计文档 |
| `docs/scratch/` | 草稿：临时讨论，一份讨论一份文件 |
| `docs/archive/` | 归档：过期、被取代的文档，默认不读 |
| `prototype/` | `menote-prototype.html`（高保真）、`menote-framework.html`（线框评审页） |
| `DESIGN.md` | 界面与交互唯一视觉源 |
| `AGENTS.md` | AI 编程代理工作规则与文档体系说明 |
| `CHANGELOG.md` | 改动记录（含每次提交的 commit hash） |

**冲突优先级**：功能与规则看 `wiki/`，长什么样看 `DESIGN.md` 与原型，某一屏的结构看 `docs/modules/`，组件契约看 `wiki/components.md`。

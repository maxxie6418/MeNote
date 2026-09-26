# 本地开发上手

| 项 | 值 |
|---|---|
| 适用范围 | Menote 单仓多包（apps/web、apps/worker、packages/*）的本地开发全流程 |
| 权威级别 | 模块规则（仓库结构与技术约束以 `wiki/Menote-项目架构-v1.md` §2.3 为准） |
| 最后更新日期 | 2026-09-26 |

## 一、前置环境

- **Node.js ≥ 22**
- **pnpm 11**：`corepack enable` 后自动按根 `package.json` 的 `packageManager` 字段取版本；或 `npm i -g pnpm`
- 不需要预装 Wrangler 或 Cloudflare 账号——本地开发全部离线模拟

首次克隆后：

```bash
pnpm install
```

## 二、一条命令起开发服

```bash
pnpm dev
```

它做两件事：先构建 `@menote/shared`（其余包以 dist 产物消费它），再启动 `apps/web` 的 Vite。Cloudflare Vite 插件把 Worker 代码跑在本地 workerd 中：

- 前端：<http://localhost:5173>
- API：同源 `/api/*`（如 `/api/health`），由本地 Worker 处理
- **D1 本地自动创建**（miniflare 模拟），`wrangler.jsonc` 里的绑定在 dev/test/deploy 三处行为一致

改前端代码热更新；改 Worker 代码同样即时生效。

## 三、仓库结构（速览）

```text
apps/web          前端 PWA（Vite 8 + React 19 + CodeMirror 规划中）
apps/worker       Cloudflare Worker（Hono；唯一入口 src/index.ts 只做装配）
packages/shared   前后端共享：常量、类型、错误码、纯函数
wrangler.jsonc    唯一 Worker 配置（仓库根）：main、assets、D1 绑定
```

新增代码先查架构文档 §2.3.2「功能 → 代码落点对照表」再落位；入口文件（`apps/worker/src/index.ts`、`apps/web/src/main.tsx`）只做装配，行数预算 ≤ 100，由 ESLint `max-lines` 强制。

## 四、常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 本地开发服（前端 + Worker + 本地 D1） |
| `pnpm lint` | ESLint；含 §2.3.1/§2.3.3 行数预算（入口 ≤ 100 error，路由/服务 ≤ 300 warn，全局 > 500 error） |
| `pnpm typecheck` | `tsc -b`（构建 shared 产物）+ 各包 `tsc --noEmit` |
| `pnpm test` | shared 单元测试 + Worker 集成测试（vitest-pool-workers，真实 workerd + 本地 D1） |
| `pnpm build` | 构建：产物在 `apps/web/dist/`（`client/` 静态资源 + `menote/` Worker 与输出配置） |
| `pnpm check:size` | 首屏 JS ≤ 200 KB gzip（架构 §14.1；CI 强制） |
| `pnpm deploy` | 构建并部署到 Cloudflare（需先 `wrangler login`） |
| `pnpm --filter @menote/web preview` | 本地以生产形态预览构建产物（workerd 运行） |

## 五、测试怎么跑

- **shared**：`packages/shared/test/`，Vitest 纯函数单测。
- **worker**：`apps/worker/test/`，`@cloudflare/vitest-pool-workers` 在真实 workerd 里执行，`SELF.fetch` 直接打 Worker 入口；读取根 `wrangler.jsonc`（兼容日、绑定与部署一致）。
- CI（`.github/workflows/ci.yml`）每次推送/PR 依次跑 lint → typecheck → test → build → check:size。

## 六、部署链路（架构 §15.5）

主部署通道是 **Workers Builds**（Git 推送触发），不用 GitHub Actions 部署：

1. Cloudflare Dashboard → Workers & Pages → Create → 导入本仓库。
2. 构建命令：`pnpm install --frozen-lockfile && pnpm build`
3. 部署命令：`npx wrangler deploy`（默认命令即可，见下方要点）
4. 生产分支 `main`；非生产分支与 PR 自动获得预览 URL。

要点：

- `wrangler.jsonc` 不写资源 ID：首次部署时 D1 按名（`menote-db`）自动供给并回写绑定。
- **部署配置指针**：真正的部署配置是 Vite 构建产物 `apps/web/dist/menote/wrangler.json`；`pnpm build` 的最后一步会在仓库根生成 `.wrangler/deploy/config.json` 指向它，wrangler 检测到该指针即改用产物配置（日志显示 "Using redirected Wrangler configuration"）。因此根目录的默认 `npx wrangler deploy` 可直接使用；不要删除 `scripts/write-deploy-config.mjs`。
- 命令行手动部署：`pnpm deploy`（= `pnpm build && wrangler deploy`，需先 `wrangler login`）。
- 他人自部署可走 README 的 Deploy to Cloudflare 按钮（部署时自动供给资源并克隆新仓库）。
- R2（附件）M4 才接入；未绑卡账户届时需先处理绑卡决策。

## 七、已知约束

- **兼容日 2026-08-22**：受 `@cloudflare/vitest-pool-workers` 0.22 内置 workerd 的兼容日上限约束（该包精确锁定 miniflare 5.20260815.0-alpha）。pool-workers 跟进新版后，与 wrangler 一并上移 `wrangler.jsonc` 的 `compatibility_date`。
- pnpm 固定 `nodeLinker: hoisted` 扁平布局（`pnpm-workspace.yaml`）：pnpm 11 默认 package-map 布局对 tsc/Vite 的模块解析不透明，勿改回。
- `esbuild`、`workerd` 的 postinstall 在 `allowBuilds` 中显式放行（安装平台二进制）。

## 八、M1 开工前必办（M0 遗留挂钩）

- **迁移挂钩（已定）**：迁移走**运行时自愈**（架构 §15.4）——`apps/worker/src/db/selfheal.ts` 在首个请求读 `app_meta.schema_version`、抢锁、按序建表、校验、写版本。**不需要**手工步骤，也**不要**把 `wrangler d1 migrations apply` 加进 `deploy` 脚本（该命令在全新账户上会因查不到库而失败，于是 `wrangler deploy` 永远执行不到；且 Workers Builds 用的是 `npx wrangler deploy`，改本脚本对它无效）。首次部署流程因此是：Workers Builds 跑 `npx wrangler deploy` → D1 自动供给并绑定 → 首个请求建表。
- **机密声明**：第一个服务端机密是 **`AUTH_PEPPER`**（架构 §13.2；生成 `openssl rand -base64 32`），随仓库提供 `.dev.vars.example` 说明格式与生成方式（`.gitignore` 需放行该示例文件）。
  - **不要在 `wrangler.jsonc` 里写 `"secrets": { "required": [...] }`**：该字段不是"部署页提示"，而是 **deploy 的硬门禁**——机密没设时 `wrangler deploy` 直接失败，而首次部署时 Worker 还不存在、无法先设机密，会把一键部署与 Workers Builds 永久堵死（M1 实测踩到过，见 CHANGELOG v0.1.12）。
  - 缺机密的保护改在运行时：`apps/worker/src/middleware/config-guard.ts` 对 `/api/auth/*` 与 `/api/admin/*` 返回 503 并说明缺哪一项，且**不会**用空密钥去算 HMAC。首次部署成功后，在 Dashboard 的 Worker 设置里添加 `AUTH_PEPPER` 即可。
  - **不存在 `SESSION_SECRET`**：会话令牌是随机 256 位、库里只存 SHA-256，无需服务端密钥。
- **前端 feature 互不依赖的 ESLint 规则**：M2 引入 `features/` 时补 no-restricted-imports（跨 feature 复用只走 `app/` 或 `data/`）。

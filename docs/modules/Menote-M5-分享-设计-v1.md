# Menote 分享设计 v1（文档版本 v1.4）

| 项 | 值 |
|---|---|
| 文档版本 | v1.4 |
| 文档状态 | 生效（用户 2026-10-02 确认开工；**S1 服务端 v0.6.13 / S2 管理端 v0.6.14 / S3 查看器 v0.6.15 已落地**；§六 待拍板点已全部落定；**S4 收口的两个门槛均在用户侧**——Cloudflare 子域部署 + 逐条点验、授权回写 `wiki/` 与 `AGENTS.md`，清单见《M5 分享 S4 收口与部署》） |
| 目的和适用范围 | M5 的「分享」半边（功能拆解 M14-01~05 / 需求 §16.1）：创建 / 管理 / 撤销分享链接与访客只读查看器。机制本身是 `wiki/Menote-项目架构-v1` §十的**架构定**，本文只做落地细化与批次划分，不推翻任何定稿 |
| 权威级别 | 模块规则（与架构 §十冲突时以架构为准，停下确认） |
| 最后更新日期 | 2026-10-03 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.6.12 | 2026-10-02 | 初稿：核对架构 §十 / 设计文档 DDL / 功能拆解 M14 与现网代码（Cookie host-only、渲染器依赖已在），按用户 origin 拍板整理落地方案与批次 | GLM-5.3-Flash |
| v1.1 | v0.6.13 | 2026-10-02 | 用户确认开工（首期合集后置、子域走实例设置）；S1 服务端落地：迁移 0005、管理侧四接口（`routes/shares.ts` + `services/shares.ts`）、访客侧四接口（`routes/public.ts` + `services/share-public.ts`，限速与令牌在此）、`packages/shared/src/shares.ts` 契约与 `attachments.ts`（引用解析收进 shared）；`schema-upgrade` 用例按新事实改写（0003 一步升到 5） | GLM-5.3-Flash |
| v1.2 | v0.6.14 | 2026-10-02 | S2 管理端落地：更多菜单「分享」（隐私条目置灰）、`features/shares/`（model + ShareDialog + MySharesPage）、公开标记、加密/进回收站的自动撤销接线（行清理 + 提示）、分享子域存实例设置（`app_meta` 键 + `/api/admin/share-origin`，仅 owner）、设置导航新增「分享」分类。**弹窗只做创建/复制/撤销，改密改期在设置页**（避免两套编辑面），S3 查看器进行中 | GLM-5.3-Flash |
| v1.3 | v0.6.15 | 2026-10-02 | S3 查看器落地：由于 `@cloudflare/vite-plugin` v1.60 接管客户端入口、第二个 html 入口会 `UNRESOLVED_ENTRY`，按 Static Assets SPA 定稿改为 `main.tsx` 按 `/s/<sid>` 路径动态分流（两边动态 import，访客不拉编辑器与同步 chunk）；新增分享状态 / 密码解锁 / 无状态令牌 / 内容呈现 / 附件带令牌取回并改写 blob URL；表格只读网格 + 有附件时图册切换；DOMPurify 增加查看器专用 `allowBlobUris` 开关。**偏离架构入口表的原因与回写项已留在 `main.tsx` 注释** | GLM-5.3-Flash |
| v1.4 | v0.6.17 | 2026-10-03 | **§六 待拍板点整节销账**（四条均已拍板并落地，补上代码证据位置）；文档状态改写为「S4 两个门槛均在用户侧」，指向《M5 分享 S4 收口与部署》。**本轮只改文档，未动任何行为代码** | MiniMax-M3.1-Flash-Preview |

---

## 一、定稿与事实核对（本文的全部前提）

| 项 | 定稿 / 事实 |
|---|---|
| 数据模型 | `shares` + `share_items` 表 DDL 已定（《设计文档》§DDL；《数据模型与迁移设计》标记两者属 **M5**，需要迁移 0005） |
| API | 六个接口已定（架构 §十）：`POST /api/shares`（创建时同语句校验**非隐私条目、未删除**）、`GET / PATCH / DELETE /api/shares(/...)`、访客侧 `GET /api/public/shares/:sid`（状态 + 是否要密码 + 盐与 KDF 参数）、`POST .../unlock`（访客浏览器派生校验值，服务端 HMAC 比对，返回 1 小时 HMAC 访问令牌，**无状态不写库**）、`GET .../content`（单篇原文 / 合集按 50 条分页）、`GET .../att/:attId`（校验附件属于当前稿引用后从 R2 流式返回） |
| 失效规则 | 每次访问**实时检查**：撤销、过期、条目进回收站、条目被加密——任一不满足即「链接已失效」（M14-04；M4 在回收站处留了接口位） |
| 查看器 | 独立入口页，只加载渲染模块（无编辑器与同步代码）；md 渲染经 **DOMPurify** 清洗；`Referrer-Policy: no-referrer`；访问令牌签名密钥由 `AUTH_PEPPER` **HKDF 派生**（标签 `menote-share-v1`，不新增 Secret） |
| Q18（已定建议案） | 表格只读视图，有图片列时可切**图册**；不提供筛选排序 |
| 依赖 | `markdown-it` 与 `dompurify` **已在** `apps/web/package.json`（M2 预览引入）——查看器**零新增生产依赖** |
| Cookie（本次核实） | `setSessionCookie`（`middleware/session.ts`）**不带 `Domain` 属性** → 浏览器默认 **host-only**：主应用会话 Cookie 永远不会发给分享子域，隔离零改动即成立；分享子域上对 `/api/*` 的会话请求天然 401（纵深防御） |
| 限速 | unlock 失败按 `share:<sid>:<ip>` 计次限速（架构 §十） |
| 可分享边界 | 笔记、表格、单条 Memo、Memo 合集；**单篇加密与加密空间内条目不可分享**（创建接口硬校验，前端置灰并说明） |

## 二、origin 落地（用户 2026-10-02 拍板：独立子域）

```text
app.example.com    ← 主应用（现状不变）
share.example.com  ← 分享查看器 + 公开 API，**同一个 Worker**（架构「不拆分多个 Worker」定稿不破）
```

- **同一个 Worker 挂两个 host**：Cloudflare Workers Routes 把 `share.example.com/*` 指到同一 Worker；代码按 host 无关实现（查看器与公开接口都用相对路径 `/api/public/...`），**切子域是纯部署动作，不改代码**。
- **Cookie 隔离**：会话 Cookie 是 host-only（上文核实），子域收不到；访客侧也不需要任何 Cookie（访问令牌放内存）。
- **链接形态**：`https://share.example.com/s/<分享ID>`；同域回退路径 `/s/<sid>` 同样可用（未配子域时先用主域分享，属部署选择，不是代码分支）。
- **部署前提（需要用户在 Cloudflare 操作一次）**：`share` 子域 DNS 记录 + Workers Route；具体步骤随本专项写进部署文档（M6 Runbook 前置）。
- **分享 origin 从哪来（待拍板点 ③）**：创建分享后要给访客**绝对链接**。建议做成**实例设置**（实例管理页一行「分享子域」，默认空 = 用当前站点 origin），不引入新的环境变量约定。

## 三、数据模型与迁移

按设计文档 DDL 原样落迁移 **0005**：`shares`（id ≥128 位随机、`kind ∈ ('item','memo_set')`、`pw_salt / pw_kdf / pw_verifier`、`expires_at`、`revoked_at`）+ `share_items`（合集成员，创建时固定）。密码哈希沿用认证同款思路：访客浏览器 PBKDF2 派生 → 服务端 HMAC 比对，**明文密码不过网、不落库**。

## 四、实施批次（每批一个可上线单元，做完即测即提交）

| 批 | 内容 | 主要落点 |
|---|---|---|
| **S1 服务端** | ✅ **完成（v0.6.13）** | 迁移 0005；shared 补分享令牌 HKDF 与访客 KDF 契约；`services/shares.ts`；`routes/shares.ts` + `routes/public.ts`（六接口 + 实时失效检查 + unlock 限速）；worker 用例 11 条 | `apps/worker/src/**`、`packages/shared/src/**`、`db/migrations/` |
| **S2 分享管理（客户端）✅ 完成（v0.6.14）** | 「更多」菜单加「分享」（隐私条目置灰并说明）；创建弹窗（可选密码 + 过期 1 天 / 7 天 / 30 天 / 自定义 / 永不过期）；创建后链接 + 复制；条目公开标记；设置 › 分享「我的分享」（复制 / 改密 / 改期 / 撤销，撤销立即生效）；**自动撤销接线**：加密 / 移入加密空间 / 移入回收站时调撤销并提示（M14-04） | `features/shares/**`（ui + model 两件套）、`NoteWorkspace`、`SettingsPanel` |
| **S3 查看器 ✅ 完成（v0.6.15）** | `main.tsx` 按 `/s/<分享ID>` 动态分流（Static Assets SPA 回退；查看器 chunk 不拉编辑器 / 同步）；`features/share-viewer/`：状态页 / 密码解锁页 / 渲染页 / 失效页；md 渲染（markdown-it + DOMPurify，查看器专用 `allowBlobUris`）；表格只读 + 图册切换（Q18）；附件带令牌取回后改写 blob URL | `apps/web/src/main.tsx`、`features/share-viewer/**`、`app/editor/markdown.ts` |
| **S4 收口** | 部署文档（子域配置步骤）；wiki 回写清单；真机点验清单 | 文档 |

## 五、安全底线

- 访客令牌 **HMAC 无状态签名**（1 小时有效），不写库、不可续期——每次续看重新 unlock 校验。
- `share:<sid>:<ip>` 计次限速防密码爆破；unlock 失败不给「密码错 / 已失效」之外的任何区分信息。
- 公开附件接口**只**放行「被分享条目当前稿引用」的附件，按引用清单校验，不提供遍历。
- 访客不能编辑、看不到分享者的其他任何内容（M14-05）；渲染结果一律过 DOMPurify。

## 六、待拍板点（已全部落定）

四条都已拍板并落地，此处改为**结论存档**——补上代码证据位置，免得下一轮又把它们当成开放问题重新讨论：

| # | 待拍板点 | 结论 | 落点与证据 |
|---|---|---|---|
| 1 | 首期范围：Memo 固定合集（M14-02）是否后置 | **后置**。首期只做单条分享（笔记 / 表格 / 单条 Memo），`share_items` 表随 0005 建好但**不接 UI** | 用户 2026-10-02 拍板；`apps/worker/src/services/share-public.ts:275` 注释与硬校验 |
| 2 | 过期自定义：日期选择器到天还是到分钟 | **到天**。取当天 `23:59:59.999`（本地时区）——「选 10-08」含义是 10 月 8 日全天可看 | `apps/web/src/features/shares/model.ts:27-42`（`expiryTimestamp`） |
| 3 | 分享子域配置放实例设置还是环境变量 | **实例设置**（本文 §二 的建议案）。仅 owner 可改；**未配置时退回当前站点 origin**，同域 `/s/<id>` 同样可用 | 用户 2026-10-02 拍板；v0.6.14 落地为 `app_meta` 键 + `GET/PUT /api/admin/share-origin`；`model.ts:6-8` 注明回退口径 |
| 4 | unlock 限速是否跟随 MCP 令牌同款机制 | **内存计数起步**。按 `share:<sid>:<ip>` 计次，窗口 15 分钟 / 上限 10 次，超限抛 `rate_limited` | `apps/worker/src/services/share-public.ts:100-120`；架构 §13 口径已核 |

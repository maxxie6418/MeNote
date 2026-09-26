# Menote 认证与会话设计 v1

| 项 | 值 |
|---|---|
| 文档版本 | v1.1 |
| 文档状态 | 生效（用户确认 2026-09-26：设计稿生效、KDF/密钥清单、两环境、`app_meta`、登出不清除缓存、Valibot、wiki 同步项 a–f 均获批准） |
| 目的和适用范围 | 解掉 M1 的第四个阻塞项：KDF 算法与参数、`SESSION_SECRET` 到底存不存在、环境数量、M1 最小设置入口的落点等口径未定。给出 M01 全部接口与安全机制的实现口径 |
| 权威级别 | 模块规则（认证与安全）。规则以 `wiki/Menote-设计文档-v7.4.md` §5.2–§5.4 与 `wiki/Menote-项目架构-v1.md` §13 为准；本文只补齐它们没写死、或互相矛盾的部分 |
| 最后更新日期 | 2026-09-26 |

修改记录：

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型 |
|---|---|---|---|---|
| v1 | v0.1.2 | 2026-09-26 | 初稿：KDF 参数定稿、接口契约、会话与 CSRF、节流曲线、机密清单（取消 SESSION_SECRET）、环境数、M1 最小设置入口落点 | deepseek-v4.1-flash |
| v1.1 | v0.1.3 | 2026-09-26 | 状态改「生效」；据实测与独立复核修正（改密请求体不再要求浏览器产出 `newVerifier`、注册需捕获唯一约束异常、prelogin 的 CSRF 口径统一、设置壳补「通用」默认分类）；应用已批准决定：登出不清除本机缓存、`site_settings` 暂不建表 | deepseek-v4.1-flash |
| v1.2 | v0.1.5 | 2026-09-26 | M1-3 落地回写：§4.1 的 CSRF 口径修正为「`Origin` 缺失放行、在场必须匹配」并说明理由（主防线是 `X-Menote` 自定义头）；标注 dev 浏览器验证仍待 M1-10 补做；§5.3 的设置壳分类与实现一致 | deepseek-v4.1-flash |
| v1.3 | v0.1.10 | 2026-09-26 | dev 链路实测回写：§4.1 记录 17 项断言结果（Cookie 属性、CSRF 两路、注册登录、隔离），并如实标注"真实浏览器 Cookie 存储仍未验、留到 M1-11"与 miniflare 的 `Request.cf` 告警 | deepseek-v4.1-flash |
| v1.4 | v0.1.11 | 2026-09-26 | 修掉会导致锁死账号的落地缺陷：注册与改密改用**与 prelogin 同源的确定盐**（§3.3 记录理由与附带防枚举收益）；§3 接口表补公开接口 `GET /api/auth/registration-state` | deepseek-v4.1-flash |

---

## 一、结论摘要

| # | 结论 | 处理的问题 |
|---|---|---|
| 1 | KDF = **PBKDF2-SHA-256、600,000 次迭代、16 字节盐、32 字节输出**，全部在浏览器 WebCrypto 执行；服务端只做一次 HMAC 比对。**Argon2id 不用**（CSP 已删 `wasm-unsafe-eval`，v7.4 里 `auth_kdf` 的 argon2id 举例作废） | §2 |
| 2 | **取消 `SESSION_SECRET`**。会话令牌是 32 字节随机数、库里只存 SHA-256，没有任何服务端密钥参与；工程化文档与架构 §15.5 里的这个占位删掉。M1 唯一的机密是 **`AUTH_PEPPER`**；`BACKUP_CRED_KEY` 到 M5 才引入 | §6 |
| 3 | 环境只做 **本地 + 生产** 两套；架构 §15.3 的"测试环境"推迟到 M6 性能实测前再建（它不参与一键部署） | §7 |
| 4 | M1 自带**最小设置入口**：设置壳按 DESIGN 的两栏分页做（左列 184px 分类导航 + 右侧内容），M1 只落地「账户与安全」与「实例管理（仅 owner）」两项，其余 8 个分类在 M2/M6 补内容——**不另做一套骨架** | §5.3 |
| 5 | 注册开关状态放 `app_meta`（`registration_open` / `registration_close_at` 键），**M1 不新建 `site_settings` 表**。注意：功能拆解 M18-01 说实例级设置存 `site_settings`，与需求 §18.2 的 DDL 不一致——两份 wiki 定稿冲突，已列入 §8 待点头项 | §3.3 |

---

## 二、KDF 与登录密钥

### 2.1 参数（本文定稿）

| 项 | 值 |
|---|---|
| 算法 | PBKDF2（WebCrypto `deriveBits`，`PBKDF2` + `SHA-256`） |
| 迭代次数 | **600,000** |
| 盐 | 16 字节，服务端生成（`crypto.getRandomValues`），存 `users.auth_salt` |
| 输出长度 | 32 字节 |
| 编码 | 登录密钥 = base64url(32 字节)；`auth_kdf` = `{"alg":"PBKDF2-SHA256","iterations":600000,"saltBytes":16,"dkLen":32}` |

- 客户端只在**登录 / 注册 / 修改密码**时算一次，不常驻内存；算完立即提交，刷新页面后需重新提交密码。
- **上线前必须实测**：中端手机（约 4× CPU 降速）上 600k 迭代应在 2 秒内完成。若超过，把迭代数降到 310,000 并在 `auth_kdf` 里记录实际值（老用户按各自 `auth_kdf` 校验，无需强制迁移）——**这是唯一可能因性能而变的安全参数**。
- `users.auth_verifier` = `HMAC-SHA256(AUTH_PEPPER, 登录密钥)`，32 字节 BLOB。库被拖走时攻击者既要离线爆破 PBKDF2，又缺 pepper（需求 §5.4）。

### 2.2 不存在的用户名也要返回盐（防枚举）

`POST /api/auth/prelogin { username }` →

- 存在：返回该用户的 `auth_salt`（base64url）与 `auth_kdf`。
- 不存在：返回 `salt = HMAC-SHA256(AUTH_PEPPER, "menote-prelogin-v1:" + username.toLowerCase())[0..16]` 与**与真实用户相同形态**的 `auth_kdf`。
- 两条分支返回同形状、同长度的响应，**不返回用户是否存在**。

---

## 三、接口契约（M1 全量）

| 接口 | 说明 | 错误码 |
|---|---|---|
| `POST /api/auth/prelogin` | 见 §2.2。**无需会话**；CSRF 约束见 §4.1（与 login 一致） | `invalid` |
| `POST /api/auth/login` | 提交 `{ username, loginKey }`；服务端 `HMAC-SHA256(AUTH_PEPPER, loginKey)` 与 `auth_verifier` **常量时间比对**；成功下发会话 Cookie | `unauthenticated`（统一"用户名或密码错误"）、`rate_limited` |
| `POST /api/auth/register` | 见 §3.3 | `forbidden`（注册未开放）、`invalid`（用户名非法/已存在） |
| `POST /api/auth/logout` | 删除当前会话行、清 Cookie | — |
| `GET /api/auth/me` | 返回 `{ id, username, role }`；未登录 → 401 | `unauthenticated` |
| `POST /api/auth/password` | `{ loginKey, newLoginKey, newKdf? }`：先用 `loginKey` 校验旧密码，服务端**自己生成新盐**并算 `newVerifier = HMAC-SHA256(AUTH_PEPPER, newLoginKey)`，再写新三元组；**保留当前设备会话，其他设备会话全部失效**（拆解 M01-05 的建议） | `unauthenticated`、`invalid` |
| `GET /api/admin/registration`（仅 owner） | 读注册开关与到期时间 | `forbidden` |
| `PUT /api/admin/registration`（仅 owner） | `{ open, closeAt? }`；写 `app_meta` | `forbidden` |
| `GET /api/auth/registration-state` | **公开、无需登录**：`{ open, has_users }`，登录页据此决定是否显示注册入口；`has_users=false` 时前端直接进注册页（拆解 M01-01） | — |

**路径与落点不一致的说明**：架构 §2.3.2 没有 `admin.ts` 这一行，而"设置与隐私标记"已指派到 `routes/settings.ts` + `services/settings.ts`。M1 把这两个 admin 接口放进 `routes/settings.ts`（路径保持 `/api/admin/registration`，与需求 §5.4 一致），并在 §2.3.2 补一行落点（wiki 改动，待点头）。

### 3.1 常量时间比对

WebCrypto 没有 `timingSafeEqual`。实现一个 16 行以内的字节比较：长度不等直接返回 false，否则逐字节 XOR 累加后判零，**不用 `===` 比 Buffer、不用字符串比较**。放 `apps/worker/src/services/tokens.ts`，附单测。

### 3.2 登录失败节流

- 只计**失败**：`auth_throttle` 的 `login:<username>` 与 `login-ip:<ip>` 两行。
- 冷却曲线（本文定稿）：第 5 次失败起 `locked_until = now + 30s`；之后每次失败**翻倍**，上限 **15 分钟**。
- 命中冷却 → `429 rate_limited`，响应带剩余秒数，界面文案"尝试过于频繁，请 N 秒后再试"（拆解 M01-03）。
- 登录成功 → 删除该 username 与 IP 的计数行（只在成功时多一次写，可接受）。
- IP 取 `CF-Connecting-IP`；本地 dev 无该头时回退为固定串，**不取 `X-Forwarded-For`**。

### 3.3 注册：单语句判定首位 owner

需求 §5.3 与架构 §13.1 要求"库中无用户"与"注册开关开启且未到期"在**同一条语句**里判定，避免两个并发的首次注册都成为 owner：

```sql
INSERT INTO users (id, username, role, auth_salt, auth_kdf, auth_verifier, status, created_at, updated_at)
SELECT :id, :username,
       CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 'owner' ELSE 'member' END,
       :salt, :kdf, :verifier, 'active', :now, :now
 WHERE (SELECT COUNT(*) FROM users) = 0
    OR (COALESCE((SELECT value FROM app_meta WHERE key = 'registration_open'), '0') = '1'
        AND (CAST(COALESCE((SELECT value FROM app_meta WHERE key = 'registration_close_at'), '0') AS INTEGER) = 0
             OR CAST((SELECT value FROM app_meta WHERE key = 'registration_close_at') AS INTEGER) > :now));
```

- 影响行数为 1 → 200（**首个用户时 role 必为 owner**）。
- **用户名已被占用时会抛唯一约束异常，而不是"影响 0 行"**（已在 SQLite 上实测：`UNIQUE COLLATE NOCASE` 对大小写不同的同名同样拒绝）。因此实现必须**捕获该约束错误并映射为 `invalid`（用户名已存在）**，不能只靠影响行数分支判断。
- 影响行数为 0（且未触发唯一约束）→ 再查一次 `SELECT 1 FROM users WHERE username = ?`：命中 → `invalid`；否则 → `forbidden`（注册未开放）。
- 注册成功后自动登录（同 `login` 的会话下发路径）→ 进启动视图。
- `registration_close_at = 0` 表示"不自动到期"；到期自动关闭由 Cron 承担（M6，M1 只在读取时判到期即可，**不需要 Cron**）。
- 用户名规则：长度 1–32、`COLLATE NOCASE` 唯一、只允许字母数字与 `_-.`（`packages/shared` 用 Valibot 定义，两端复用）。
- **盐必须与 prelogin 完全一致（v1.4 修正的落地缺陷）**：客户端只能拿到 prelogin 给的盐来派生登录密钥，因此**注册与改密都不能另取随机盐**，一律用与假盐同源的确定盐
  `HMAC-SHA256(AUTH_PEPPER, "menote-prelogin-v1:" + 用户名小写)[0..16]`。否则用户注册成功或改密成功后，下一次登录会用新盐派生出**不同**的登录密钥，直接锁死账号。
  - 附带收益：注册前后 prelogin 返回的盐**不变**，攻击者无法靠"盐变了"判断用户名是否已存在，正好满足 §2.2 的防枚举目标。
  - 安全上无损失：盐本就是公开数据（与校验值同库存储），其作用是不复用而非保密；每个用户名一个不同盐，跨账号彩虹表依然无效。

---

## 四、会话

| 项 | 值 |
|---|---|
| 令牌 | 32 字节 `crypto.getRandomValues`，base64url；只在响应里出现一次，客户端不落地（HttpOnly Cookie） |
| 存储 | `sessions.token_hash` = `SHA-256(token)` 的 **32 字节 BLOB**（D1 绑定 `ArrayBuffer`） |
| Cookie | `menote_session`；`HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`；`Secure` 在生产恒开 |
| 有效期 | **滑动 30 天**（需求 §5.4） |
| 写库频率 | 每个请求**最多一条** `UPDATE`，且只在该行 `last_seen_at` 早于 24 小时前时执行；同时推进 `expires_at`：

```sql
UPDATE sessions
   SET last_seen_at = :now, expires_at = :now + 2592000000
 WHERE token_hash = :hash AND last_seen_at < :now - 86400000;
```

- 鉴权路径：`middleware/session.ts` 取 Cookie → SHA-256 → `SELECT user_id, expires_at FROM sessions WHERE token_hash = ?`（1 次读）→ 过期则删行并 401。CPU 预算与架构 §14.2 一致（1 次 SHA-256 + 1 次 D1 读）。
- **dev 注意事项**：`Secure` Cookie 在 `http://localhost` 上 Chrome / Firefox 按可信源放行，但必须在 M1 第一天实测；若某浏览器拒绝，退化为"`URL.origin` 为 https 时才加 `Secure`"的单一常量分支（**只影响 dev**，不改变生产行为）。
- `last_seen_at` 的滑动**不改变**"登录设备管理"的语义；M01-06 的登录设备列表仍留占位。

### 4.1 CSRF 与请求头

- 所有**非 GET** 的 `/api/*` 请求必须带 `X-Menote: 1`；`Origin` **在场时**必须等于 `new URL(c.req.url).origin`（架构 §13.2，不硬编码域名）。不满足 → `403 csrf`。
- `SameSite=Lax` 是第二层；两层都要，不互相替代。
- `POST /api/auth/prelogin` 与 `/api/auth/login` 同样受 CSRF 约束（它们是 POST），`/api/health` 不受。
- **实现口径修正（v1.2）**：v1 写的是"Origin 必须等于本域"，实现改为 **`Origin` 缺失时放行、在场时必须匹配**。理由：跨站写请求由浏览器发起时一定带 `Origin`（表单提交与 fetch 都带），缺失只可能是非浏览器客户端，而这类客户端没有受害者 Cookie、不构成 CSRF 场景；反过来，严格"缺失即拒绝"会在本地 Vite dev 等环境下拦掉正常的同源写请求，把一个安全问题换成一个开发期故障。**主防线始终是 `X-Menote` 自定义头**（跨站无法携带、跨站 fetch 会先触发不获放行的 CORS 预检）。
- **dev 链路已实测（2026-09-26，`pnpm dev` + 真实 workerd + 本地 D1，用 Node fetch 打 17 项断言）**：`Origin` 与本机 `URL.origin` 一致；缺 `X-Menote` / `Origin` 不一致都返回 403 `csrf`；`http://localhost` 下**不带 `Secure`**（带 `HttpOnly` / `SameSite=Lax` / `Path=/`），因此浏览器能正常写入会话 Cookie；未登录 401、注册 201 并自动登录、`/api/auth/me` 返回 owner。
  - **仍未验的部分（如实标注）**：真实浏览器对 `SameSite=Lax` + 非 `Secure` Cookie 的**存储与随请求发送**行为（上面的验证是 Node fetch，不做 Cookie 策略判定）；以及 `localhost` 之外的局域网 IP 访问场景。这两条留到 M1-11 的两设备真机验证一起过。
  - 顺带记录一条本地开发告警（不影响功能）：离线环境下 miniflare 取不到 `Request.cf` 样本，会打印 `Unable to fetch the Request.cf object! Falling back to a default placeholder` 并回退默认值，接口行为正常。
- **实现状态**：以上四条已按本节口径落地（`middleware/csrf.ts`、`middleware/session.ts`），并有用例覆盖（缺头 403、异源 403、GET 不受约束、伪造令牌 401）。

---

## 五、M1 落点与范围

### 5.1 文件

| 落点 | 职责 |
|---|---|
| `apps/worker/src/routes/auth.ts` | 参数校验 + 转服务层（架构 §2.3.2） |
| `apps/worker/src/routes/settings.ts` | `/api/admin/registration` 两个 owner 接口 |
| `apps/worker/src/services/auth.ts` | 注册 / 登录 / 改密的领域逻辑（**§2.3.2 需补此文件**，见 §8） |
| `apps/worker/src/services/sessions.ts` | 会话创建、校验、滑动、删除 |
| `apps/worker/src/services/tokens.ts` | 令牌生成、SHA-256、常量时间比对、假盐派生 |
| `apps/worker/src/middleware/session.ts` | 鉴权中间件（**目录需新建**，架构目录树里缺 `middleware/`） |
| `apps/worker/src/index.ts` | 只挂路由与中间件（≤100 行） |
| `packages/shared/src/` | 认证相关类型 + Valibot schema（M1 引入 Valibot 依赖） |
| `apps/web/src/features/auth/` | 登录页、注册页、`AuthGate` |
| `apps/web/src/features/settings/` | M1 最小设置壳（§5.3） |

### 5.2 前端行为（拆解 M01）

- 库中无用户 → 直接显示注册页，并提示"第一个注册的账号将成为管理员（owner）"；注册页**不受注册开关限制**。
- 注册开关关闭时，登录页不显示注册入口；直接访问注册路由返回"注册未开放"。
- 登录失败统一提示"用户名或密码错误"；冷却提示带剩余秒数；**断网时提示"无法连接服务器，请检查网络后重试"，不进离线模式**。
- 会话过期 → 下次联网请求 401 → 跳登录页；**本地 outbox 未上传的改动保留**，重新登录后继续上传（拆解 M01-04）。
- 登出 → 删会话 + 清本地会话态；若隐私锁处于解锁状态则同时锁定（M3 才有效，M1 留接口位）。
- **Q22（登出是否清除本机明文缓存）保持待确认，且两份定稿口径冲突**：架构 §3.2 写"登出清除本机缓存仍按需求 15.1 执行"，但需求 §15.1 只描述本地存了哪些数据、并没有规定登出要清除；功能拆解 M01-04 把它标为【建议·待确认 Q22】。→ M1 按"**不清除**"实现（清缓存会让重新登录后首屏显著变慢），行为集中在一处便于翻转，并列入 §8 待用户择一。

### 5.3 M1 最小设置入口（本文决定）

- 骨架按 DESIGN.md §2.2 / §2.7 做：左列分类导航 **184px**（独立滚动）+ 右侧内容区（独立滚动），一次只渲染一个分类。
- M1 落地的分类（3 个，默认落**通用**——功能拆解 M18-01 要求默认落通用，M1 必须给它一个默认分类，否则设置页打开即空）：
  - **通用**：主题三档（浅色 / 深色 / 跟随系统，默认浅色）；启动视图与时区在 M2 补齐。
  - **账户与安全**：修改登录密码、登出；（M01-06 的"登录设备"只留标题占位）
  - **实例管理**（仅 owner 可见）：注册开关 + 到期自动关闭。
- 其余 7 个分类（编辑器 / 隐私锁 / 版本与回收站 / 备份 / 分享 / MCP / 数据管理）在 M2/M6 补内容，**M1 不在导航里预置空分类**（避免出现点进去什么都没有的入口）。
- 目的：让 M01-02（注册开关）、M01-04（登出）、M01-05（改密码）在 M1 就有界面落点；M2 的 M18-01 是**补分类**而不是重搭骨架，符合 DESIGN.md 禁止项 #5。

---

## 六、机密与配置

| 项 | M1 | 说明 |
|---|---|---|
| `AUTH_PEPPER` | ✅ 必需 | 生成：`openssl rand -base64 32`。用于 `auth_verifier`、prelogin 假盐；M5 起分享令牌签名键由它 HKDF 派生 |
| `.dev.vars.example` | ✅ 新建，但**需先改 `.gitignore`** | 内容形如 `AUTH_PEPPER=<32 字节 base64>`，附生成命令。**实测冲突**：`git check-ignore -v .dev.vars.example` → `.gitignore:16:.dev.vars*`，该文件当前永远无法提交，而架构 §15.5 要求随仓库提供它以支持一键部署。需把 `.gitignore` 第 16 行改为 `.dev.vars` / `.dev.vars.*` 并加 `!.dev.vars.example`（属根配置改动，列入 §8 待点头项） |
| `wrangler.jsonc` 的 `secrets.required` | ✅ 加 | `"secrets": { "required": ["AUTH_PEPPER"] }`。**已验证**：该字段存在于 `wrangler@4.141.0` 的配置 schema（`node_modules/wrangler/config-schema.json`），描述为"必需机密名单：取代 .dev.vars/.env 推断用于类型生成，并在本地开发时对缺失机密给出警告"。**未验证**：架构 §15.5 说它能让一键部署的设置页"逐项提示填密钥"——schema 描述里没有这一作用，落地时以实际部署页行为为准（反正加上它零成本） |
| `SESSION_SECRET` | ❌ **取消** | 无用途（§1 结论 2）。`wiki/guides/local-dev.md` §8 与架构 §15.5 的例子需同步删除 |
| `BACKUP_CRED_KEY` | ⏳ M5 | 备份内容密钥 K 的包裹键 |

**Cookie 与响应头**：前端静态资源的安全头由 `apps/web/public/_headers` 下发（M0 已有），但 **Worker 的 `/api/*` 响应不带这些头**。M1 在 `index.ts` 挂一个极薄的响应头中间件补 `X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`（CSP 对 JSON 响应意义不大，可不加）。

---

## 七、环境

| 环境 | M1 | 组成 |
|---|---|---|
| 本地开发 | ✅ | Vite + `@cloudflare/vite-plugin`（本地 workerd + D1 + 机密来自 `.dev.vars`） |
| 生产 | ✅ | Workers Builds 一键部署；`*.workers.dev` 子域（自定义域可选后置） |
| 测试环境 | ⏳ M6 前 | 架构 §15.3 的独立 Worker + D1 + R2，用于 14.2 的 CPU 实测与发布前验证；不参与一键部署，M1 起建只会增加两套机密的维护成本 |

---

## 八、wiki 同步项（用户已批准 2026-09-26；执行情况）

> **执行情况**：第 1–4、7 项已执行（架构升 v1.9：§13.2/§15.5 机密清单、§2.3.2 落点行与目录树 `middleware/`；`wiki/guides/local-dev.md` §8 重写；根 `.gitignore` 已放行 `.dev.vars.example`）；第 5、6 项用户已分别定为"用 `app_meta`"与"登出不清除缓存"，功能拆解 M18-01 / M01-04 已同步（拆解升 v2.4）、架构 §3.2 的相反表述已更正。`SESSION_SECRET` 已从架构机密清单删除；需求 v7.5 的 `auth_kdf` 举例待随该次修订落地。

| # | 文件 | 改动 |
|---|---|---|
| 1 | `wiki/guides/local-dev.md` §8 | 删"deploy 脚本改 `wrangler d1 migrations apply`"与 `SESSION_SECRET` 例子；改为"AUTH_PEPPER + 运行时自愈迁移" |
| 2 | `wiki/Menote-项目架构-v1.md` §13.2 / §15.5 | 机密清单删 `SESSION_SECRET`；KDF 举例统一为 PBKDF2 |
| 3 | `wiki/Menote-项目架构-v1.md` §2.3.2 | 补落点行：`services/auth.ts`、`routes/settings.ts` 承载 `/api/admin/registration`、`/api/health` 归 `routes/health.ts`；目录树补 `middleware/` |
| 4 | `wiki/Menote-设计文档-v7.4.md` §5.4、§18.2 | 升 v7.5 时把 `auth_kdf` 举例改为 PBKDF2 |
| 5 | `wiki/Menote-功能拆解-v2.md` M18-01 vs `wiki/Menote-设计文档-v7.4.md` §18.2 | 实例级设置的存放（`site_settings` 表 vs `app_meta` 键）两份定稿不一致，需择一；M1 先用 `app_meta` |
| 6 | `wiki/Menote-项目架构-v1.md` §3.2 vs `wiki/Menote-功能拆解-v2.md` M01-04 / 需求 §15.1 | 登出是否清除本机明文缓存：架构说"清除，按需求 15.1 执行"，但需求 §15.1 并未规定；功能拆解标为待确认 Q22。需择一 |
| 7 | 根 `.gitignore` 第 16 行 | `.dev.vars*` 把 `.dev.vars.example` 一并屏蔽（实测），与架构 §15.5 冲突；见 §6 表 |

---

## 九、待确认

| # | 项 | 建议 |
|---|---|---|
| 1 | Q22：登出是否清除本机明文缓存 | M1 不清除（§5.2），行为集中一处便于翻转；两份定稿口径冲突见 §8 第 6 项 |
| 2 | 用户名允许字符集 | 字母数字 + `_-.`，长度 1–32（本文决定；需求未写） |
| 3 | 注册时"用户名已存在"会泄露用户名存在性 | 接受：注册开关默认关闭，且用户必须知道用户名被占用；登录路径仍统一文案 |
| 4 | 改密码后其他设备会话失效是否要提示 | 建议返回"已使 N 个其他会话失效"，界面提示；实现成本低 |
| 5 | PBKDF2 600k 的实测结果 | M1 用真机测一次并把结论写回本文 §2.1 |

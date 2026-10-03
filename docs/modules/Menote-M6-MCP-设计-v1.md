# Menote M6 MCP 设计（功能拆解 M17）

| 项 | 值 |
|---|---|
| 文档版本 | v1 |
| 文档状态 | **评审中**（用户在 2026-10-03 拍板：①限速计数落令牌行 ②切 4 批 ③设置页稿放到后端全做完之后出） |
| 目的和适用范围 | M6 的第三块：把 Menote 开放给外部 agent（MCP）。覆盖数据层、令牌与鉴权、协议层、11 个工具、审计与幂等、设置 › MCP 界面 |
| 权威级别 | 模块规则。**协议、工具清单、权限与可见性一律照定稿**（《项目架构》§十一 / 《设计文档》§十七 / 功能拆解 M17），本设计只补定稿没写到实现层的细节。**唯一一处偏离定稿**：限速的落地方式（见 §3.5，用户 2026-10-03 拍板） |
| 最后更新日期 | 2026-10-03 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.6.22 | 2026-10-03 | 初稿。用户拍板三点：限速计数落在令牌行（不用 Workers Rate Limiting 绑定）、切 4 批、设置 › MCP 的界面稿放到后端全做完之后再出 | MiniMax-M3.1-Flash-Preview |

---

## 一、范围

### 1.1 做什么

1. 迁移 `0006_mcp`：`api_tokens` / `audit_log` / `mcp_operations` 三张表（DDL 照《设计文档》§DDL MCP 段，**照抄不改列**）。
2. 令牌管理的 4 个会话鉴权接口（设置页用）。
3. MCP 端点：`POST /mcp`、`POST /mcp/k/<令牌>`、`GET /mcp` → 405。
4. 11 个工具（只读 5 + 写类 6），含权限位、范围过滤、乐观锁、幂等、写前封存。
5. 审计日志与令牌详情页查看。
6. 设置 › MCP 分类（导航第 11 类，正好补齐定稿的 11 类）。

### 1.2 不做什么

| 不做 | 依据 |
|---|---|
| OAuth、SSE 长连接、Durable Objects | 设计 §17.1「无状态 Streamable HTTP」「不需要 DO」 |
| 文件夹与标签的增删改工具 | 设计 §17.6 明确砍掉（管理类操作，误操作影响面大） |
| 附件、分享、备份、设置类工具 | 同上（附件要 base64、分享等于对外公开、备份是运维操作） |
| `create_item` 自动创建文件夹 | 设计 §17.5「文件夹必须已存在」 |
| 永久删除 | 设计 §17.3「永久删除不开放」 |
| 让 MCP 写加密空间或置 `enc_self` | 见 §6.7-8，隐私动作不进 MCP |
| 令牌改期 / 改权限 / 改范围 | 定稿只要求「随时撤销」+「创建时设定」；`PATCH` 留后（见 §十一） |

### 1.3 与定稿的两处已知不一致（照文档处理，不改 DDL）

| 不一致 | 处理 |
|---|---|
| DDL 写 `include_memos INTEGER NOT NULL DEFAULT 1`，但 M17-03 表说「默认不勾选＝不可见」 | **以 M17-03 为准**：创建令牌时总是显式写 `include_memos = 0`（UI 默认不勾选），代码里**不依赖列默认值** |
| `jobs/maintenance.ts:331` 清理的表名是 `mcp_idempotency`，DDL 里叫 `mcp_operations` | 那张表从未建过，这段清理一直是空转（被 `tableExists` 守卫，不报错）。随本迁移改成 `mcp_operations` |

---

## 二、模块落点

### 2.1 服务端

| 文件 | 职责 | 行数预估 |
|---|---|---|
| `apps/worker/src/db/migrations/0006_mcp.ts` | 三张表 + 索引（语句必须单行、幂等） | 40 |
| `apps/worker/src/db/mcp-tables.ts`（新） | MCP 专用 SQL 常量 | 90 |
| `apps/worker/src/services/mcp/tokens.ts` | **管理侧**（批 1 已落地）：令牌生成与哈希、建（含上限 20）、列、撤销、审计分页 | 250 |
| `apps/worker/src/services/mcp/auth.ts` | **调用侧**（批 2）：鉴权解析、限速窗口、`last_used_at`（与"管理令牌"是两条独立演进线，故拆开） | 180 |
| `apps/worker/src/services/mcp/scope.ts` | 可见性不变式 I1、范围 SQL 片段、目标文件夹是否在范围内 | 120 |
| `apps/worker/src/services/mcp/jsonrpc.ts` | JSON-RPC 分发、错误码、批量与通知 | 140 |
| `apps/worker/src/services/mcp/registry.ts` | 11 个工具的注册表：名称 / 描述 / JSON Schema 静态常量 / 权限位 | 260 |
| `apps/worker/src/services/mcp/tools-read.ts` | `search` / `list_folders` / `list_items` / `list_versions` | 250 |
| `apps/worker/src/services/mcp/tools-read-item.ts` | **批 2 补**：只放 `read_item`（区间 / 小节 / 游标 / 版本四种模式，拆出来是为了不把 `tools-read.ts` 顶过 300 行） | 190 |
| `apps/worker/src/services/mcp/parts.ts` | **批 2 补**：游标编解码、字符切片、参数夹取、条目元数据映射、`McpToolError`——批 3 的写类工具也要用，共用零件单独一份 | 200 |
| `apps/worker/src/services/mcp/tools-write.ts` | `create_item` / `append_to_item` / `trash_item`（**必须带 `operation_id`** 的那三个） | 330 |
| `apps/worker/src/services/mcp/tools-write-edit.ts` | `edit_item`（五种模式 + 冲突副本）/ `organize_item` | 290 |
| `apps/worker/src/services/mcp/tools-write-table.ts` | **批 3 补**：`edit_table_rows`（表格那一摊的边界单独成文件） | 90 |
| `apps/worker/src/services/mcp/write-parts.ts` | **批 3 补**：乐观锁判定、`canonicalJson` 参数摘要、幂等三态、`commitBody`（封存 → 写入 → 审计同批） | 260 |
| `apps/worker/src/services/mcp/audit.ts` | 审计与幂等记录（设计 §六-4、§七） | 120 |
| `apps/worker/src/services/mcp/seal.ts` | **批 3 补**：`pre_mcp` 写前封存（10 分钟节流、`keep = 1`） | 90 |
| `apps/worker/src/routes/mcp.ts` | `POST /mcp`、`POST /mcp/k/:token`、`GET /mcp` | 90 |
| `apps/worker/src/routes/mcp-tokens.ts` | 令牌管理的 4 个会话接口 | 70 |

**为什么 SQL 常量单独一个文件**：`db/tables.ts` 已有 430 行，ESLint 预算是 >300 警告 / >500 失败。MCP 要加约 30 条常量，铺进去必然越线。沿用 `db/privacy.ts` 的先例（也是从 `tables.ts` 里独立出来的），新建 `db/mcp-tables.ts`。

**入口只装配**：`index.ts` 现有 85 行，预算 ≤100。新增两行——`app.route("/mcp", mcp)` 与 `app.route("/api", mcpTokens)`，不动其它逻辑。

### 2.2 共享包与前端

| 文件 | 职责 |
|---|---|
| `packages/shared/src/mcp.ts`（新） | 令牌 / 审计的类型与 valibot schema、权限位掩码、MCP 相关的上限常量 |
| `packages/mdcore/src/section.ts`（新） | Markdown 小节切分（纯函数，见 §6.2-4） |
| `apps/web/src/features/mcp/model.ts` + `ui/*.tsx` | 设置 › MCP 页面（批 4） |
| `apps/web/src/app/router.ts` | `SETTINGS_PAGES` 加 `"mcp"`（10 → 11 类） |

---

## 三、令牌与鉴权

### 3.1 令牌格式与存储

| 项 | 设计 |
|---|---|
| 格式 | `mn_` + `base64url(32 字节随机数)`（设计 §17.3） |
| 库里存什么 | `token_hash`（BLOB）= `SHA-256(UTF-8(整个令牌字符串，含 `mn_` 前缀))` |
| 界面显示 | `token_prefix` = `mn_` + base64url 前 4 字符 + `…` |

**为什么哈希整个字符串、而不是像会话那样哈希裸字节**（这条容易写错，写错就是一个越权）：会话令牌存的是 `SHA-256(base64UrlDecode(token))`，而 MCP 令牌恰好也是 32 字节随机数走 base64url。**若两边都哈希裸字节，一个会话令牌字符串就能当成合法 MCP 令牌通过鉴权**——令牌的权限位、范围、审计全在它名下。把 `mn_` 前缀一起喂进哈希，两类令牌就落在不同的哈希域里。`tokens.ts` 里另有一道前置检查：不是 `mn_` 开头的直接拒，不进哈希。

### 3.2 两种传输方式

| 方式 | 端点 | 开关 |
|---|---|---|
| 请求头（主） | `POST /mcp`，`Authorization: Bearer mn_…` | 无需开关 |
| URL（兜底） | `POST /mcp/k/<令牌>` | 令牌必须 `allow_url = 1`，否则一律 401 |

审计日志**不记录完整 URL**（设计 §17.2）。实现上：审计行只落 `tool` / `item_id` / 结果，`token_id` 落库；请求 URL 不进 `audit_log`，也不进 MCP 自己的日志。

### 3.3 每次调用的处理顺序

照《项目架构》§十一的顺序，一步不差：

1. 取令牌（`Authorization` 优先，其次路径段）→ `mn_` 前缀检查 → `SHA-256` 查 `api_tokens`（1 次读）
2. 撤销检查（`revoked_at IS NOT NULL` → 401）
3. 过期检查（`expires_at IS NOT NULL AND expires_at <= now` → 401）
4. 限速（§3.5）
5. 权限位检查（工具注册表声明的位）
6. 范围过滤（§四）
7. 执行
8. 审计 + 幂等记录（写类工具，与写入**同一个 batch**）

`last_used_at` 最多每 10 分钟写一次（`MCP_LAST_USED_TOUCH_INTERVAL_MS` 加进 `shared/limits.ts`），与限速的计数更新合并成同一条 `UPDATE`（§3.5）。

### 3.4 令牌管理接口（4 个，会话 + CSRF）

挂在 `/api/mcp/tokens`，走 `requireSession`（与 `routes/shares.ts` 同一套）。

| 接口 | 请求 | 响应 |
|---|---|---|
| `GET /api/mcp/tokens` | — | 令牌列表（**永不回显完整令牌**）：id、name、`token_prefix`、`perms`、`folder_scope`、`include_memos`、`allow_url`、`rate_per_min`、`expires_at`、`created_at`、`last_used_at`、`revoked_at` |
| `POST /api/mcp/tokens` | `{ name, perms, folder_scope, include_memos, allow_url, rate_per_min, expires_in }` | **201 + 完整令牌（仅此一次）** |
| `DELETE /api/mcp/tokens/:id` | — | 撤销（`revoked_at`，不物理删，审计行还要指回它） |
| `GET /api/mcp/tokens/:id/audit` | `?limit?&cursor?` | 该令牌的写操作记录（工具、条目、结果、写前 / 写后 rev、时间、`operation_id`） |

**校验规则**（服务端，不靠 UI）：

- `name` 必填非空，≤64 字符。
- `perms`：位掩码，**bit 0（只读）恒置 1**；其余三位任意组合。
- `folder_scope`：`null` = 全部；否则文件夹 ID 的 JSON 数组，**必须属于该用户、必须不是加密空间行、必须未删除**（逐个查，越权 / 非法直接 422）。
- `include_memos`：0 / 1。
- `allow_url`：0 / 1，默认 0。
- `rate_per_min`：默认 60，范围 1 ~ 600。
- `expires_in`：`7d` / `30d` / `90d` / 自定义毫秒 / `null`（永不过期）→ 落 `expires_at`。
- **每个用户最多 20 个有效令牌**（有效 = `revoked_at IS NULL`）。达上限时 `POST` 返回 409 并带当前有效数，UI 把「创建」置灰并提示。

### 3.5 限速：计数落在令牌行上（偏离定稿，用户 2026-10-03 拍板）

《设计文档》§17.3 写「优先使用 Workers Rate Limiting 绑定（免费版可用性待核实）；不可用时用 D1 中按分钟窗口的计数」。本设计**直接用 D1 计数**，理由三条：

1. 加 `ratelimits` 绑定要改 `wrangler.jsonc`（部署配置），且本地 dev 与 `@cloudflare/vitest-pool-workers` 都要额外造绑定、多一套桩。
2. 免费版 D1 只有 **10 万行写/天**；一个令牌跑满 60 次/分 ≈ **8.6 万行/天**，单个令牌就吃掉大半。绑定的价值正在于它不耗 D1 写——所以这条不算否定绑定，是「个人 / 家庭用量下 D1 够用，而绑定的接入成本与部署变更不划算」。
3. 令牌查询那次读本来就要做，**计数与 `last_used_at` 合并成同一条 `UPDATE`**，于是常态下一次调用只多 1 行写，而不是「读 + 另写一次计数器 + 再写一次 last_used」。

**实现**：`api_tokens` 加两列 `rate_window_start INTEGER`、`rate_call_count INTEGER NOT NULL DEFAULT 0`。

```
窗口内：UPDATE api_tokens SET rate_call_count = rate_call_count + 1,
                          last_used_at = ?
       WHERE id = ? AND rate_window_start = ?
若 changes = 0（别的请求已经推过窗口）→ 重读该行，最多重试 1 次，仍失败就按「超限」处理
窗口外：UPDATE api_tokens SET rate_window_start = ?, rate_call_count = 1, last_used_at = ?
       WHERE id = ?
```

用条件自增而不是「读出来算好再写回去」，是为了并发下不多放行。**已知余量**：两个请求在同一毫秒跨窗口时，第二个可能把计数从 1 覆盖成 1，理论上同一窗口最多多放行 1 次。可接受——这是个人用量下的限速，不是安全边界（真正的边界是令牌哈希 + 权限位 + 范围）。

**【批 2 落地补记】`last_used_at` 的 10 分钟节流刻意不做**（定稿 §17.3 有这一条）。选了 D1 计数之后，每次调用**本来就要写令牌这一行**，`last_used_at` 顺带刷新并不额外花什么，反而比分两次写更省——那条节流到这里已经没有可省之物。在热路径上留一个"每 10 分钟才准写"的判断只会让人以为它不生效。**结果是 `last_used_at` 比定稿更准，不是更松。**

**每日维护**：`rate_window_start` / `rate_call_count` 不需要清理（列在令牌行上，令牌撤销后自然不再更新）。`audit_log` 90 天、`mcp_operations` 7 天，沿用现有每日维护的第 6 步（把 `mcp_idempotency` 改成 `mcp_operations`）。

---

## 四、可见性与范围过滤

### 4.1 两条不变式（架构 §十一，逐字照抄）

- **I1**：MCP 可见集合 ＝ 令牌范围 ∩ 非隐私内容 ∩（Memo 需令牌勾选「包含 Memo」）∩ 非回收站，**与隐私锁是否解锁无关**。
- **I2**：**界面矩阵与 MCP 矩阵互不联动** —— 改隐私范围配置不动令牌，改令牌不动范围。

### 4.2 范围 SQL 片段

每条查询固定拼上（别名 `i`）：

```sql
i.user_id = ?            -- 隔离：令牌只能访问所属用户的内容，owner 也不例外
AND i.deleted_at IS NULL                     -- 回收站不可见
AND <PRIVACY_EXCLUDE_SQL>                    -- enc_self = 0 AND in_enc_space = 0
```

其中 `PRIVACY_EXCLUDE_SQL` 直接引用 `db/privacy.ts` 的那一个字面量（**不重写**，那边有断言测试防漂移）。

`folder_scope IS NULL` 时不加片段；否则按架构 §十一 给定的那段（文件夹最多两层，需求 §4.5）：

```sql
AND i.folder_id IN (SELECT id FROM folders
                     WHERE user_id = ?
                       AND (id IN (SELECT value FROM json_each(?))
                            OR parent_id IN (SELECT value FROM json_each(?))))
```

`include_memos = 0` 时追加 `AND i.type <> 'memo'`。**Memo 恒 `folder_id IS NULL`**（建表 CHECK 保证），所以限定文件夹的令牌本来也看不到 Memo——两条规则叠加不冲突。

### 4.3 计数口径

`list_folders` 返回的**条目数不含隐私内容**，且**加密空间节点不出现在文件夹树里**（`list_folders` 不返回该节点）。这与界面侧「统计计数一律计入全部内容」**相反**，两套口径互不影响、不可互相推导（《隐私锁设计 v1.3》I4 / §4.7）。

于是有两条容易写错的推论，实现时按此写测试：

- 标签使用次数**同样只数可见条目**（它出现在 `list_folders` 的返回里，与条目数同口径）。
- 根目录的条目在 `list_folders` 里**没有归属节点**——文件夹树只给文件夹的计数，根目录条目不进任何节点的计数。要查根目录条目用 `list_items(folder_id = null)`。

---

## 五、协议层

### 5.1 端点与中间件

| 端点 | 方法 | 中间件 |
|---|---|---|
| `/mcp` | POST | `securityHeaders` + `schemaGuard`（要读新表） |
| `/mcp/k/:token` | POST | 同上 |
| `/mcp` | GET | 直接 405（无 SSE，设计 §17.1） |

**刻意不挂**：`csrfGuard`（MCP 不用 Cookie 鉴权，没有 CSRF 面）、`requireSession`（令牌鉴权走 §3）、`configGuard`（**不需要 `AUTH_PEPPER`**：令牌是高熵随机串，SHA-256 足够，设计 §17.3 明说「无需慢哈希」）。这让 `/mcp` 成为本项目**唯一一个不受"缺机密就 503"约束**的服务端路径——是有意的，不是遗漏。

`/mcp*` 不在 `app.use("/api/*")` 的覆盖范围内，中间件在 `routes/mcp.ts` 内部挂——入口文件保持只装配。

**【批 2 落地补记】两处容易踩的部署与挂载细节**：

1. **`wrangler.jsonc` 的 `assets.run_worker_first` 必须加上 `/mcp` 与 `/mcp/*`**。否则 Static Assets 的 SPA 回退会把 POST 吃掉，客户端拿到的是一份 HTML——**失败方式极隐蔽**（HTTP 200 + HTML），排查时极易误判成鉴权或协议问题。
2. **子应用内部路径是相对的**。`app.route("/mcp", mcp)` 之下再写 `/mcp` 就是 `/mcp/mcp`；正确写法是 `/` 与 `/k/:token`。

### 5.2 JSON-RPC

无状态：每个 POST 携带一个 JSON-RPC 消息，`application/json` 返回。

| 方法 | 处理 |
|---|---|
| `initialize` | 回 `protocolVersion`、`capabilities: { tools: { listChanged: false } }`、`serverInfo` |
| `notifications/initialized` | **202 Accepted，空体**（通知无 id，不回 result） |
| `ping` | `result: {}` |
| `tools/list` | 11 个工具的 name / description / inputSchema |
| `tools/call` | `result: { content: [{ type: "text", text }], isError? }` |

**`isError` 的用法**（设计 §17.4）：业务失败（版本冲突、越权、过大、不在范围内）一律 `isError: true` + 人话说明，**不用 JSON-RPC error**。JSON-RPC error 只留给协议层问题：未知方法 `-32601`、参数结构错 `-32602`、内部错误 `-32603`、令牌无效 `-32001`、限速 `-32029`。限速另带 **HTTP 429**，方便客户端一眼看出该退避。

工具结果的文本载荷统一是 `JSON.stringify(结果对象, null, 2)`——MCP 的 `content` 只有 text 通道，给 agent 结构化 JSON 比拼字符串好解析。

### 5.3 Schema 是静态常量

`registry.ts` 里 `TOOL_DEFINITIONS` 是一份**构建期写死的常量**（架构 §十一「运行时不做 schema 编译」）。入参校验用 `@menote/shared` 的 valibot schema，**校验与 JSON Schema 两份要同源**：schema 定义放 `shared/src/mcp.ts`，注册表只引用不重抄，测试里断言「11 个工具的 inputSchema 的 required 字段与 valibot 解析结果对得上」。

---

## 六、11 个工具

### 6.1 通用约定

| 约定 | 值 | 依据 |
|---|---|---|
| 权限位 | 只读 1 / 新建和追加 2 / 修改和移动 4 / 移到回收站 8 | DDL 注释 |
| 单次读正文 | 默认 8000 字符，上限 20000，超出给 `next_cursor` | 设计 §17.4 |
| 列表 / 搜索 | 每页最多 50 条 | 同上 |
| 搜索片段 | 每条不超过 200 字符 | 同上 |
| 单次写入 | 不超过 256 KB | 同上 |
| 小节解析门槛 | 512 KB（表格 256 KB） | 同上 |
| 写前封存 | 同一条目 10 分钟内最多一次 | 同上 |
| 追加的条件重试 | 同一请求内最多 1 次 | 架构 §十一 |

**512 KB 门槛的处理方式**：小节解析（`read_item(section)` / `replace_section` / `append_to_item(section)`）需要把正文取回 Worker，条目超过 512 KB 就只给区间 / 游标读取，返回「条目过大，请在应用中编辑」。`edit_item` 的 `replace_text` 对 ≤512 KB 在 Worker 里做、>512 KB 交给 SQL（`instr()` + `replace()` 同一条件里校验「恰好出现一次」）。`replace_all` / `merge_properties` / `restore_version` / 表格按行工具一律受门槛约束。

**【待核实】已实测（批 3，2026-10-03）** 架构 §十一 挂着一条：512 KB 的小节解析在 10 ms CPU 内的实际耗时，「开发早期实测，必要时下调门槛」。`apps/worker/test/mcp-read.test.ts` 里那条用例真跑了一份 **390,040 字节**（13 万汉字）的中文正文调 `read_item(section)`，**解析 + 整个 HTTP 往返 20 ms**（含 workerd 调度与 D1 往返，纯解析只占其中一部分）。**结论：512 KB 门槛不动**——离 10 ms CPU 预算还有明显余量。门槛的实际作用是**防止正文被取回内存**（2 MB 上限的条目取回来会吃掉可观的 CPU 与内存），不是 CPU 已经不够用。

### 6.2 只读 5 个

| # | 工具 | 实现要点 |
|---|---|---|
| 1 | `search` | 复用 `services/search.ts` 的 `buildSearchSql`，**只加两个可选参数**（`snippetChars` / `snippetLead`，MCP 传 200 / 80，界面兜底路径维持现在的 120 / 40）。新增游标：`(updated_at, id)` 降序，`WHERE updated_at < ? OR (updated_at = ? AND id < ?)`。`folder_id?` 要过 §4.2 范围片段 |
| 2 | `list_folders` | 一次查询拿文件夹 + 各自可见条目数（`GROUP BY folder_id`），一次拿标签 + 使用次数（从 `items.tags` 的 JSON 数组文本展开）。**过滤掉 `is_enc_space = 1` 的行**，计数走 §4.3 口径 |
| 3 | `list_items` | 只返回元数据（不碰 `item_bodies`），筛选项 `folder_id / type / tag / task_status / updated_after` + 游标 |
| 4 | `read_item` | 四种模式：①区间读 `substr(body, ?, ?)` ②小节读（≤512 KB，走 §6.2-5）③游标续读 ④`version_id` 读历史版本（走 `getVersionBody`，归属校验在它里面） |
| 5 | `list_versions` | 直接复用 `services/versions.ts` 的 `listVersions`（默认 50、上限 200、游标是 `created_at`） |

**`read_item` 的游标**：字符偏移，`base64url(JSON.stringify({ o: <offset> }))`。用字符不用字节——SQLite 的 `substr()` 对 TEXT 按字符算，字节偏移会切坏多字节字符。

**小节切分放 `packages/mdcore/src/section.ts`**（新，纯函数）：

```ts
findSectionRange(markdown: string, heading: string): { start: number; end: number } | null
```

- ATX 标题（`#` ~ `######`），去掉井号与首尾空白后**精确匹配**。
- 范围 = 标题行行首 → **下一个同级或更高级标题**的行首（没有则到文末）。
- 同名标题多处，取**第一个**，并在结果里带 `ambiguous: true`——让 agent 知道它可能拿错了小节。
- 前置的 front matter 不算小节；`findSectionRange` 收整个 markdown，内部先 `stripFrontmatter` 再定位，偏移换算回原串。

放 mdcore 而不是 worker 本地：它是纯函数、与既有 `frontmatter.ts` / `table.ts` 同一性质，且前端将来做「跳到小节」能直接复用。`mdcore` 已有 `table.test.ts` 那样的单测套路，照着写 `section.test.ts`。

### 6.3 写类 6 个

| # | 工具 | 权限 | 关键行为 |
|---|---|---|---|
| 6 | `create_item` | 新建和追加 | 笔记 / 表格 / Memo（`type` 必给）。`folder_id` 必须在令牌范围内（不自动建文件夹）。`content` 必填。**服务端算 `content_hash`**——见下方偏离说明 |
| 7 | `append_to_item` | 新建和追加 | 笔记：`body = body \|\| ?`（任意大小，SQL 拼接，不取回 Worker）。带 `section` 时先切小节再拼（≤512 KB）。表格：按列名给值的若干行，服务端用 mdcore `makeRowId` 分配行 ID（表格 ≤256 KB） |
| 8 | `edit_item` | 修改和移动 | 5 个 `mode`：`replace_text`（唯一精确替换，出现 ≠1 次即报错）/ `replace_section` / `replace_all` / `merge_properties`（走 mdcore `updateMenoteKeys`）/ `restore_version`。必带 `expected_rev`；冲突默认报错（带当前 `rev`），`on_conflict: "copy"` 生成冲突副本 |
| 9 | `edit_table_rows` | 修改和移动 | 按行 ID 更新 / 删除（`updates` / `deletes`）。走 mdcore `parseTableDocument` + `renderTableDocument`（表格 ≤256 KB） |
| 10 | `organize_item` | 修改和移动 | 移动 / 改标题 / 增删标签 / 置顶收藏。带 `expected_meta_rev` |
| 11 | `trash_item` | 移到回收站 | 带 `expected_rev`。复用 `softDeleteItem`——它**顺带撤销该条目的分享**（M6 批 1 刚补的），对 MCP 一样成立 |

**一处刻意偏离：「服务端不重算 `content_hash`」**。`services/items.ts` 的注释写明同步路径刻意不重算（省大文档上的一次 SHA-256）。但 **MCP 必须自己算**——它就是那个「客户端」，没有别人替它算，`operation_id` 幂等与 `saveItemBody` 的重放判定都依赖哈希准确。代价是每次写入多一次 SHA-256（WebCrypto，10 ms CPU 预算内可接受）。`create_item` / `append_to_item` / `edit_item` 三条写路径都算。

### 6.4 幂等（设计 §17.4）

- `create_item` / `append_to_item` / `trash_item` **必须**带 `operation_id`；`edit_item` / `edit_table_rows` / `organize_item` 可选（乐观锁已经保证重试安全）。
- 记 7 天：`mcp_operations (user_id, operation_id)` 主键，`request_hash` = 参数摘要（不含 `operation_id` 自身），`response` = 结果摘要（`id` / `rev` 等，**不存正文**）。
- 重复调用 → 直接返回第一次的结果；同一 ID 配不同参数 → 报错（`request_hash` 不匹配）。

**冲突路径的顺序问题**（`trash_item` 带 `expected_rev` 就能冲突，这是个真坑）：

1. 读 `mcp_operations` → 命中且 `request_hash` 相同 → 直接返回存的结果；`request_hash` 不同 → 报错。
2. 预检读（条目存在 / `rev` / `meta_rev` / 范围）→ 冲突则**直接返回冲突，一行都不写**（包括不写幂等行——否则 agent 重新读取后用同一个 `operation_id` 重试，会永远拿回那次冲突）。
3. 通过预检 → 一个 batch：主写入 + 审计行 + 幂等行。
4. 极小竞态（预检通过后被别人抢先）→ 主写入 `changes = 0` → **补一个小 batch：删掉刚写的幂等行 + 记一条 `conflict` 审计**，然后返回冲突。

### 6.5 写前封存（设计 §17.4 + M17-04）

改动 / 替换正文**之前**，把当前稿封成一条 `reason = 'pre_mcp'` 的版本（`VersionReason` 里已有这个枚举值，**至今没有生产调用方**，本批是第一个）。

| 决策 | 值 | 理由 |
|---|---|---|
| `keep` | **1** | M17-04 的产品承诺是「用户可在版本历史中看到原因为『AI 修改前』的版本并撤回」。`keep = 0` 的版本会被稀疏化策略删掉，承诺就不成立 |
| 节流 | 同一条目 10 分钟内最多一次 | 控制 `keep = 1` 版本的增长（它们不参与稀疏化，会一直占着每篇 50 / 总量 2000 的额度） |
| 压缩 | ≤256 KB 走 gzip，超过 `codec = 'none'` | `sealVersion` 已经有这个规则，Worker 只转存不处理（设计 §17.4） |
| 位置 | 独立文件 `services/mcp/seal.ts` | 照 `version-session.ts` 的先例——「封存语义」在 `versions.ts`，「什么时候自动触发」单独一份 |

10 分钟节流的判定：读 `items` 的 `last_edit_at` 与最近一条 `pre_mcp` 版本的 `created_at`，任一超出 10 分钟就封。**去重交给 `sealVersion`**（内容没变就不新增行），所以判定只需看时间，不必自己记状态。

### 6.6 可见性在每个工具上的落点

| 工具 | 范围检查怎么做 |
|---|---|
| `search` / `list_items` / `list_folders` | 只在 SQL 里加 §4.2 片段 |
| `read_item` / `list_versions` | 按 `id` 查时 WHERE 带 §4.2 全部条件（查不到 = 不可见，与「不存在」返回同一个 404 形状，不泄露存在性） |
| `create_item` | `folder_id` 必须在范围内；不在范围内 = 拒绝 |
| `append_to_item` / `edit_item` / `edit_table_rows` / `organize_item` / `trash_item` | 条目先按 §4.2 查出来（查不到 = 不可见）；`organize_item` 的**目标文件夹**也要在范围内（设计 §17.3：不能把内容移出或移入范围） |

### 6.7 与令牌权限无关的硬性限制（设计 §17.3 原文逐条）

1. 隐私内容不可见，且其条目数**也不计入** MCP 返回的计数。
2. **永久删除不开放**。
3. **分享不开放**。
4. **附件上传不开放**。
5. **设置修改不开放**。
6. **备份操作不开放**。

第 3~6 条不是「没实现」，是**结构上不可能**：11 个工具里没有任何一个能触及 `shares` / `attachments` / `user_settings` / 备份目标这些表。加一条测试断言「注册表里出现的每个工具名都在这 11 个之内」，比逐条写禁止逻辑更可靠。

### 6.8 MCP 不能碰的两个隐私动作（§1.2 的展开）

`organize_item` 与 `patchItemMeta` 共用一份校验，但 **MCP 侧先做减法**：

- `folder_id` **不能是加密空间行**（`is_enc_space = 1`）——移入 / 移出加密空间是隐私动作，不是「修改和移动」。
- 不提供置 `enc_self` 的参数。
- 不提供改 `type` 的参数（`table → note` 降级是逃生出口，属界面操作）。

理由：MCP 看不见加密内容，那它**同样不该有能力改变内容的加密归属**。否则一个被诱导的 agent 可以把别人的笔记塞进加密空间，让用户在界面上再也找不到。

---

## 七、审计

| 项 | 设计 |
|---|---|
| 记什么 | **只记写类工具的调用**（6 个），含 `ok` / `conflict` / `denied` / `error` 四种结果 |
| 不记什么 | 5 个只读工具（DDL 注释「仅记录写操作」）。`denied` 之所以值得记，是因为它正是「agent 越权尝试」的证据 |
| 字段 | `id / user_id / token_id / tool / item_id / rev_before / rev_after / result / operation_id / at`（照 DDL） |
| 与写入的关系 | 同一个 `db.batch`（架构 §十一） |
| 保留 | 90 天，每日维护第 6 步清理（现有代码已经在做，只差表名） |
| 查看 | 令牌详情页，分页游标 = `at DESC, id` 兜底排序 |

**实现约束**：要让审计与写入同批，就得给四个既有写函数加一个**可选的尾随语句参数**（`saveItemBody` / `createItem` / `patchItemMeta` / `softDeleteItem` 各加一个 `extra?: D1PreparedStatement[]`，默认空数组 = 行为完全不变）。这是本设计对既有热路径**唯一**的侵入，改动必须是最小的纯附加。批 3 实现时逐个核对「不传 extra 时的 SQL 与返回值和今天一致」。

**【批 3 落地补记】幂等的第 4 步不是理论上的**。写函数的口径是「先跑 batch、再看 `changes`」，所以**主写入没成时，同批的幂等行已经落库了**。不清理的话，agent 重新读取后用同一个 `operation_id` 重试会永远拿回那次失败。三个写工具因此都接了 `onLostWriteRace`（删幂等行 + 记一条 `conflict` 审计），而**预检阶段的冲突则一行都不写**（包括不写幂等行），两条路径的区别就是「有没有真的跑过 batch」。

**【批 3 落地补记】参数摘要不能用 `JSON.stringify(args, Object.keys(args))`**。把键数组当 replacer 会**同时过滤嵌套对象的键**——`{ properties: { tags: [...] } }` 里的 `tags` 会被悄悄丢掉，于是两个语义不同的请求算出同一个摘要，幂等误判成"重放"。改成自己写的 `canonicalJson`（每层键排序、丢 `undefined`、数组保序），并用一条「字段书写顺序换了不算另一组参数」的用例钉住。

---

## 八、测试策略

| 层 | 覆盖 |
|---|---|
| `packages/mdcore/test/section.test.ts` | 小节切分：同级 / 更高级标题、同名歧义、front matter 偏移、无匹配、CRLF |
| `packages/shared/test/mcp.test.ts` | 11 个工具入参的 valibot 校验；权限位掩码边界（bit 0 恒 1） |
| `apps/worker`（走真实端点，不打桩 DB） | 令牌 CRUD 与上限 20；哈希域隔离（**拿会话令牌当 MCP 令牌必须被拒**）；撤销 / 过期立即生效；限速窗口与重置；`/mcp/k` 受 `allow_url` 约束；`GET /mcp` = 405；越权读 / 写（范围外、加密、空间、回收站）；乐观锁冲突与 `on_conflict: copy`；幂等重放与同 ID 异参报错；冲突路径幂等行被删；审计四态都写；大条目门槛拒绝 |
| `apps/web` | 设置 › MCP：创建弹窗校验、一次性令牌展示与复制、列表与撤销、审计详情、达上限时置灰 |

**必须有的两条往返用例**（上一轮分享 P0 的教训）：①令牌在 URL 方式与请求头方式下鉴权结果**完全一致**；②`create_item` 拿到 `rev` → 改内容 → 带对 `expected_rev` 成功 → 带旧 `rev` 失败。**单侧 mock 会把这类 bug 全盖住**。

---

## 九、四批的切分

| 批 | 内容 | 版本 | 验收点 |
|---|---|---|---|
| **批 1** | 迁移 `0006_mcp` + `db/mcp-tables.ts` + `services/mcp/tokens.ts` + 4 个令牌接口 + 修 `maintenance.ts` 表名 | v0.6.23 | 令牌 CRUD 全通；上限 20；撤销 / 过期立即生效；哈希域隔离用例通过 |
| **批 2** | `routes/mcp.ts` + `jsonrpc.ts` + `registry.ts` + `scope.ts` + 只读 5 工具（含 `mdcore/section.ts`） | v0.6.24 | `tools/list` 出 11 个（写类此时返回权限拒绝）；5 个只读工具用真实令牌跑通；越权读全被拒 |
| **批 3** | 写类 6 工具 + `audit.ts` + 写前封存 + 四个写函数的 `extra` 参数 | v0.6.25 | 乐观锁 / 幂等 / 封存 / 审计四态全通；512 KB 门槛实测并登记耗时 |
| **批 4** | 设置 › MCP 界面：**先出稿 → 用户确认 → 再写码** | v0.6.26 | 导航 11 类；创建 / 列表 / 撤销 / 审计详情可用 |

批 4 是一次性出稿（令牌列表 + 创建弹窗 + 审计详情三块一起），按用户 2026-10-03 的决定，稿放在后端全做完之后。

**M6 收口时**才 +0.1 到 **v0.7.0**（版本号规范：里程碑收口时才动次版本号）。开发期只 +0.0.1。

---

## 十、风险

| 风险 | 处置 |
|---|---|
| 大条目解析超 CPU | 512 KB 门槛 + 批 3 实测；超了下调常量并登记 |
| 限速写入放大 D1 写次数 | 计数与 `last_used_at` 合并成一条 `UPDATE`；令牌被代理高频调用时才吃满，个人量级远低于免费版 10 万行/天 |
| `keep = 1` 的 `pre_mcp` 版本持续增长 | 10 分钟节流；观察一段时间，若挤占保留额度再议「`pre_mcp` 走独立的稀疏化规则」 |
| 对既有四个写函数加 `extra` 参数引入回归 | 参数可选、默认空；批 3 逐个核对不传时的 SQL 与返回值；worker 现有 246 条用例全量跑 |
| `db/mcp-tables.ts` 与 `db/tables.ts` 两处 SQL 常量 | 注释互相指路；不合并（合并必然越 500 行） |

---

## 十一、未决与后置

| 项 | 状态 |
|---|---|
| 令牌改期 / 改权限 / 改范围（`PATCH /api/mcp/tokens/:id`） | 定稿只要求「随时撤销」。**本批不做**，理由：改权限等于让已发出去的凭据权限变大，撤销重建更清楚 |
| **`edit_item` 的 `replace_text` 在 >512 KB 条目上走 SQL** | 设计 §17.4 说「更大的条目在 SQL 中完成，用 `instr()` 与 `replace()` 在同一条件中校验待替换文本恰好出现一次」。**批 3 未实现这条路径**，统一按「超过 512 KB 就拒绝并提示改用区间 / 游标」处理。补它的收益是让超大条目也能精确替换，成本是一条要仔细写对的 SQL + 它自己的用例；记在这里，留给真正有大文件编辑需求的场景 |
| 令牌有效期到期后的自动清理 | 复用现有每日维护的「回收站到期」之外的独立步骤？本批**不做**——过期令牌在鉴权第一步就被拒，留行只影响列表展示 |
| `export_queue` / `backup_targets` / `backup_state` 三表 | M16 定时备份，本批不建 |
| 令牌用量的可视化（调用次数趋势） | 定稿没有，先不做 |
| `restore_version` 复用 `services/versions.ts:restoreVersion` | 该函数内部没有 `expected_rev` 守卫（它直接 `rev + 1`）。MCP 侧**在调用前自己判 `expected_rev`**，不改动那个函数 |

---

## 十二、回写清单（本批做完要更新的定稿）

- `wiki/Menote-项目架构-v1.md` §十一：补 §3.5 的限速落地方式（偏离定稿处必须回写，否则下次有人照字面加绑定）、文件落点表 §2.3.2 补 MCP 各文件与 `GET /api/attachments`（M6 批 2c 遗留）。
- `wiki/Menote-设计文档-v7.4.md` §十七：补实际门槛实测值。
- `wiki/Menote-功能拆解-v2.md` M17-01/02/04：登记落地位置与「令牌编辑后置」。
- `wiki/components.md`：设置 › MCP 的组件与空态。

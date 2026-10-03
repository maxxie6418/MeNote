# Menote M6 MCP 实施计划（功能拆解 M17）

| 项 | 值 |
|---|---|
| 文档版本 | v1.3 |
| 文档状态 | 执行中（**批 1、2、3 已落地**，v0.6.23 / v0.6.24 / v0.6.25） |
| 目的和适用范围 | 拆步、涉及文件与验收点。设计口径以那份专项设计为准，本文件只管怎么落地 |
| 权威级别 | 临时规则（M6 第三块的执行清单） |
| 最后更新日期 | 2026-10-03 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.6.22 | 2026-10-03 | 初稿。依据《M6 MCP 设计》v1 拆步，切 4 批 | MiniMax-M3.1-Flash-Preview |
| v1.1 | v0.6.23 | 2026-10-03 | 回填进度：**批 1（步 1.1–1.9）已落地**，用例 +15。记三处实施中才浮现的事实：①**又抓到一个同类死代码**——`maintenance.ts` 里 `audit_log` 那段清理也是从未执行过的（表没建），而它**把时间列 `at` 写成了 `created_at`**，建表之后第一次真跑就抛 `no such column`；原先只诊断出 `mcp_idempotency` 表名那处，**这一处更严重**（每日维护会天天崩），是被新写的用例当场抓住的（步 1.8 因此新增一条"两段清理都真会执行"的用例，造过期行并断言真的被删）。②令牌服务按设计 §2.1 的落点表**拆成 `tokens.ts`（管理侧）与 `auth.ts`（调用侧，批 2）**——原稿把"生成/鉴权/限速/建/列/撤销/审计分页"都塞进一个 180 行的文件，实际落地装不下，拆开也对得上 `services/shares.ts`（管理侧）与 `services/share-public.ts`（访客侧）那条既有分法。③测试用的第二个账号名不能用中文：用户名 schema 只允许 `[A-Za-z0-9_.-]`，写「家人」注册直接被拒（首轮用例 14 条里 2 条因此挂掉） | MiniMax-M3.1-Flash-Preview |
| v1.2 | v0.6.24 | 2026-10-03 | 回填进度：**批 2（步 2.1–2.9）已落地**，用例 +23（worker 261→284）另加 mdcore 14 条（65→79）。记四处实施中才浮现的事实：①**`/mcp` 端点必须加进 `wrangler.jsonc` 的 `run_worker_first`**，否则 Static Assets 的 SPA 回退会把 POST 吃掉、客户端拿到一份 HTML——失败方式极隐蔽（HTTP 200 + HTML），排查时容易误判成鉴权或协议问题。②**子应用内部路径是相对的**：`app.route("/mcp", mcp)` 之下再写 `/mcp` 就是 `/mcp/mcp`，首轮 23 条用例全 404 才发现。③**`replaceSection` 原本会吃掉节间空行**（`end` 是下一标题的行首，节尾空行归本节），替换后正文与下一个标题粘成 `new## 乙`——静默的正文损坏，被 mdcore 单测当场抓出；已改成把 `end` 往前收过尾随换行。④`scanHeadings` 原先不剥 CRLF 的 `\r`，正则认不出标题，**CRLF 文档的小节读取会静默失效**。另有两处**偏离定稿的自觉决定**：`last_used_at` 的「最多每 10 分钟写一次」节流**刻意不做**（选了 D1 计数后每次调用本来就要写令牌行，顺带刷新并不额外花钱，那条节流已无可省之物，删掉比留个不生效的判断更清楚）；**MCP 端点不挂 `configGuard`**，因为令牌是高熵随机串、SHA-256 足够，不需要 `AUTH_PEPPER` | MiniMax-M3.1-Flash-Preview |
| v1.3 | v0.6.25 | 2026-10-03 | 回填进度：**批 3（步 3.1–3.13）已落地**，用例 +30（worker 284→314）。记五处：①**参数摘要不能用 `JSON.stringify(args, keys)`**——把键数组当 replacer 会**同时过滤嵌套对象的键**（`properties.tags` 会被悄悄丢掉，于是两个不同的请求算出同一个摘要，幂等误判成重放）；改成自己写的 `canonicalJson`（每层排序、丢 `undefined`、数组保序），并加了一条"字段书写顺序换了不算另一组参数"的用例钉住。②**幂等的第 4 步真的会被触发**：写函数是"先跑 batch 再看 `changes`"，所以**主写入没成时同批的幂等行已经落库了**——不清理的话 agent 用同一个 `operation_id` 重试会永远拿回那次失败。三个写工具都补了 `onLostWriteRace`（删幂等行 + 记 conflict 审计）。③**`organize_item` 的成功路径一开始漏了审计**（`patchItemMeta` 没传 `extra`），被"审计只记写类调用"那条用例当场抓住。④**测试里的表格要用 mdcore 自己的 `renderTableDocument` 造**，手写 YAML 会漏 `columns` 定义，解析器直接判"不是 table 类型"。⑤**`replace_text` 的 >512 KB SQL 路径本批未实现**，统一按"超门槛就拒绝并提示改用区间/游标"处理，已在设计稿 §十一 登记为已知未实现项 | MiniMax-M3.1-Flash-Preview |

---

## 目标

把 Menote 开放给外部 agent：**用户自建令牌 → 交给任意第三方客户端 → 客户端能读能写**。

做完之后的可验证结果：一个真实令牌通过 `POST /mcp` 完成 `tools/list`（出 11 个工具）、5 个只读工具可用、6 个写类工具在乐观锁与幂等下正确写入并在版本历史留下「AI 修改前」、设置 › MCP 能建令牌与查审计。

## 切批总览

| 批 | 内容 | 版本 | 可验证的落点 |
|---|---|---|---|
| 1 | 迁移 + 令牌服务 + 4 个令牌接口 | v0.6.23 | 界面没做也能用接口建令牌、看列表、撤销 |
| 2 | MCP 端点 + 协议层 + 只读 5 工具 | v0.6.24 | 真实令牌能连、能读；写类工具被权限位挡住 |
| 3 | 写类 6 工具 + 封存 + 审计 + 幂等 | v0.6.25 | agent 能写、能撤回、能查审计 |
| 4 | 设置 › MCP 界面（先出稿 → 确认 → 码） | v0.6.26 | 用户不用碰命令行就能建令牌 |

**M6 收口时才 +0.1 到 v0.7.0**，开发期只 +0.0.1。

每步结束都是一次可提交、可推送的落点（AGENTS.md「每完成一个关键阶段就即时提交并推送」）。提交前跑 `pnpm lint` / `pnpm typecheck` / `pnpm test`。

---

## 批 1 · 数据层与令牌

| 步 | 做什么 | 涉及文件 |
|---|---|---|
| 1.1 | 迁移 `0006_mcp`：照抄《设计文档》§DDL MCP 段三张表 + 5 个索引（语句单行、`IF NOT EXISTS`），**外加** `api_tokens` 的 `rate_window_start` / `rate_call_count` 两列 | `apps/worker/src/db/migrations/0006_mcp.ts`、`db/selfheal.ts`（完整性校验加三张表） |
| 1.2 | MCP 专用 SQL 常量（令牌 CRUD、审计读写、幂等读写删、范围查询、计数查询） | `apps/worker/src/db/mcp-tables.ts`（新建） |
| 1.3 | 令牌原语：生成 `mn_` + 32 字节、`SHA-256(整串)` 存哈希、`token_prefix`；**前缀不符直接拒**（不进哈希） | `apps/worker/src/services/mcp/tokens.ts` |
| 1.4 | 4 个接口的 valibot schema（名称、权限位掩码含「bit 0 恒 1」归一化、`folder_scope` 逐个校验归属与非加密空间、`rate_per_min` 1~600、有效期四档） | `packages/shared/src/mcp.ts`（新建） |
| 1.5 | 令牌服务：建（含**上限 20** 有效令牌）、列、撤销、审计分页；创建时返回完整令牌一次 | `apps/worker/src/services/mcp/tokens.ts` |
| 1.6 | 4 个会话接口（`requireSession` + CSRF 自动生效，因为挂在 `/api` 下） | `apps/worker/src/routes/mcp-tokens.ts`（新建） |
| 1.7 | 修 `maintenance.ts` 两段死代码：`mcp_idempotency` → `mcp_operations`；`audit_log` 的 `created_at` → `at` | `apps/worker/src/jobs/maintenance.ts` |
| 1.8 | 用例：CRUD；上限 20（21st 返回 409）；撤销 / 过期立即生效；`folder_scope` 越权与加密空间被拒；**哈希域隔离**；创建响应含完整令牌、列表响应不含；审计同毫秒分页不漏；**两段清理真会执行** | `apps/worker/test/mcp-tokens.test.ts`、`apps/worker/test/jobs.test.ts`（新建 / 改） |
| 1.9 | 入口装配加两行 `app.route` | `apps/worker/src/index.ts` |

**批 1 验收点**（✅ 2026-10-03 全达成）

- [x] `POST /api/mcp/tokens` 建出令牌，响应里有 `mn_` 开头的完整串；`GET` 同一令牌只有 `token_prefix`
- [x] 第 21 个有效令牌被拒（409）；撤销一个后可再建
- [x] 撤销立即生效且幂等；过期令牌**不占额度**（否则攒一堆就再也建不了新的）
- [x] 拿一个真实会话令牌当 MCP 令牌用 → 连哈希都不算（`hashMcpToken` 返回 null）
- [x] `folder_scope` 填别人家文件夹 / 加密空间行 → 422
- [x] 审计分页在同一毫秒落两行时不漏行
- [x] 每日维护的两段清理**真会执行**（这一步抓出 `audit_log` 的列名 bug）
- [x] `pnpm test` 全绿：worker 246 → **261**（+15），web 1219 / shared 101 / mdcore 65 无回归；typecheck 4 包 0 error；lint 0 error + 1 条既有 warning

---

## 批 2 · 端点、协议层与只读工具

| 步 | 做什么 | 涉及文件 |
|---|---|---|
| 2.1 | 鉴权与处理顺序：取令牌 → 撤销 → 过期 → 限速 → 权限位 → 范围 → 执行。限速按设计 §3.5 的条件自增 + 最多 1 次重试 | `apps/worker/src/services/mcp/auth.ts`（新建） |
| 2.2 | 范围过滤：I1 四个条件的 SQL 片段、`PRIVACY_EXCLUDE_SQL` 引用（**不重写**）、文件夹两层的 `json_each` 子查询、`include_memos = 0` 排除 Memo | `apps/worker/src/services/mcp/scope.ts`（新建） |
| 2.3 | JSON-RPC 分发：`initialize` / `notifications/initialized`（**202 空体**）/ `ping` / `tools/list` / `tools/call`；业务失败走 `isError: true`，协议错误走 `-32601 / -32602 / -32603 / -32001 / -32029`；限速另带 HTTP 429 | `apps/worker/src/services/mcp/jsonrpc.ts`（新建） |
| 2.4 | 工具注册表：name / description / inputSchema（**静态常量**）/ 权限位；只列本批已实现的 5 个只读工具，写类的先不在 `tools/list` 里出现 | `apps/worker/src/services/mcp/registry.ts`（新建） |
| 2.5 | Markdown 小节切分（纯函数，含同名歧义标记、front matter 偏移换算、CRLF） | `packages/mdcore/src/section.ts` + `test/section.test.ts`（新建） |
| 2.6 | `search`：`buildSearchSql` 加 `extraConditions` / `extraParams` / `orderBy` / `snippet` 四个可选口子（MCP 叠可见性与游标，界面兜底路径原样不动）；片段 200 / 80 | `apps/worker/src/services/search.ts`、`services/mcp/tools-read.ts`（新建） |
| 2.7 | `list_folders` / `list_items` / `read_item` / `list_versions`：含**排除加密空间节点**、计数不含隐私内容、游标为字符偏移 | `services/mcp/{tools-read,tools-read-item,parts}.ts`（新建） |
| 2.8 | 端点：`POST /mcp`、`POST /mcp/k/:token`（受 `allow_url` 约束）、`GET /mcp` = 405；挂 `securityHeaders` + `schemaGuard`，**不挂** `csrfGuard` / `requireSession` / `configGuard`；**`wrangler.jsonc` 的 `run_worker_first` 要加 `/mcp` 与 `/mcp/*`** | `apps/worker/src/routes/mcp.ts`（新建）、`index.ts`、`wrangler.jsonc` |
| 2.9 | 用例（走真实端点 + 真实令牌）：`initialize` / `tools/list` 出 5 个 / 只读 5 个各自跑通 / 写类工具报「没有这个工具」/ 范围外读与不存在**响应体逐字节相同** / 五类不可见 / `include_memos` 两种取值 / `allow_url` 关时 URL 方式 401 且勾过后两种传输一致 / `GET /mcp` 405 / 限速窗口重置 / 大条目禁小节读但区间读可用 | `apps/worker/test/mcp-read.test.ts`（新建） |

**批 2 验收点**（✅ 2026-10-03 全达成）

- [x] 真实令牌 `POST /mcp` 能完成 `initialize` → `tools/list` → `tools/call` 三步
- [x] 写类工具此时报「没有这个工具」（-32601）——不是权限不足，因为那枚令牌确实没有这个能力
- [x] 撤销 / 过期 / 令牌无效一律 401 且**三者的响应文案完全相同**（不区分原因＝防探测）
- [x] URL 方式受 `allow_url` 约束；勾过之后与请求头方式的响应**逐字节相同**（往返用例）
- [x] 限速按分钟窗口计数，超出 429 + `-32029`；把窗口推回过去即自动重置
- [x] 令牌范围外的条目 `read_item` 返回的响应体与「真的不存在」**逐字节相同**
- [x] 单篇加密 / 加密空间内 / 回收站 / 未勾 Memo —— 五类一律读不到
- [x] `list_folders` 不含加密空间节点；文件夹计数与标签计数都只算可见条目
- [x] 有界读取生效：正文 20000 字符封顶、每页 50 条封顶、超出给 `next_cursor`
- [x] 小节读取：同名小节如实报 `ambiguous`；找不到小节回 `isError` + 中文原因
- [x] 业务失败走 `isError: true`（空 query、找不到小节、不可见条目）而不是 JSON-RPC error
- [x] 跨租户：别人的条目对令牌不可见（owner 也不例外）
- [x] `pnpm test` 全绿：worker 261 → **284**（+23）、mdcore 65 → **79**（+14），web 1219 / shared 101 无回归；typecheck 4 包 0 error；lint 0 error + 1 条既有 warning

---

## 批 3 · 写类工具、封存、审计

| 步 | 做什么 | 涉及文件 |
|---|---|---|
| 3.1 | 四个既有写函数加**可选**尾随语句参数（默认空 = 行为与今天完全一致）：`saveItemBody` / `createItem` / `patchItemMeta` / `softDeleteItem` | `services/{items,item-meta,trash}.ts` |
| 3.2 | 写前封存：独立文件判「同一条目 10 分钟内最多一次」，`reason = 'pre_mcp'`、`keep = 1`，去重交给 `sealVersion` | `apps/worker/src/services/mcp/seal.ts`（新建） |
| 3.3 | 审计与幂等：写工具的结果四态（`ok` / `conflict` / `denied` / `error`）随写入同批落库；幂等记录 7 天 | `apps/worker/src/services/mcp/audit.ts`（新建） |
| 3.4 | 幂等的**冲突路径**（设计 §六-4 的四步）：预检冲突直接返回且不写幂等行；极小竞态走 `onLostWriteRace`（删幂等行 + 记 conflict 审计） | `services/mcp/write-parts.ts` |
| 3.5 | `create_item`：服务端算 `content_hash`（MCP 侧的刻意偏离）、`folder_id` 必须在范围内、不自动建文件夹 | `services/mcp/tools-write.ts`（新建） |
| 3.6 | `append_to_item`：笔记走 `body = body \|\| ?`；带 `section` 先切小节（≤512 KB，**缩回节尾换行，别吃掉分隔**）；表格按列名给值并用 mdcore `makeRowId` 分配行 ID（表格 ≤256 KB）；条件写入失败重试 1 次 | 同上 |
| 3.7 | `edit_item`：5 个 `mode`；`expected_rev` 必带；`replace_text` 要求唯一命中（≠1 次即报错）；`replace_all` / `merge_properties` / `replace_section` / `restore_version` 受门槛约束；`on_conflict: "copy"` 生成冲突副本 | `services/mcp/tools-write-edit.ts`（新建） |
| 3.8 | `edit_table_rows`：按行 ID 更新 / 删除，走 mdcore `parseTableDocument` + `renderTableDocument`；行 ID 与列名都要先校验存在 | `services/mcp/tools-write-table.ts`（新建） |
| 3.9 | `organize_item`：`expected_meta_rev`；**目标文件夹必须在范围内且不是加密空间行**；不提供置 `enc_self` 与改 `type` | `services/mcp/tools-write-edit.ts` |
| 3.10 | `trash_item`：`expected_rev` + `operation_id`；复用 `softDeleteItem`（顺带撤销分享） | `services/mcp/tools-write.ts` |
| 3.11 | 注册表把 6 个写类工具加进 `tools/list`（共 11 个） | `services/mcp/registry.ts` |
| 3.12 | 用例：乐观锁冲突与 `on_conflict: copy`；幂等重放 / 同 ID 异参报错 / **字段顺序换了不算异参**；冲突后幂等行已被删（重读一次能成功）；写前封存生成「AI 修改前」且 10 分钟内不重复；审计四态都写且与写入同批；表格行增删改；权限位逐个生效；范围外条目读不到也改不动；MCP 不能移入加密空间 | `test/mcp-write.test.ts`、`test/mcp-write-scope.test.ts`、`test/mcp-helpers.ts` |
| 3.13 | **实测 512 KB 小节解析耗时**并登记（架构 §十一 挂着一条【待核实】） | `test/mcp-read.test.ts` + 设计稿 §6.1 登记 |

**批 3 验收点**（✅ 2026-10-03 全达成）

- [x] agent 改一篇笔记 → 版本历史里出现原因为「AI 修改前」的版本（`pre_mcp` / `keep = 1`）
- [x] 带旧 `rev` 的修改被拒且报出当前 `rev`；`on_conflict: "copy"` 生成副本且**原条目零变化**
- [x] 同一个 `operation_id` 调两次结果一致；改参数再调报错；**字段书写顺序换了仍判成重放**
- [x] 冲突之后**同一个 `operation_id` 重新读再重试能成功**（预检冲突不写幂等行）
- [x] 审计四态都写；成功路径的审计与写入**在同一个 batch**（`organize_item` 一开始漏了，被用例抓住）
- [x] 权限位逐个生效：只读令牌调六个写工具全被挡，且原数据零变化
- [x] 范围外的条目写类工具同样读不到；限定范围的令牌不能把内容移出范围（含挪到根目录）
- [x] MCP 不能把内容移入加密空间；单篇加密条目完全不可见；跨租户动不了家人的条目
- [x] `tools/list` 恰好 11 个，且**每个名字都在定稿的 11 个之内**（结构上挡掉附件 / 分享 / 备份 / 设置类工具）
- [x] 512 KB 门槛实测：390,040 字节中文正文的 `read_item(section)` **解析 + 往返 20 ms** → **门槛不动**，已登记进设计稿
- [x] `pnpm test` 全绿：worker 284 → **314**（+30），web 1219 / shared 101 / mdcore 79 无回归；typecheck 4 包 0 error；lint 0 error + 1 条既有 warning
- [ ] **未实现（已登记）**：`edit_item` 的 `replace_text` 在 >512 KB 条目上走 SQL 那条路径（设计 §17.4 有、本批没做）
- [ ] `pnpm test` 全绿；`lint` 的 `max-lines` 无新增违规

---

## 批 4 · 设置 › MCP

| 步 | 做什么 |
|---|---|
| 4.1 | **先出稿**（`docs/modules/Menote-M6-MCP-设置页-设计-v1.md`）：这一屏有哪些块、主操作、空状态、令牌一次性展示的形态、审计详情的层级。**用户确认前不写界面代码、不改全局样式、不改 `DESIGN.md`** |
| 4.2 | `SETTINGS_PAGES` 加 `"mcp"`（10 → 11 类），同步 `PAGE_META` 与两处断言分类数的测试 |
| 4.3 | `features/mcp/model.ts` + `ui/`：`McpSettingsPage`、创建弹窗、审计详情 |
| 4.4 | 创建弹窗：名称、权限（只读恒含、另三位独立）、范围（文件夹多选含子文件夹 + 「包含 Memo」）、有效期、允许 URL（勾选时显风险说明） |
| 4.5 | 一次性令牌展示：完整串 + 复制；关闭后只剩 `token_prefix`。**接入说明与 MCP 地址也在这一屏**（功能拆解 M17-01【补全】条） |
| 4.6 | 达 20 个时「创建」置灰并提示；撤销二次确认 |
| 4.7 | 用例：创建校验、一次性展示、列表 / 撤销、审计分页、上限置灰、空态 |

**批 4 验收点**

- [ ] 导航 11 类，「MCP」在「分享」与「数据管理」之间
- [ ] 全程不碰命令行就能建令牌、拿到地址与接入说明
- [ ] 完整令牌只出现一次；刷新后只有前缀
- [ ] 撤销即时生效（下一屏刷新即失效）
- [ ] 空态、达上限、审计为空三种状态都有明确文案
- [ ] 对照 `DESIGN.md` §3 逐项核对过

---

## 不做（本轮之外）

定时自动备份（M16）、首页重做与「那年今日」、移动端适配、PWA 离线、上线前检查（部署指南 / 家人使用说明 / Runbook）。令牌编辑（`PATCH`）按设计 §十一 后置。

## 跨批的收尾

全部四批完成后（收口时 +0.1 → **v0.7.0**）：

1. 回写四份定稿（设计稿 §十二  列了清单）。
2. `AGENTS.md` 项目简介跟上 M6 第三块进度。
3. `docs/todo/Menote-开发计划-v1.md` 的 M6 段更新进度表。
4. 线上点验清单交给用户（设置 › MCP 逐屏 + 一次真实客户端连接）。

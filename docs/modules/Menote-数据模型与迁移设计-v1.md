# Menote 数据模型与迁移设计 v1

| 项 | 值 |
|---|---|
| 文档版本 | v1.1 |
| 文档状态 | 生效（用户确认 2026-09-26：设计稿生效、迁移机制、`app_meta` 承载实例级设置、`.gitignore` 修正、wiki 同步项 a–f 均获批准） |
| 目的和适用范围 | 解掉 M1 开工前的两个阻塞项：①新隐私模型下没有权威 DDL；②迁移机制在架构文档里有两套互相冲突的写法且首次部署会真失败。给出 M1 起可照抄建表的权威 DDL、迁移执行机制、测试策略与部署路径 |
| 权威级别 | 模块规则（数据层）。与 `wiki/Menote-项目架构-v1.md` §5.1 / §15.4 / §15.5、`wiki/Menote-设计文档-v7.4.md` §18.2 冲突时，本文只解决**已明确废弃内容**的落地口径；未废弃处一律以 wiki 为准 |
| 最后更新日期 | 2026-09-26 |

修改记录：

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型 |
|---|---|---|---|---|
| v1 | v0.1.2 | 2026-09-26 | 初稿。新隐私模型权威 DDL（重写被密文列污染的 CHECK）、运行时自愈迁移机制、首次部署路径与测试策略 | deepseek-v4.1-flash |
| v1.1 | v0.1.3 | 2026-09-26 | 状态改「生效」；据 SQLite 实测与独立复核修正（语句数 21→18、`sync_seq` 分配去掉 `RETURNING` 并记录需求 §18.3 守卫缺陷、引注改为章节号）；应用已批准决定：`app_meta` 承载实例级设置、`.gitignore` 放行 `.dev.vars.example` | deepseek-v4.1-flash |
| v1.2 | v0.2.4 | 2026-09-26 | M2-1 定死任务字段字面量：§六待确认 #1 由「待定」改「已定」——写入 `todo / doing / done` 与 `high / medium / low`（英文，与既有 YAML 键约定一致），读取兼容中文，界面文案走 `mdcore` 的 `TASK_*_LABELS`；「M2-5 补 CHECK」的约定保留 | deepseek-v4.1-flash |
| v1.3 | v0.2.11 | 2026-09-26 | **M2-5 落地约束，形式由 CHECK 改为触发器**：新增 0002 迁移（6 个幂等触发器，覆盖 INSERT/UPDATE；含「`is_task = 0` 时不得携带任务字段」一条），并纳入 `selfheal` 的完整性检查（`sqlite_master` 查 `type='trigger'`）。理由：SQLite 不支持 `ALTER TABLE ... ADD CONSTRAINT`，补 CHECK 只能重建 `items` 这张已有生产数据的热表，风险与收益不成比例；触发器幂等追加、不动表结构与数据，约束效果等价。0001 的 18 条语句不变，0002 为 6 条 | deepseek-v4.1-flash |

---

## 一、结论摘要（三条）

| # | 结论 | 依据 |
|---|---|---|
| 1 | **迁移采用运行时自愈**（架构 §15.4 的写法），**不采用** `wrangler d1 migrations apply` 进部署脚本的写法（架构 §15.5 的写法）。CLI 迁移在全新账户上会硬失败，且对主部署通道无效（§5） | 本文 §4、§5 |
| 2 | 新隐私模型下的 **DDL 权威版本在本文 §3**。需求 v7.4 §18.2 不能直接照抄：它的 `items` / `folders` / `item_bodies` 有三条 CHECK 约束引用了要删掉的密文列 | 本文 §2、§3 |
| 3 | M1 建表范围 = `app_meta` / `users` / `sessions` / `auth_throttle` / `user_settings` / `folders` / `items` / `item_bodies` 共 8 张；**墓碑（`tombstones`）与 `r2_gc_queue` 不在 M1**，理由见 §3.4 | 本文 §3.4 |

---

## 二、与需求 v7.4 §18.2 的差异（逐条，含原因）

| # | v7.4 原文 | 处理 | 原因 |
|---|---|---|---|
| 1 | `item_bodies.body_enc BLOB` + `CHECK ((body IS NULL) <> (body_enc IS NULL))` | **删列，CHECK 重写为 `body IS NOT NULL` + 字节上限** | v1.1 隐私模型：正文恒为明文（架构 §5.1 首段"正文密文列…不再使用"、§7 章首模型修订、§7.4） |
| 2 | `items.title_enc` / `items.key_id` + `CHECK ((in_enc_space = 0 AND title IS NOT NULL AND title_enc IS NULL) OR (in_enc_space = 1 AND title IS NULL AND title_enc IS NOT NULL))` | **删列，CHECK 重写**（§3.3 表） | 同上；且原 CHECK 在"加密空间内标题也是明文"后无法成立 |
| 3 | `folders.name_enc` + 三选一 CHECK | **删列，CHECK 重写**；`name` 改 `NOT NULL` | 同上（架构 §7.1：全链路明文，仅携带标记） |
| 4 | `CHECK (type <> 'memo' OR in_enc_space = 0)`、`CHECK (type <> 'memo' OR enc_self = 0)` | **原样保留** | 与新模型不冲突，Memo 不进加密空间、不打单篇加密 |
| 5 | `data_keys` 表、`user_crypto` 的密钥列（`mk_wrapped_pw` 等） | **不建**（`user_crypto` 整体不在 M1，M3 按架构 §7.2 新语义重建为 verifier + K 的两份包裹） | 架构 §5.1 首段、§7 章首 |
| 6 | `e/{uid}/{id}` R2 静态密文附件前缀 | 与 M1 无关，M4 处理 | 架构 §5.2 v1.1 注 |
| 7 | `users.auth_kdf` 举例 `{"alg":"argon2id",...}` | **改为 PBKDF2 参数**，见《认证与会话设计》 | 架构 §7.2 定 PBKDF2-SHA-256 600,000，§2.2 定 WebCrypto、无 wasm；CSP 已删 `wasm-unsafe-eval`，Argon2id-wasm 不可用 |
| 8 | `items` 表说明"不在加密空间的条目 `title` 非空"但 **Memo 没有独立标题** | 新 CHECK 写为 `type = 'memo' OR title IS NOT NULL` | 功能拆解第十一章第 5 条已点出该矛盾 |
| 9 | 架构 §5.1 的技术补充（`tombstones`、`tombstone_floor`、`r2_gc_queue`、`sync_seq` 扩展、`items.last_edit_at`/`last_device`） | **能低成本先建的列先建**（§3.4 表），**表则按里程碑分摊** | 避免 M4 再 `ALTER TABLE` 改 `items` 这类热表 |

---

## 三、权威 DDL（M1 第一条迁移 = 本文全量）

### 3.1 通用约定（照抄需求 §18.1）

- 主键 = 时间有序 **UUIDv7 / ULID**，TEXT；客户端或服务端生成。
- 所有时间 = Unix **毫秒**（UTC），INTEGER。
- 每张用户表带 `user_id`；每条查询与每个索引都以 `user_id` 起始（架构 §13.2）。
- 乐观锁：正文 `rev`、元数据 `meta_rev`、设置 `rev`；条件写为 `WHERE id=? AND user_id=? AND rev=?` 并检查影响行数。
- **不使用外键**：D1 外键需显式开启且会加重写放大；一致性由服务层 + 索引 + 测试保证（沿用 v7.4 的实际写法）。
- 正文硬上限 **1,900,000 字节** UTF-8，由 DB CHECK 兜底，客户端预拦。
- 布尔用 INTEGER 0/1（沿用 v7.4）。

### 3.2 语句清单（每条幂等；编号即执行顺序）

```sql
-- 1 实例元数据：schema_version / initialized_at / registration_open / registration_close_at / migration_lock
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 2 用户
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role            TEXT NOT NULL CHECK (role IN ('owner','member')),
  auth_salt       BLOB NOT NULL,
  auth_kdf        TEXT NOT NULL,
  auth_verifier   BLOB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  sync_seq        INTEGER NOT NULL DEFAULT 0,
  tombstone_floor INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- 3 会话：只存令牌的 SHA-256
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   BLOB PRIMARY KEY,
  user_id      TEXT NOT NULL,
  device_label TEXT,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- 4 登录失败计数：只在失败时写
CREATE TABLE IF NOT EXISTS auth_throttle (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  failures     INTEGER NOT NULL,
  locked_until INTEGER
);

-- 5 用户设置（M1 只建表；通用页在 M2）
CREATE TABLE IF NOT EXISTS user_settings (
  user_id    TEXT PRIMARY KEY,
  json       TEXT NOT NULL DEFAULT '{}',
  rev        INTEGER NOT NULL DEFAULT 1,
  sync_seq   INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- 6 文件夹（普通文件夹 depth 为 1/2；加密空间是每用户一条 depth=0 的内置记录）
CREATE TABLE IF NOT EXISTS folders (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  parent_id     TEXT,
  is_enc_space  INTEGER NOT NULL DEFAULT 0,
  in_enc_space  INTEGER NOT NULL DEFAULT 0,
  name          TEXT NOT NULL,
  depth         INTEGER NOT NULL,
  position      REAL NOT NULL DEFAULT 0,
  meta_rev      INTEGER NOT NULL DEFAULT 1,
  sync_seq      INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  CHECK (depth BETWEEN 0 AND 2),
  CHECK (is_enc_space = 0 OR (depth = 0 AND parent_id IS NULL AND in_enc_space = 0)),
  CHECK (is_enc_space = 1 OR depth BETWEEN 1 AND 2),
  CHECK (in_enc_space = 0 OR is_enc_space = 0)
);
CREATE INDEX IF NOT EXISTS idx_folders_sync   ON folders(user_id, sync_seq);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(user_id, parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_enc_space ON folders(user_id) WHERE is_enc_space = 1;

-- 7 条目元数据（不含正文）
CREATE TABLE IF NOT EXISTS items (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('note','table','memo')),
  folder_id     TEXT,
  title         TEXT,
  enc_self      INTEGER NOT NULL DEFAULT 0,
  in_enc_space  INTEGER NOT NULL DEFAULT 0,
  size_bytes    INTEGER NOT NULL CHECK (size_bytes <= 1900000),
  content_hash  TEXT NOT NULL,
  tags          TEXT NOT NULL DEFAULT '[]',
  memo_at       INTEGER,
  is_task       INTEGER NOT NULL DEFAULT 0,
  task_status   TEXT,
  task_due      TEXT,
  task_priority TEXT,
  pinned        INTEGER NOT NULL DEFAULT 0,
  starred       INTEGER NOT NULL DEFAULT 0,
  rev           INTEGER NOT NULL DEFAULT 1,
  meta_rev      INTEGER NOT NULL DEFAULT 1,
  sealed_rev    INTEGER,
  sync_seq      INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_edit_at  INTEGER,
  last_device   TEXT,
  deleted_at    INTEGER,
  CHECK (type <> 'memo' OR in_enc_space = 0),
  CHECK (type <> 'memo' OR enc_self = 0),
  CHECK (type = 'memo' OR title IS NOT NULL),
  CHECK (type <> 'memo' OR folder_id IS NULL),
  CHECK (type <> 'memo' OR memo_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_items_sync   ON items(user_id, sync_seq);
CREATE INDEX IF NOT EXISTS idx_items_folder ON items(user_id, folder_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_memo   ON items(user_id, memo_at DESC)  WHERE type = 'memo';
CREATE INDEX IF NOT EXISTS idx_items_task   ON items(user_id, task_status, task_due) WHERE is_task = 1;
CREATE INDEX IF NOT EXISTS idx_items_trash  ON items(user_id, deleted_at) WHERE deleted_at IS NOT NULL;

-- 8 正文：一条一行，恒为明文
CREATE TABLE IF NOT EXISTS item_bodies (
  item_id TEXT PRIMARY KEY,
  body    TEXT NOT NULL,
  CHECK (length(CAST(body AS BLOB)) <= 1900000)
);
```

语句数 **18 条**（8 张 `CREATE TABLE` + 10 条 `CREATE INDEX`），低于架构 §15.4 的"单脚本 ≤ 45 条"上限。

**已实测校验（2026-09-26）**：上述 18 条 DDL、§3.3 的全部 CHECK 行为，以及 §3.5 与《同步引擎设计》§3.4 的条件写语句，已在 SQLite（Node 22 内置 `node:sqlite`，同一 SQL 引擎家族）上逐条执行验证：表/索引数量、DDL 幂等、9 条 `items` CHECK 正反例、6 条 `folders` 约束（含部分唯一索引）、`COLLATE NOCASE` 唯一性、`INSERT ... SELECT ... WHERE ... ON CONFLICT` 语法、"重放不得污染正文"与"并发落败者不得覆盖正文"两个关键行为，全部符合预期。验证脚本为一次性过程产物，按 AGENTS.md 不入库。

### 3.3 CHECK 约束的逐条来源（便于评审）

| 表 | 约束 | 来源 |
|---|---|---|
| `folders` | `depth BETWEEN 0 AND 2` | 照抄 v7.4 |
| `folders` | 加密空间三元组（`is_enc_space=1` ⇒ `depth=0` 且无父） | **重写**（原约束含 `name_enc`） |
| `folders` | `is_enc_space=1 OR depth BETWEEN 1 AND 2` | **新增·本文决定**：普通文件夹不占用 depth 0（depth 0 专属加密空间） |
| `folders` | `in_enc_space=0 OR is_enc_space=0` | **新增·本文决定**：加密空间自身不算"空间内" |
| `folders` | `idx_folders_enc_space` 部分唯一索引 | **新增·本文决定**：在 DB 层保证"每用户恰好一条加密空间"（原 DDL 只写在注释里） |
| `items` | 两条 memo × 加密互斥 | 照抄 v7.4 |
| `items` | `type = 'memo' OR title IS NOT NULL` | **重写**（原约束含 `title_enc`，且与"Memo 无标题"冲突） |
| `items` | `type <> 'memo' OR folder_id IS NULL` | **新增·本文决定**（v7.4 注释已写"Memo 为 NULL"） |
| `items` | `type <> 'memo' OR memo_at IS NOT NULL` | **新增·本文决定**：Memo 必须有时间戳 |
| `item_bodies` | `body IS NOT NULL` + 字节上限 | **重写**（原约束含 `body_enc`） |

> 标注"新增·本文决定"的三条是为了让约束可被机器检查而补的等价表述。若用户认为会误伤历史/导入数据，可去掉后由服务层校验——**去掉不改数据形状，只降低防护强度**。

### 3.4 分摊到各里程碑的表与列

| 对象 | 里程碑 | 说明 |
|---|---|---|
| `app_meta` / `users`（含 `sync_seq`、`tombstone_floor`） / `sessions` / `auth_throttle` | **M1** | 认证刚需 |
| `user_settings` | **M1 建表**，M2 使用 | 表便宜；设置同步在 M2 纳入 sync 载荷 |
| `folders` / `items` / `item_bodies` | **M1** | 笔记最小集刚需；`last_edit_at`/`last_device`/`sealed_rev` 一并建，避免 M4 改热表 |
| `tombstones` | **M4**（永久删除时） | **M1 不做**：M1 只有软删（`deleted_at`），软删行本身带 `sync_seq`，其他设备靠增量拉取即可收到删除信号；墓碑只为"行被物理删除"服务。`users.tombstone_floor` 先建列、恒为 0 |
| `r2_gc_queue` | **M4** | 附件与版本对象才需要 |
| `item_versions` / `attachments` / `attachment_refs` | **M4** | |
| `shares` / `share_items` | **M5** | |
| `api_tokens` / `audit_log` / `mcp_operations` / `rate_counters` / `export_queue` / `backup_targets` / `backup_state` | **M5/M6** | |
| `user_crypto` | **M3** | 按架构 §7.2 新语义重建（verifier + K 的两份包裹），非 v7.4 密钥列 |

### 3.5 `sync_seq` 分配（照需求 §18.3 的内联子查询写法）

- 唯一计数器是 `users.sync_seq`；**一次逻辑写操作只分配一次**，同一 `batch()` 内把它写进所有受影响行。
- **不要用 `RETURNING` 先取号再拼语句**：D1 的 `batch()` 在提交前绑定全部参数，拿不到前一条语句的返回值；把取号与写入拆成两次请求又会丢掉"分配 + 写入同一事务"的保证。
- 正确写法（需求 §18.3 模式，已在 SQLite 上实测通过，见 §5 末注）：

```sql
-- 主写入：sync_seq 用子查询取"将要写入的值"（读 current + 1，不推进计数器）
UPDATE items SET ..., sync_seq = (SELECT sync_seq + 1 FROM users WHERE id = :uid)
 WHERE id = :id AND user_id = :uid AND rev = :base_rev;

-- 计数器：只在主写入确实生效时才真正推进
UPDATE users SET sync_seq = sync_seq + 1
 WHERE id = :uid
   AND EXISTS (SELECT 1 FROM items WHERE id = :id AND rev = :base_rev + 1 AND content_hash = :hash);
```

- **已知精度缺陷（实测发现，需回写 wiki）**：上面这条计数器守卫用的是"当前状态是否等于本次写入后的状态"，因此**当同一请求被重放（响应丢失后重试）时，`items` 主写入影响 0 行，但守卫仍然成立，计数器会空推一格**。后果是 `sync_seq` 出现空洞（没有任何行占用该序号）；对游标协议无害（客户端按 `sync_seq > 游标` 拉取，空洞即"无行可拉"），但会浪费序号、并让"序号 ↔ 写入"不再一一对应。
  - **缓解**：在 batch 之前先做一次 `SELECT rev, content_hash FROM items WHERE id = ? AND user_id = ?`；若 `rev != base_rev` 且 `content_hash == 提交的 hash`，判为**重放成功**（200），**完全跳过 batch**；若 `rev != base_rev` 且哈希不同，直接判 409，同样跳过 batch。这样只有"预检通过后又被并发抢先"的极小窗口才会落到上面的缺陷路径。
  - **根治**（建议并入需求 v7.5）：让主写入落一个每次请求唯一的标记（如新增 `items.write_nonce TEXT`，条件写为 `WHERE ... AND (write_nonce IS NULL OR write_nonce != :nonce)`），守卫改判 `write_nonce = :nonce`。M1 不引入该列，先按上面的缓解措施实现，并把该缺陷记入 v7.5。
- 计数器推进失败（`users` 影响行数为 0）在 M1 视为 `unauthenticated`（用户行不存在）。
- 客户端只有一个游标，按 `sync_seq` 单序列推进（架构 §6.1 设计要点）。

---

## 四、迁移机制：运行时自愈

### 4.1 结论

放弃"部署时用 `wrangler d1 migrations apply`"，采用架构 §15.4 的写法：**每个 isolate 首次请求检查并执行迁移**。三条通道（本地 dev / vitest / 生产）同一机制，一键部署零手工步骤。

### 4.2 落点与形态

| 文件 | 职责 |
|---|---|
| `apps/worker/src/db/migrations/0001_init.ts` | 导出 `{ version: 1, statements: string[] }`，即 §3.2 的语句清单 |
| `apps/worker/src/db/selfheal.ts` | 执行器：检查版本 → 抢锁 → 按序执行 → 校验 → 写版本 |
| `apps/worker/src/db/tables.ts` | 业务 SQL 常量（架构 §2.3.2 指定落点） |
| `apps/worker/src/db/index.ts` | 仓储入口，导出 `ensureSchema(env)` 与查询函数 |

**脚本形态用 `.ts` 常量而不是 `.sql` 文件**：无需给 wrangler 加 `rules` 的 Text 模块规则、语句可被 `tsc`/ESLint 检查、测试可直接引用。`wrangler.jsonc` 里既有的 `migrations_dir` 与 `apps/worker/src/db/migrations/` 目录**保留不动**（供将来可选的手工/本地 apply，且 M0 已为它修过 Vite 插件路径问题），此时它不是主通道。

### 4.3 执行流程

```text
请求进入（Worker fetch 的最外层中间件）
  → ensureSchema(env)
      1. CREATE TABLE IF NOT EXISTS app_meta(...)                -- 幂等，1 语句
      2. INSERT OR IGNORE INTO app_meta VALUES
           ('schema_version','0'), ('migration_lock','0')        -- 幂等
      3. SELECT value FROM app_meta WHERE key='schema_version'
         版本 = 期望 → 直接放行（后续请求只有这 1 次读）
      4. 抢锁：UPDATE app_meta SET value = :now
                WHERE key='migration_lock' AND CAST(value AS INTEGER) < :now - 60000
         影响行数 = 0 → 别的 isolate 正在迁移：
              重读一次 schema_version；达标放行，否则返回 503 retry_later
      5. 按 version 从小到大执行未应用的脚本语句
      6. 校验：sqlite_master 中存在全部必需表与索引，缺失即抛错
      7. UPDATE app_meta SET value = :期望版本 WHERE key='schema_version'
         UPDATE app_meta SET value = '0' WHERE key='migration_lock' AND CAST(value AS INTEGER)=:now
  → 失败：记 console.error（含版本与语句序号），返回 503 retry_later，不缓存"已完成"状态
```

要点：

- **幂等**：全部 DDL 用 `IF NOT EXISTS`；版本号只在全部语句与校验通过后前移；中途失败下次请求重跑（DDL 可重入）。
- **锁**：TTL 60 秒；释放用 `:now` 精确匹配，避免误放他人的锁。Cron 无需参与。
- **隔离级别**：isolate 级缓存"已达标"标记，避免每请求读 `app_meta`；冷启动后第一次请求付一次读。
- **回填类迁移**（架构 §15.4：例如补 `sync_seq`）不走请求路径，拆成 Cron 分批任务——M1 无此类迁移。

### 4.4 为什么不用 CLI 迁移（证据）

查本地 `wrangler@4.141.0`（`node_modules/wrangler/wrangler-dist/cli.js`）：

- `d1 migrations apply` 的 handler 调 `executeSql`，D1 解析走 `getDatabaseByNameOrBinding(config, accountId, nameOrBinding)`；该函数对配置里声明但没有 `database_id` 的库做 **API 查询**，404 时抛 `UserError`，文案即 `Couldn't find an auto-provisioned D1 DB ... Run 'wrangler deploy' to provision it` 或 `Run 'wrangler d1 create ...'`。**它不会创建库。**
- 因此把部署命令写成 `wrangler d1 migrations apply DB --remote && wrangler deploy`，在**全新账户首次部署**时第一步就失败，`wrangler deploy` 永远执行不到，库也永远建不出来。
- 更关键：主部署通道 **Workers Builds 的执行命令是 `npx wrangler deploy`**（`wiki/guides/local-dev.md` §6 第 3 步），**不是**根 `package.json` 的 `deploy` 脚本。改根脚本只影响本地手工部署，对 Workers Builds 无效——要生效得去 Dashboard 改部署命令。
- 结论：CLI 迁移方案要么依赖手工前置步骤，要么依赖 Dashboard 配置漂移，两条都与架构 §15.5"不提前手动创建任何资源"冲突。运行时自愈把这个问题整体消掉。

### 4.5 首次部署路径（零手工）

1. Workers Builds：`pnpm install --frozen-lockfile && pnpm build` → `npx wrangler deploy`；D1 `menote-db` 在 deploy 时按名自动供给并绑定（架构 §15.5）。
2. 第一个真实请求触发自愈建表。
3. `/api/health` 仍可用（健康检查不依赖表）；如需"数据库就绪"探针，M1 可加 `/api/health?deep=1` 返回 `schema_version`（**M1 可选，非必须**）。

---

## 五、测试策略

| 层 | 用例 | 说明 |
|---|---|---|
| Worker 集成（vitest-pool-workers + 本地 D1） | 空库首个请求后，§3.2 的 8 张表与全部索引齐备 | 用 `SELECT name,type FROM sqlite_master` 断言 |
| 同上 | `ensureSchema` 连续调用两次：`schema_version` 不变、不抛错 | 幂等 |
| 同上 | 并发两个请求只执行一轮迁移（第二个走"锁被占"分支并最终放行或返回 503） | 锁正确性 |
| 同上 | 迁移中途失败（临时注入坏语句）→ 返回 503，且 `schema_version` 不前移 | 失败不留半成品版本 |
| 同上 | `items` 的 CHECK：空标题笔记被拒、无标题 Memo 通过、`size_bytes > 1900000` 被拒 | 约束有效性 |
| 同上 | 两用户隔离：A 的 token 读 B 的条目返回 404 | 架构 §13.2 |

**测试不再需要** `readD1Migrations` / `applyD1Migrations`（仅在改用 CLI 迁移时才需要）：`readD1Migrations` 从池配置侧导出（`node_modules/@cloudflare/vitest-pool-workers/dist/pool/index.d.mts`），`applyD1Migrations` 属测试侧 `cloudflare:test`（`types/cloudflare-test.d.ts`）。D1 绑定由 pool 按根 `wrangler.jsonc` 在测试环境自动创建，M0 已验证可跑。

---

## 六、待确认与风险

| # | 项 | 处理建议 |
|---|---|---|
| 1 | `task_status` / `task_priority` 的枚举值字符串 | **已在 M2-1 定死字面量、M2-5 补上约束**：写入用英文 `todo / doing / done` 与 `high / medium / low`（与既有 YAML 英文键约定一致，md 可移植、MCP 好筛）；**读取兼容中文**（待办 / 进行中 / 已完成、高 / 中 / 低），因为 md 允许手工编辑；界面文案走 `TASK_STATUS_LABELS` / `TASK_PRIORITY_LABELS`，中文不入数据。日期为 `YYYY-MM-DD` 且校验真实日期。**约束落地形式改为触发器（0002 迁移，见下）** |
| 2 | 三条"新增·本文决定"的 CHECK | 若担心导入数据误伤可去掉（§3.3 末注） |
| 3 | `wrangler.jsonc` 自动回写的 `database_id` | 本地 `pnpm deploy` 后 wrangler 会把 ID 回写进配置文件；**不要提交**（提交后会把 Deploy 按钮用户指向他人账户）。建议在部署指南加一条；可选在 CI 加 `git diff --exit-code wrangler.jsonc` |
| 4 | `migrations_dir` 保留与否 | 建议保留（零风险），仅更新 `.gitkeep` 说明为"可选手工通道" |
| 5 | 架构文档 `middleware/` 目录缺失、`/api/health` 等路由不在 §2.3.2 落点表 | M1 编码前需向 §2.3.2 补行；属 wiki 改动，见 §7 |
| 6 | `site_settings`（功能拆解 M18-01）vs `app_meta`（需求 §18.2） | **两份 wiki 定稿说法不同**：需求 §18.2 的 DDL 只有 `app_meta`，功能拆解 M18-01 说实例级设置存 `site_settings`。M1 用 `app_meta` 的 `registration_open` / `registration_close_at` 键（不改数据形状、不建多余表）；M6 做实例管理时若字段变多再决定是否拆表。已列入 §7 待点头项 |
| 7 | CSRF 的 Origin 校验在 Vite 插件 dev 下是否与本机 `URL.origin` 一致 | M1 第一天验证；不一致则在 dev 下放行 `http://localhost:*`（仅 dev 分支） |
| 8 | `.dev.vars.example` 被 `.gitignore` 屏蔽（实测 `git check-ignore -v` → `.gitignore:16:.dev.vars*`） | 架构 §15.5 要求随仓库提供该文件以支持一键部署。需改根 `.gitignore` 为 `.dev.vars` / `.dev.vars.*` + `!.dev.vars.example`——**属根配置改动，见 §7 待点头项** |

---

## 七、wiki 同步项（用户已批准 2026-09-26；执行情况）

> **执行情况**：第 1、2、3、5、6 项已执行（架构升 v1.9；根 `.gitignore` 已放行 `.dev.vars.example`）；第 7 项用户已定"用 `app_meta` 键、不建 `site_settings` 表"，功能拆解 M18-01 已同步（拆解升 v2.4）；第 4 项随需求 v7.5 落地。

| # | 文件 | 改动 | 原因 |
|---|---|---|---|
| 1 | `wiki/Menote-项目架构-v1.md` §15.4/§15.5 | 迁移机制统一为"运行时自愈"，删除部署脚本里 `wrangler d1 migrations apply` 的写法 | 两套写法互斥（§4.4 有证据） |
| 2 | `wiki/Menote-项目架构-v1.md` §5.1 | 用 §3.2 的 DDL 替换"以需求 18.2 的 DDL 草案为准"的指引；补 `items.last_edit_at`/`last_device` 与本文新增约束 | 让权威源唯一 |
| 3 | `wiki/guides/local-dev.md` §8 | 删除"把 deploy 脚本改为 `wrangler d1 migrations apply ...`"与 `SESSION_SECRET` 例子；改为"迁移由运行时自愈，无需手工步骤" | 前者已证明不可行，后者密钥无用途（见《认证与会话设计》） |
| 4 | `wiki/Menote-设计文档-v7.4.md` §18.2 | 升 v7.5 时按本文 §2 清理密文列与 CHECK | 计划里已列为 M0 遗留的独立任务 |
| 5 | `wiki/Menote-设计文档-v7.4.md` §18.3 | 修计数器守卫精度缺陷：现有条件写无法区分"本次生效"与"上次已生效"，重放会空推 `users.sync_seq`（§3.5 有实测证据）；建议为 `items` 增加请求级 `write_nonce` 并由守卫改判它，或接受"空洞无害"并把结论写死在文档里 | 实测发现的真实缺陷 |
| 6 | 根 `.gitignore` 第 16 行 | `.dev.vars*` 会把 `.dev.vars.example` 一并屏蔽（实测），与架构 §15.5"随仓库提供 `.dev.vars.example`"冲突；建议改为 `.dev.vars` / `.dev.vars.*` + `!.dev.vars.example` | 实测发现的真实冲突 |
| 7 | 功能拆解 M18-01 vs 需求 §18.2 | 实例级设置的存放（`site_settings` 表 vs `app_meta` 键）两份定稿不一致，需择一 | 两份 wiki 定稿冲突 |

第 4 项即开发计划提到的"需求 v7.5 文档修订"，属用户已认可的独立任务。

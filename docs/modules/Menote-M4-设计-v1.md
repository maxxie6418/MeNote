# Menote M4 设计 v1（内容完整性：表格 / 附件与图片 / 版本历史 / 回收站）

| 项 | 值 |
|---|---|
| 文档版本 | v1 |
| 文档状态 | **评审中**（待用户确认；确认前不写代码） |
| 目的和适用范围 | M4 四个功能域的设计：表格（M05-01~10）、附件与图片（M10-01~03）、版本历史（M11-01~06）、回收站与永久删除（M12-01~04），共 23 个功能点。含**六张表的权威 DDL**、Cron 分派与维护细则、上限默认值、以及需回写 `wiki/` 的清单 |
| 权威级别 | 模块规则。冲突时以 `wiki/` 定稿为准；本文与 `wiki/` 不一致处**一律记入 §九 待用户点头后回写** |
| 最后更新日期 | 2026-09-27 |

修改记录：

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.3.2 | 2026-09-27 | 初稿：四个功能域的规则与契约、六表权威 DDL（评审时列的"五表"漏了 `pending_uploads`）、Cron 分派与游标键、上限默认值、四条待拍板 | deepseek-v4.1-flash |

### 标注约定

| 标注 | 含义 |
|---|---|
| 【定稿】 | 直接沿用 `wiki/` 既有定稿（本文不改写，只落地） |
| 【本文决定】 | 定稿未写、由本文定下并实现；用户可一句覆写 |
| 【待确认】 | 尚未拍板，见 §十 |
| 【接口位】 | M4 只留结构或注释，实现在后续里程碑（M5/M6） |

---

## 一、范围与依据

**包含**：表格（列结构定义与修改、十种字段类型、稳定行 ID、单元格编辑与限制、筛选排序、图册视图、损坏降级）、附件与图片（上传、去重、缩略图、下载、孤儿清理）、版本历史（封存触发与去重、保留与稀疏化、查看对比、恢复、标记保留、策略设置）、回收站（软删、恢复、保留期、永久删除、墓碑与同步扩展）。

**不做 / 留接口位**：

| 事项 | 归属 |
|---|---|
| 分享撤销的**实际实现**（`shares` 表） | M5——M4 在服务端校验处留【接口位】注释与测试占位 |
| 备份 / 导出 / `crypto-format` 的**消费方** | M5 |
| 快照文件（`export_queue` / `snap/`）与永久删除里的"快照中的文件" | M5/M6——M4 只删条目、版本、附件，快照部分留【接口位】 |
| 附件管理页（功能拆解 M10-03 的界面） | **M6**（理由：入口在「设置 › 数据管理」，该分类属 M6）见 §3.6 |
| MCP 工具与其限速 | M6 |

**依据**：需求 §10（表格）、§12（版本历史）、§14（附件与图片、永久删除）、§7.1（回收站）、§15.2（删除与墓碑）、§16.1（分享失效）；架构 §5.1–§5.3（表与 R2 布局、一致性）、§八（附件管线）、§九（版本历史）、§12（Cron）、§14.2（CPU 预算）、§2.3.2（落点表）；功能拆解 M05 / M10 / M11 / M12；《数据模型与迁移设计》§3.4/§3.5/§4；《同步引擎设计》§3.2/§3.3/§五；《隐私锁设计》§5.1/§6.11/§9.2。

---

## 二、表格（M05）

### 2.1 存储形态【定稿 + YAML 键名定稿】

一篇表格就是一条 `items.type = 'table'` 的条目，正文进 `item_bodies`，**不新增 D1 表**；编解码归 `packages/mdcore`（新增 `table.ts`）。正文结构 = front matter（YAML）+ GFM 管道表格 + 可选的 `## 附件` 章节。

**YAML 键名【本文决定，定稿只说"YAML 存列类型 / row_id_column / views"】**（沿用 mdcore 既有的 `menote:` 根键约定）：

```yaml
menote:
  type: table
  columns:
    - { id: c1, name: 名称, type: text }
    - { id: c2, name: 状态, type: status, options: [todo, doing, done] }
  row_id_column: _id        # 固定 `_id`；保留该键便于将来改名
  views:
    default: table          # table | gallery
    gallery: { image_column: c5 }
```

- 列类型枚举（十种，与需求 §10.4 一致）：`text` / `number` / `select` / `multi_select` / `checkbox` / `status` / `url` / `image` / `date` / `tags`。
- 复杂数据（图片等）写在 `## 附件` 章节，**单元格只写名称引用**（M05-09）。
- 解析失败 / 结构损坏 → 见 2.5 降级。

### 2.2 行 ID（`_id`）【定稿：需求 §10.3】

- 首列 `_id`，**6–8 位 base36**，默认隐藏（列定义里 `hidden: true` 且**不可删改**）；大小写不敏感比较。
- 保存时：缺 ID 的补发；重复 ID 保留首个、后续重新分配。
- 纯函数在 mdcore（`ensureRowIds`），读写两用；**前端不自己造 ID**。

### 2.3 单元格规则【定稿：需求 §10.4】

- 不可换行（要换行写 `<br>`）；`|` 必须转义；只支持行内格式（粗体 / 斜体 / 行内代码 / 链接），不支持块级元素。
- 单元格 >2000 字符、列数 >50 → **提示但不拒绝**。
- **读宽容、写规范**：类型不匹配按新类型宽容解析；解析不了就显示原文 + 一处灰提示，**不改数据**。

### 2.4 视图与筛选【定稿：需求 §10.3 / §10.5】

- 表内切换「表格 / 图册」：图册取图片列的缩略图成网格，无图片列时按钮置灰并说明；点卡片**侧滑出整行属性且可编辑**。
- 按列筛选与排序，**纯本地**、不发请求；筛排状态**不落 YAML、关闭即重置**【本文决定】。
- 分组与多视图**不做**。

### 2.5 大小与降级【定稿：需求 §10.6 / §10.10】

- 常驻显示大小（与笔记同一处状态栏）；软上限 1MB 变色提示、仍可保存；硬上限 1,900,000 字节阻止保存并建议拆分。
- 大表渲染层**虚拟滚动**。
- 结构损坏 → **自动降级为普通笔记**：不静默改数据；降级前先封存一个版本（`reason = 'pre_convert'`）；主动降级须用户确认；**不提供反向转回**。

---

## 三、附件与图片（M10）

### 3.1 R2 键与去重【定稿：架构 §5.2 + 本文定稿缩略图后缀】

| 对象 | 键 |
|---|---|
| 原图 / 附件 | `a/{user_id}/{sha256}` |
| 缩略图 | `a/{user_id}/{sha256}.t`【本文决定：`.t` 后缀定稿；架构 §5.2 原标【待核实】】 |
| 版本快照 | `v/{user_id}/{item_id}/{version_id}`（§4.2） |
| 快照（M5/M6） | `snap/{uid}/` |

- 同用户内按 `sha256` 去重（`UNIQUE(user_id, sha256, kind)`），**跨用户不去重**；`Cache-Control: private, max-age=31536000, immutable`；SW 按哈希缓存。
- 单文件 ≤20MB（DB CHECK `size_bytes <= 20971520`）。
- **无预签名直传**：一律经 Worker 代理（架构 §八）。

### 3.2 上传流程【定稿：架构 §八 / §5.3】

1. 浏览器算 SHA-256、生成缩略图（3.3），`POST /api/attachments/check`（sha256 + size）→ `{ exists: true }` 或 `{ pending: true }`；
2. `PUT /api/attachments/blob?sha256=…` 流式：**请求体直写 R2**，Worker 不缓冲、自己不算哈希（用 `sha256` 参数校验），原图与缩略图**各一次请求**；
3. 元数据与登记在同一个 D1 batch：插 `attachments` 两行（`kind='original'` 与 `kind='thumb'`，后者 `parent_id` 指原图）+ 删 `pending_uploads` 登记；
4. 引用由客户端**随条目上报**：`attachment_refs(item_id, version_id = NULL, attachment_id)`；
5. 一致性：上传前先写 `pending_uploads`（`due_at = now + 24h`）；**后台不用 `ListObjects`**；每日维护按 `due_at` 把"登记了却没落元数据"的对象登记进 `r2_gc_queue`（reason=`orphan`）。
6. 弱网：进 outbox 重试；未上传完成时编辑器用本地 `blob:` 预览（仅本机内存，锁定/离开即撤销）。

### 3.3 缩略图生成位置【本文决定：浏览器端；【待确认】§十-1】

- 用 Canvas / OffscreenCanvas 生成**最长边约 400px 的 WebP**（与需求 §14.2 一致）；无法生成（如 HEIC 解码失败）→ 以文件图标代替，**原图照常保存**。
- **否决架构 §八 的 `media.worker` 写法**：省 Worker CPU 与子请求，且与 M2 砍掉 `search.worker.ts` 同例。架构 §八 与 §2.3.2 的 `workers/media.worker.ts` 落点随之删除（记入 §九）。

### 3.4 下载【定稿 + 本文补鉴权】

- `GET /api/attachments/h/:sha256`：**会话鉴权**（未登录 401）→ 流式从 R2 取，支持 `Range`；`?thumb=1` 取缩略图。
- 隐私条目的附件**仍按明文存储**（《隐私锁设计》§6.11）：锁定时界面占位、不渲染、不进搜索结果；服务端不做额外过滤（附件按哈希寻址、不可枚举）。
- 分享场景的专用地址属 M5，不在 M4。

### 3.5 引用与孤儿清理【定稿：需求 §14.3】

- 引用关系**由客户端显式上报**（服务端不解析正文，也读不懂 `## 附件` 章节的语义）。
- 不再被**任何条目**引用（含**回收站中的条目**与 **`keep=1` 的版本**）→ 标 `orphaned_at`；超过 **30 天**由每日维护删对象 + 删记录（对象先登记 `r2_gc_queue`）。
- **原图与它的缩略图一起处理**：登记 GC 或删记录时，按 `(user_id, sha256, kind='thumb')` 连带处理缩略图行与 `a/{uid}/{sha256}.t` 这把键。
- 永久删除条目时同 batch 删其 `attachment_refs` 与 `item_versions`（对象登记 GC）。
- 手动"清理孤儿附件"的入口在附件管理页（M6）；M4 提供接口 `POST /api/attachments/gc`（会话鉴权、只清本用户的孤儿）。

### 3.6 附件管理页的归属【本文决定：留 M6；【待确认】§十-2】

功能拆解 M10-03 的入口是「设置 › 数据管理 › 附件管理」，而**「数据管理」分类属 M6**。M4 **只做**接口、元数据与 Cron 清理，管理页留 M6——避免为它提前放出整个分类。M4 验收时该条记为"接口与 Cron 已就绪、界面留 M6"。

---

## 四、版本历史（M11）

### 4.1 封存触发与去重【定稿：需求 §12.2】

| 触发 | `reason` |
|---|---|
| 停止编辑 10 分钟无改动；标签页隐藏或关闭 | `autosave_idle` |
| 另一台设备改过、或距上次编辑 >1 小时后的首次编辑 | `session` |
| 手动「存为版本」（可填备注，默认永久保留） | `manual`（落库时 `keep = 1`） |
| 破坏性操作前：恢复前 / 冲突 / MCP 修改前 / 表格降级前 | `pre_restore` / `pre_conflict` / `pre_mcp` / `pre_convert` |

- `reason` 在界面上显示为**中文**（映射表集中在 `packages/shared`）。
- **去重**：与最近一个版本的 `content_hash` 相同 → 不生成新版本。自动保存只更新当前稿、`rev + 1`。
- MCP 连续修改时**每 10 分钟最多封存一次**（避免刷版本）。

### 4.2 存储【定稿：需求 §12.4】

- 正文快照写 R2 `v/{user_id}/{item_id}/{version_id}`；D1 `item_versions` **只存元数据**（`rev` / `reason` / `label` / `keep` / `codec` / `size_bytes` / `content_hash` / `title` / `r2_key`）。
- 客户端用 `CompressionStream` 压缩；`codec ∈ {gzip, none}`。
- **服务端封存**（idle 兜底那一批）：正文 ≤256KB 走 gzip，超过则 `codec = 'none'`（避免 Worker CPU 超预算，架构 §14.2）。
- 版本**始终全文快照**，不受 D1 单行上限约束。

### 4.3 保留与稀疏化【定稿：需求 §12.3】

- 密度：24 小时内全留 / 1–7 天每 6 小时 / 7–30 天每天 / 30 天–1 年每周 / 1 年以上每月。
- 每条默认保留 **100** 个（可设 20–500，落 `user_settings`）；最长保留时长默认不限。
- `keep = 1` 与手动版本**不参与稀疏化**；超出条数时删最旧的**非 keep** 版本（连 R2 对象一起登记 GC）。
- 新增版本时**就地稀疏化该条**；每日维护再按游标分批扫一遍。
- 设置入口：设置 › 版本与回收站（M4 放出该分类）。

### 4.4 恢复（回滚）语义【本文决定：定稿未写；【待确认】§十-3】

「恢复此版本」= 以该版本内容覆盖当前稿，四步：

1. **先封存当前稿**（`reason = 'pre_restore'`，`keep = 1`，见 4.1）；
2. 写回正文与派生列（`title` / `tags` / `size_bytes` / `content_hash`），`rev = rev + 1`、`meta_rev = meta_rev + 1`，**一次逻辑写共享一个 `sync_seq`**；
3. **版本表不动**——历史保持不可变；被恢复的那个版本继续存在，可反复恢复；
4. 因为第 1 步留了版本，"恢复"本身可再撤回（用恢复前那个版本再恢复一次即可）。

冲突副本的生成走同一套封存路径（`pre_conflict`）。

### 4.5 与隐私门禁的关系

- 加密文章的版本**同样是明文**（《隐私锁设计》§6.11）；查看、对比、恢复都要求**该篇已逐篇解密**。
- 【本文决定】锁定态下**版本入口整体不可用**（该条目连正文区都是占位，版本列表也随之不展示），不做"列表可见、内容打码"的中间态。

---

## 五、回收站与永久删除（M12）

### 5.1 软删与恢复【定稿：需求 §7.1 / §16.1 / Q12 已确认】

- 删除（笔记 / 表格 / Memo / 文件夹）= 置 `deleted_at`（软删，走普通元数据补丁）；**M2 把删除整体推到了 M4，所以 M4 要补删除入口**。
- 被分享的条目移入回收站 → 分享**立即失效**【接口位：`shares` 表在 M5，M4 只留注释 + 测试占位】。
- 条目删除**不动** `attachment_refs` 与 `item_versions`（附件仍被"回收站里的条目"引用，不算孤儿）。
- **恢复【Q12 定案】**：恢复到**原位置**；原文件夹已不存在（被删或已永久删除）→ 回到**根目录**；`deleted_at = NULL`、`meta_rev + 1`（`rev` 不变），分配新的 `sync_seq`；**分享不自动恢复**。
- 文件夹删除：连同内容一起进回收站；恢复时父不在 → 回根目录；MCP 令牌范围自动去掉该文件夹【接口位：MCP 在 M6】。

### 5.2 保留期与永久删除【定稿：需求 §14.4 + 架构 §12.3】

- 默认保留 **30 天**（`user_settings` 可改）；到期由每日维护永久删除；也可手动永久删除或清空回收站。
- 确认框必须写明范围：**条目 + 全部版本（D1 + R2）+ 不再被引用的附件**；快照文件属 M5/M6，M4 留【接口位】并在文案里不承诺。
- 实现（一个 D1 batch）：删 `items` + `item_bodies` + `attachment_refs` + `item_versions`（`r2_key` 登记 `r2_gc_queue`）+ **写墓碑**；条目多时客户端按**每批 10 条**分请求（单请求 ≤45 语句）。
- R2 对象不即时删：登记 `r2_gc_queue(reason='delete')`，Cron 每轮删 20 个。
- 附件：不在这个 batch 里直接删（可能还有别的引用），交给每日维护的孤儿流程。

### 5.3 墓碑与同步协议扩展【架构 §5.1 草案定稿 + 《同步引擎设计》§3.2 扩展】

- 新增表 `tombstones(user_id, entity, entity_id, sync_seq, deleted_at)`；**与删除那次逻辑写共享同一个 `sync_seq`**。
- **pull 载荷新增 `tombstones` 数组**（`entity` / `entity_id` / `sync_seq`）；`next_cursor` 取 **items / folders / tombstones 三类末端序号的 min**，仍守 §3.3 的"整组回退、空类不参与 min"规则。
- 客户端收到墓碑 → 删本地 `items` / `folders` 行 + 正文缓存 + `searchIndex` 行 + 草稿 + `conflicts` 关联 + 该条目在本地的 `attachmentsMeta`。
- `users.tombstone_floor`：每日维护清理 **180 天前**的墓碑并推进 floor；`full_resync` 条件维持 `cursor > 0 && cursor < floor`。
- 这三条要回写《同步引擎设计》§3.2 / §3.3 / §五（记入 §九）。

---

## 六、六张表的权威 DDL（迁移 `0004_content_integrity.ts`）

> 评审时列的"五表"**漏了 `pending_uploads`**——架构 §5.3 的一致性机制需要它。所以是**六张**。

```sql
-- 1 附件（原图与缩略图各一行，缩略图 parent_id 指原图）
CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('original','thumb')),
  parent_id   TEXT,                       -- 缩略图 → 原图 id；原图为 NULL
  sha256      TEXT NOT NULL,              -- 原图内容哈希；缩略图沿用**同一个** sha256（身份 = (user, sha256, kind)）
  r2_key      TEXT NOT NULL,              -- a/{uid}/{sha256} 或 a/{uid}/{sha256}.t
  mime        TEXT,
  size_bytes  INTEGER NOT NULL CHECK (size_bytes <= 20971520),
  width       INTEGER,
  height      INTEGER,
  filename    TEXT,
  orphaned_at INTEGER,                    -- 标为孤儿的时刻；NULL = 仍被引用
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_dedupe
  ON attachments(user_id, sha256, kind);
CREATE INDEX IF NOT EXISTS idx_attachments_user   ON attachments(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attachments_orphan ON attachments(user_id, orphaned_at);

-- 2 引用（version_id 为 NULL 表示"当前稿"引用）
CREATE TABLE IF NOT EXISTS attachment_refs (
  item_id       TEXT NOT NULL,
  version_id    TEXT,
  attachment_id TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attachment_refs_unique
  ON attachment_refs(item_id, IFNULL(version_id, ''), attachment_id);
CREATE INDEX IF NOT EXISTS idx_attachment_refs_attachment ON attachment_refs(attachment_id);
CREATE INDEX IF NOT EXISTS idx_attachment_refs_item       ON attachment_refs(item_id);

-- 3 版本元数据（正文在 R2 v/{uid}/{item_id}/{version_id}）
CREATE TABLE IF NOT EXISTS item_versions (
  id           TEXT PRIMARY KEY,
  item_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  rev          INTEGER NOT NULL,
  reason       TEXT NOT NULL,
  label        TEXT,
  keep         INTEGER NOT NULL DEFAULT 0,
  codec        TEXT NOT NULL CHECK (codec IN ('gzip','none')),
  size_bytes   INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  title        TEXT,
  r2_key       TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_item  ON item_versions(user_id, item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_versions_sweep ON item_versions(user_id, keep, created_at);

-- 4 墓碑（物理删除的传播；180 天后清理并推进 users.tombstone_floor）
CREATE TABLE IF NOT EXISTS tombstones (
  user_id    TEXT NOT NULL,
  entity     TEXT NOT NULL CHECK (entity IN ('item','folder')),
  entity_id  TEXT NOT NULL,
  sync_seq   INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tombstones_entity ON tombstones(user_id, entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_tombstones_seq ON tombstones(user_id, sync_seq);

-- 5 R2 待删队列（Cron 分批删；队列本身不 ListObjects）
CREATE TABLE IF NOT EXISTS r2_gc_queue (
  r2_key     TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('delete','replace','orphan')),
  due_at     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_r2_gc_due ON r2_gc_queue(due_at);

-- 6 上传登记（24 小时未落元数据 → 视为孤儿）
CREATE TABLE IF NOT EXISTS pending_uploads (
  r2_key     TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  due_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_uploads_due ON pending_uploads(due_at);
```

- 迁移登记：`db/selfheal.ts` 的 `MIGRATIONS` 数组 + `REQUIRED_TABLES` + `REQUIRED_INDEXES`；全部 `IF NOT EXISTS`、可重入。
- 索引语句不计入"必需索引"校验会漏配，所以逐条登记（与 0001 的写法一致）。
- **不改 `items` / `folders` 热表**（`deleted_at` / `sealed_rev` / `tombstone_floor` M1 已建）。

**两条身份与幂等约定【本文决定】**：

1. **附件的身份 = `(user_id, sha256, kind)`**，缩略图沿用原图的 `sha256`（`parent_id` 只用来分组，不参与身份）。因此"重复上传同一文件"会**复用原图与缩略图两行**（秒传），R2 键也确定（`a/{uid}/{sha256}` 与 `a/{uid}/{sha256}.t`），不会出现两行指向同一把键的重复删除风险。
2. **`r2_gc_queue` 用 `INSERT OR IGNORE` 入队**（同一把键可能被"删除"与"孤儿"两条路径同时登记）；已存在时保留**较早的 `due_at`**，避免被后登记的推迟。

---

## 七、Cron 分派与维护细则

- 根 `wrangler.jsonc` 新增：`"triggers": { "crons": ["*/15 * * * *"] }`（**部署配置变更，已获用户点头**）。
- `apps/worker/src/index.ts` 的空壳 `scheduled` 改为调用 `services/jobs.ts` 的 `runScheduled(env, controller)`；入口文件仍只做装配（行数预算 100）。
- 任务顺序与每轮配额【定稿：架构 §12.1】：① 注册开关到期 ② **R2 GC 20 个** ③ 快照队列 10 个【接口位】 ④ **idle 封存兜底 3 条** ⑤ 外部备份【接口位】 ⑥ 每日维护推进一步。
- **游标键（`app_meta`）【本文定稿】**：`job:gc:cursor`、`job:sweep:item`、`job:maintenance:day`、`job:maintenance:step`。
- **不加锁**：多 isolate 可能并发跑同一轮，靠"配额 + 游标 + 幂等"容忍重复（GC 删不存在的对象、稀疏化按条件删、墓碑清理按 floor 推进）——架构 §12.2 没定义租约，本文明确"**容忍重复，不做锁**"，并把这条写进 §九 的回写清单。
- 每日维护五步【定稿：架构 §12.2】：回收站到期永久删除 → 版本稀疏化 → 附件孤儿标记与到期删除 → 引用一致性检查 → 清理（审计 90 天 / MCP 幂等 7 天 / 过期会话 / `auth_throttle` / 墓碑 180 天 + 推进 `tombstone_floor`）。

---

## 八、上限与默认值【本文定稿】

| 项 | 值 |
|---|---|
| 单附件 | ≤20MB（DB CHECK `20971520`） |
| 缩略图 | 最长边约 400px WebP；目标 ≤40KB，超了降质量，**不拒绝上传** |
| 每条版本数 | 默认 100，可设 20–500 |
| 版本单条体积 | 无上限（全文快照；>256KB 时 `codec='none'`） |
| 回收站保留 | 默认 30 天，可改 |
| 附件孤儿保留 | 标孤儿后 30 天删 |
| 单用户附件总量 | **不设硬配额**（【待确认】§十-4）：管理页显示占用，靠 R2 免费额度与运维观察 |
| 永久删除每批 | 客户端 10 条/请求（单请求 ≤45 语句） |

---

## 九、对已定稿的修订清单（**待用户点头后回写**，本文不擅自改 `wiki/`）

| 文件 | 章节 | 改动 |
|---|---|---|
| 项目架构 v1.12 | §5.1 | 六表 DDL 从【待确认】草案改为**指向本设计 §六**（并补 `pending_uploads`） |
| 项目架构 v1.12 | §5.2 | 缩略图键 `a/{uid}/{sha256}.t` **定稿**（去掉【待核实】） |
| 项目架构 v1.12 | §八 + §2.3.2 | **删除 `workers/media.worker.ts` 落点**（缩略图改浏览器生成），§八 的 media worker 时序图改为浏览器端生成 |
| 项目架构 v1.12 | §12.1 / §12.2 | 补游标键名与"**不做锁、容忍重复**"的结论；§12.3 补"快照文件属 M5/M6，M4 留接口位" |
| 同步引擎设计 v1 | §3.2 / §3.3 / §五 | pull 载荷加 `tombstones`；`next_cursor` 取**三类**末端序号的 min；§五 的 M4 边界表标为已实现 |
| 功能拆解 v2.5 | M05 / M10 / M11 / M12 | 按本文补细节：M10-03 标注"管理页留 M6（接口与 Cron M4 就绪）"、M11-04 补回滚语义、M12-03 补恢复规则、M05 补 YAML 键名与 `_id` 规则 |
| 设计文档 v7.5 | §10.2 / §12.4 / §14.3 | 表格 YAML 键名、回滚语义、附件管理页归属，随 **v7.6**（与 §18.2 的 M4 部分）一并修订 |
| `wiki/components.md` | 第十四章等 | 登记 M4 新增组件（见《M4 界面稿》），并说明 `TableEditor` 等落点 |

---

## 十、需要你拍板的点（4 条）

1. **缩略图在浏览器生成**（否决架构 §八 的 `media.worker`）——同意？
2. **附件管理页留 M6**（M4 只做接口 + 元数据 + Cron）——同意？
3. **版本回滚语义**：覆盖当前稿 + 先封存当前稿（`keep=1`）+ `rev+1`、版本表不动、可再撤回——同意？
4. **附件不设硬配额**（只在管理页显示占用）——同意？

# Menote M4 实施计划（内容完整性：表格 / 附件与图片 / 版本历史 / 回收站）

| 项 | 值 |
|---|---|
| 文档版本 | v1 |
| 文档状态 | **草案**（待用户确认；M3 未落地、R2 未开通前不开工） |
| 目的和适用范围 | M4（功能点 M05-01~10 / M10-01~03 / M11-01~06 / M12-01~04，共 23 条）的实施计划：范围边界、开工前置、13 步子计划、每步的涉及文件与可执行验收点、风险清单、交付物。设计依据是 `docs/modules/Menote-M4-设计-v1.md`（v1，评审中，含 §十 四条待拍板） |
| 权威级别 | 模块规则（执行依据）。产品对错以 `wiki/` 定稿为准；与《M4 设计》v1 冲突时以设计稿为准并停下确认 |
| 最后更新日期 | 2026-09-27 |

修改记录：

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.3.2 | 2026-09-27 | 初稿：范围边界（不做 / 留接口位）、五项开工前置、13 步子计划（迁移 0004 → 附件 → 版本 → 回收站 → 同步协议 → Cron → 前端三块 → 收口）、10 条风险、交付物与待点头事项 | deepseek-v4.1-flash |

---

## 一、范围与边界

**包含**：M05 表格（列结构与十种类型、`_id`、单元格编辑与限制、筛选排序、图册、虚拟滚动、大小与降级）、M10 附件与图片（上传 / 去重 / 浏览器缩略图 / 下载 / 引用上报 / 孤儿清理接口与 Cron）、M11 版本历史（封存触发与去重、R2 快照、保留与稀疏化、查看 / 对比 / 恢复、标记保留、策略设置）、M12 回收站与永久删除（软删 / 恢复 / 批量 / 清空 / 永久删除、墓碑与同步协议扩展）。

**不做 / 留接口位**（属其他里程碑或明确否决）：

| 事项 | 归属 |
|---|---|
| 分享撤销的**实际实现**（`shares` 表） | M5——M4 在服务端校验处留【接口位】注释 + 测试占位（设计 §5.1） |
| 备份 / 导出 / `crypto-format` 的**消费方** | M5 |
| 快照文件（`export_queue` / `snap/`）与永久删除里的"快照中的文件" | M5/M6——M4 只删条目、版本、附件；确认框文案**不承诺**删除快照（设计 §5.2） |
| 附件管理页（M10-03 的界面） | **M6**（入口在「设置 › 数据管理」，属 M6 分类）。M4 只做接口 + 元数据 + Cron；验收记为"接口与 Cron 已就绪、界面留 M6"（设计 §3.6） |
| MCP 本体、令牌范围收紧、`pre_mcp` 封存的实际调用方 | M6（M4 只把 `pre_mcp` 写进 `reason` 枚举与中文映射表） |
| `workers/media.worker.ts`（缩略图服务端生成） | **不做且删落点**：改为浏览器端生成（设计 §3.3）；架构 §八 与 §2.3.2 的该落点随 §九 回写删除 |
| 表格分组、多视图、筛排状态落 YAML、降级后的反向转回 | 不做（设计 §2.4 / §2.5） |
| 附件硬配额 | 不设（设计 §8；只在 M6 的管理页显示占用） |

**开工前置**（逐条打勾后再进 M4-2；M4-1 是代码前唯一的人工确认点）：

- [ ] 《M4 设计》v1 经用户确认（现状：**评审中**，§十 四条待拍板：浏览器生成缩略图 / 附件管理页留 M6 / 回滚语义 / 附件不设硬配额）
- [ ] **《M4 界面稿》v1 成稿并经用户确认**（现状：**尚未创建**；M4-1 的产出）
- [ ] **线上开通 R2 并建 bucket**（本地 miniflare 可模拟；测试与 dev 靠 `r2_buckets` 绑定的本地实现）
- [ ] 根 `wrangler.jsonc` 加 `r2_buckets`（`ATTACHMENTS`）与 `triggers.crons`（`*/15 * * * *`）——现状：两者都没有（Cron 属部署配置变更，设计 §7 已获用户点头）
- [ ] **M3 已落地**（M4 有四处依赖 M3 门禁，见下）——现状：M3-1 完成，M3-2~M3-12 未开工

M3 依赖面（**四处**，按《M4 设计》§3.4 / §4.5 / §5.1 与 M3 计划 M3-3 的落点推出）：

1. 版本历史的**查看 / 对比 / 恢复**在锁定态整体不可用（设计 §4.5）——依赖 M3 的逐篇解密集合与 `PrivacyGate`；
2. 回收站页里加密空间条目的标题占位（M12-02）——依赖 M3 的锁定态判定；
3. 附件的门禁渲染与锁定占位（M10-02）——依赖 M3 的 `PrivacyGate`；服务端不做额外过滤（附件按哈希寻址）；
4. 服务端语句复用 M3 建立的 `apps/worker/src/db/privacy.ts` 的 `PRIVACY_EXCLUDE_SQL` 常量（M3-3 落点）——M4 的回收站 / 版本 / 附件相关查询与搜索同源。

**其它前置事实（现状核对，供落位用）**：

- `apps/worker/src/index.ts` 的 `scheduled: () => {}` 是空壳（69 行，预算 100）；
- `apps/worker/src/db/migrations/` 现只有 `0001_init.ts` / `0002_task_literals.ts`，**`0003` 由 M3 新增**，M4 用 **`0004`**；
- `apps/web/src/data/db/schema.ts` 现有 Dexie v1–v4（`items` / `bodies` / `drafts` / `folders` / `outbox` / `syncState` / `searchIndex` / `settings` / `conflicts`），M4 加 **v5**（`attachmentsMeta`）；
- `apps/worker/src/types.ts` 绑定只有 `DB` / `ASSETS` / `AUTH_PEPPER`（M3 会加 `BACKUP_CRED_KEY`），M4 加 **`ATTACHMENTS: R2Bucket`**；
- `apps/worker/src/` 下**尚无** `jobs/` 与 `adapters/` 目录（M4 新建）。

---

## 二、分步计划

每一步都按「完成后立刻提交」执行（AGENTS「里程碑执行节奏」）：代码与文档分开提交，推送前跑 `pnpm lint` / `pnpm typecheck` / `pnpm test`。

**步骤速览**：

| 步 | 内容 | 主要落点 |
|---|---|---|
| M4-1 | 界面稿（**先稿后码**） | `docs/modules/Menote-M4-界面稿-v1.md` |
| M4-2 | 迁移 0004（六表）+ 自愈登记 + SQL 常量 + 上限常量 | `db/migrations/0004_content_integrity.ts`、`db/selfheal.ts`、`db/tables.ts`、`packages/shared/src/limits.ts` |
| M4-3 | 表格编解码（mdcore，纯函数） | `packages/mdcore/src/table.ts` |
| M4-4 | 附件服务端（R2 适配 + 四点端点 + `pending_uploads`） | `adapters/r2.ts`、`services/attachments.ts`、`routes/attachments.ts` |
| M4-5 | 版本历史服务端（封存 / 列表 / 正文 / 恢复 / 保留） | `services/versions.ts`、`routes/versions.ts`、`jobs/gc.ts` |
| M4-6 | 回收站服务端（软删 / 恢复 / 批量 / 清空 / 永久删除 + 墓碑） | `routes/items.ts`、`services/trash.ts` |
| M4-7 | 同步协议扩展（`tombstones` + 三类 min + 客户端墓碑删除分支） | `services/sync.ts`、`data/sync/pull.ts`、`data/db/repository.ts` |
| M4-8 | Cron（`triggers.crons` + `scheduled` 接线 + 配额 + 游标 + 每日维护五步） | `wrangler.jsonc`、`index.ts`、`services/jobs.ts`、`jobs/maintenance.ts` |
| M4-9 | 前端表格（视图 / 列定义 / 图册 / 筛排 / 虚拟滚动 / 降级） | `features/tables/` |
| M4-10 | 前端附件（粘贴拖入选择 / 缩略图 / 引用上报 / outbox / 下载 / `attachmentsMeta`） | `features/attachments/`、`data/db/schema.ts`（v5） |
| M4-11 | 前端版本历史 + 设置「版本与回收站」分类 | `features/versions/`（或 `features/notes/` 下的版本面板）、`features/settings/` |
| M4-12 | 前端回收站页与删除入口 | `features/trash/`、条目更多菜单 |
| M4-13 | 验收与收口（走查 + 逐屏 + 五条命令 + CHANGELOG + **v0.5.0**） | 收口复核文档 |

### M4-1 界面稿（**先稿后码**，代码前唯一的人工确认点）

- **目标**：产出 `docs/modules/Menote-M4-界面稿-v1.md`，覆盖 M4 全部新屏与两态，用户确认后才动界面代码。
- **至少覆盖**：
  1. **表格视图**：`TableEditor`（表格 / 图册切换、表头菜单、`_id` 列隐藏、单元格十种类型的编辑态、新增行 / 删除行 / 拖动排序、常驻大小状态栏）；
  2. **列定义面板**：新建表格时的默认一列"名称（文字）"、增删改列与改类型（含"读宽容"的灰提示）、选项维护、删除列确认文案（"可在版本历史中找回"）；
  3. **图册视图**：无图片列时按钮置灰与说明；点卡片侧滑出行属性且可编辑；
  4. **损坏降级两态**：自动降级（不静默改数据 + 一处灰提示）与主动降级（确认框）；
  5. **附件交互**：粘贴 / 拖入 / 选择、上传进度与 outbox 重试、`blob:` 本地预览、非图片附件的文件链接、锁定条目下的附件占位；
  6. **版本历史**：列表（时间 / 中文 `reason` / 大小 / 备注）、单版本全文查看、两版本或与当前稿的简易 diff、每个版本的菜单（恢复 / 标记保留）、"存为版本"对话框；
  7. **设置 › 版本与回收站**：封存间隔、各年龄段密度、每条最多保留条数（默认 100，20–500）、最长保留时长、「打开回收站」（含条目数）；
  8. **回收站页**：列表（标题占位 / 类型 / 删除时间 / 剩余保留天数）、恢复 / 永久删除 / 清空、页头「返回设置」、永久删除的确认框文案（写明范围且**不承诺**删快照）。
- **涉及文件**：新增文档；对照 `DESIGN.md`（视觉唯一源）与 `wiki/components.md`（`TableEditor` / `ColumnPanel` / `GalleryView` / `VersionList` / `VersionDiff` / `TrashPage` / `AttachmentChip` 等新组件的登记位）、原型锚点可复用。
- **验收**：用户确认该稿；文档说明"这一屏有哪些块、主操作、空状态"；未确认前不写任何界面代码。命令侧只跑 `pnpm lint`（无代码改动时应零告警）。

### M4-2 迁移 0004 + 自愈登记 + SQL 常量 + 上限常量

- **目标**：六张表（`attachments` / `attachment_refs` / `item_versions` / `tombstones` / `r2_gc_queue` / `pending_uploads`）按设计 §六 权威 DDL 落地，可重入、纳入自愈校验；上限常量集中一处。
- **涉及文件**：
  - `apps/worker/src/db/migrations/0004_content_integrity.ts`（新增；全部 `IF NOT EXISTS`）；
  - `apps/worker/src/db/selfheal.ts`（`MIGRATIONS` 追加、`REQUIRED_TABLES` + `REQUIRED_INDEXES` 逐条登记——索引语句不计入校验会漏配，与 0001 写法一致）；
  - `apps/worker/src/db/tables.ts`（六表与索引的语句常量，供服务层复用）；
  - `apps/worker/test/helpers.ts`（`TABLES` / `INDEXES` 追加六表与 10 个索引）；
  - `packages/shared/src/limits.ts`（或新增同职责常量：单附件 20MB / `20971520`、正文硬上限 `1900000`、软上限 1MB、版本数 100 与 20–500、回收站 30 天、孤儿 30 天、缩略图 400px 与 ≤40KB、单元格 2000 字符、50 列、永久删除每批 10 条）；
  - `apps/worker/test/schema.test.ts`（扩）。
- **不做**：不改 `items` / `folders` 热表（`deleted_at` / `sealed_rev` / `tombstone_floor` M1 已建）。
- **验收**：
  - `pnpm --filter @menote/worker test` 通过；`schema.test.ts` 断言空库首个请求后六表与 10 个索引全部出现在 `sqlite_master`，且 `EXPECTED_SCHEMA_VERSION` 随 `MIGRATIONS` 增长（不改死数字）；
  - 幂等：`schema.test.ts › 连调两次 ensureSchema 版本不变`；
  - `CHECK` 生效：`schema.test.ts › attachments.size_bytes > 20971520 被拒`、`codec 非 gzip/none 被拒`、`tombstones.entity 非法被拒`；
  - 去重索引生效：同 `(user_id, sha256, 'original')` 插两次报错，`sha256 IS NULL` 的缩略图行不冲突；
  - `pnpm lint`（`max-lines` 告警）、`pnpm typecheck`。

### M4-3 表格编解码（`packages/mdcore`，纯函数先行）

- **目标**：表格正文的编解码与 `_id` 规则全部落在零依赖纯函数里，前后端同一份实现，可先于任何 I/O 单测。
- **涉及文件**：`packages/mdcore/src/table.ts`（新增：YAML `menote:` 根键读写、`columns` / `row_id_column` / `views`、十种类型枚举、`ensureRowIds`（6–8 位 base36、大小写不敏感、缺 ID 补发、重复保留首个后续重发）、单元格转义与 `<br>` / 行内格式、宽容解析与降级判定、`## 附件` 章节的文件名引用映射）、`packages/mdcore/src/index.ts`（导出）、`packages/mdcore/test/table.test.ts`（新增）。
- **验收**：
  - `pnpm --filter @menote/mdcore test` 通过，用例名：`table.test.ts › 十种列类型往返编解码一致`、`› YAML 键名与 views.default/gallery 往返一致`、`› ensureRowIds 补发缺 ID`、`› 重复 ID 保留首个其余重发`、`› ID 大小写不敏感比较`、`› 单元格 | 转义与 <br> 往返`、`› 类型不匹配按新类型宽容解析且不改数据`、`› 结构损坏判定为降级`、`› 同名图片文件名加序号`；
  - 单元格 >2000 字符、列数 >50 只产出"提示"级结果而非拒绝（断言返回结构里的提示位）；
  - `pnpm --filter @menote/shared build && pnpm --filter @menote/mdcore build` 通过（两端消费前先可构建）。

### M4-4 附件服务端（R2 适配 + 四个端点 + `pending_uploads` 一致性）

- **目标**：附件上传 / 去重 / 下载 / GC 的完整服务端闭环，Worker 不缓冲请求体、自己不算哈希。
- **涉及文件**：
  - `apps/worker/src/adapters/r2.ts`（新增：`put` / `get`（含 `range`）/ `delete` / `head` 的最小封装，键 `a/{uid}/{sha256}` 与 `.t`）；
  - `apps/worker/src/services/attachments.ts`（新增：`check`、`putBlob`、`serve`、`gc`；`pending_uploads` 先登记后落元数据、同一 D1 batch 插两行 + 删登记；`orphaned_at` 标记与 30 天规则；**不用 `ListObjects`**）；
  - `apps/worker/src/routes/attachments.ts`（新增：`POST /api/attachments/check`、`PUT /api/attachments/blob?sha256=…`、`GET /api/attachments/h/:sha256`（`?thumb=1` 与 `Range`）、`POST /api/attachments/gc`；会话鉴权）；
  - `apps/worker/src/index.ts`（挂子路由，只加一行 `app.route`）；
  - `apps/worker/src/types.ts`（`ATTACHMENTS: R2Bucket`）、根 `wrangler.jsonc`（`r2_buckets`）、`apps/worker/vitest.config.ts`（本地 R2 绑定）；
  - `apps/worker/test/attachments.test.ts`（新增）。
- **验收**：
  - `pnpm --filter @menote/worker test` 通过，用例名：`attachments.test.ts › check 未见过返回 pending: true 并写 pending_uploads`、`› blob 上传后 exist 返回 exists: true 且 attachments 两行 parent_id 指向原图`、`› 上传同 sha256 两次不重复落行（去重索引）`、`› 未登录 GET /api/attachments/h/:sha256 返回 401`、`› ?thumb=1 取缩略图对象`、`› Range 请求返回 206 与正确 Content-Range`、`› size > 20MB 被拒`、`› sha256 参数与实际对象键不一致时不落元数据`、`› pending_uploads 落元数据后该行被删除`、`› POST /api/attachments/gc 只清本用户孤儿（tenant-isolation 不通过）`；
  - `Cache-Control: private, max-age=31536000, immutable` 在响应头断言；
  - 单文件 20MB 边界：`check` 与 `blob` 两处都拒（共享常量来自 `packages/shared`）；
  - `pnpm --filter @menote/worker test -- tenant-isolation` 通过（跨用户不串）。

### M4-5 版本历史服务端（封存 / 列表 / 正文 / 恢复 / 保留）

- **目标**：`item_versions` 元数据 + R2 `v/{uid}/{item_id}/{version_id}` 全文快照的服务端闭环，含 idle 兜底封存与保留策略。
- **涉及文件**：
  - `apps/worker/src/services/versions.ts`（新增：封存（去重按 `content_hash`）、idle 兜底选择、列表分页、取正文（按 `codec` 解 gzip）、`restore`、`keep` 标记、就地稀疏化（24h 全留 / 1–7 天每 6 小时 / 7–30 天每天 / 30 天–1 年每周 / 1 年以上每月；`keep=1` 与手动版本不参与；超出条数删最旧非 keep 并把 `r2_key` 登记 `r2_gc_queue`）；服务端正文 **≤256KB 走 gzip，超过 `codec='none'`**）；
  - `apps/worker/src/routes/versions.ts`（新增：列表 / 单版本正文 / 封存 / `POST /api/versions/:id/restore` / `keep` 切换；鉴权 + 条目归属校验）；
  - `apps/worker/src/jobs/gc.ts`（新增：`r2_gc_queue` 按 `due_at` 分批取 20 个删对象 + 删行，幂等）；
  - `apps/worker/src/db/tables.ts`（版本相关语句常量）；
  - `apps/worker/test/versions.test.ts`、`apps/worker/test/jobs-gc.test.ts`（新增）。
- **验收**：
  - `pnpm --filter @menote/worker test` 通过，用例名：`versions.test.ts › 封存写入 R2 键 v/{uid}/{item_id}/{version_id}`、`› content_hash 与最近版本相同则不新增`、`› 正文 256KB 以内 codec=gzip 且可解回原文`、`› 超过 256KB codec=none 且不解压`、`› restore 先封存 pre_restore(keep=1) 再覆盖正文并 rev+1 / meta_rev+1 / 同一 sync_seq`、`› restore 后版本表行数不变`、`› restore 可被再次撤回（恢复 pre_restore 那个版本）`、`› keep=1 不参与稀疏化`、`› 稀疏化按年龄段删除最旧非 keep 且 R2 键进 r2_gc_queue`、`› 手动版本落库 keep=1`；
  - `jobs-gc.test.ts › 一轮删 20 个且删不存在的对象不报错`、`› 连跑两次同一批对象不重复失败（幂等）`；
  - `pnpm --filter @menote/worker test -- tenant-isolation` 通过（甲用户不能取乙的版本正文）。

### M4-6 回收站服务端（软删 / 恢复 / 批量 / 清空 / 永久删除 + 墓碑）

- **目标**：M2 整体推到 M4 的删除链路补齐，永久删除落在**一个 D1 batch**里并写墓碑。
- **涉及文件**：
  - `apps/worker/src/services/trash.ts`（新增：软删（`deleted_at` 补丁）、恢复到原位置（原文件夹不在 → 根目录；`deleted_at = NULL`、`meta_rev + 1`、`rev` 不变、新 `sync_seq`）、批量恢复、清空回收站、**永久删除（单 batch：删 `items` + `item_bodies` + `attachment_refs` + `item_versions`（`r2_key` 登记 `r2_gc_queue` reason=`delete`）+ 写 `tombstones`，共享同一 `sync_seq`）**、文件夹删除连同内容、分享失效【接口位】注释 + 测试占位）；
  - `apps/worker/src/routes/items.ts`（扩：删除 / 恢复 / 清空 / 永久删除端点，**不收 bulk 一把梭**，每批 ≤10 条）；
  - `apps/worker/src/services/items.ts`（复用既有补丁路径）；
  - `apps/worker/test/trash.test.ts`（新增）、`apps/worker/test/items.test.ts`（扩）。
- **验收**：
  - `pnpm --filter @menote/worker test` 通过，用例名：`trash.test.ts › 软删只写 deleted_at 且 rev 不变`、`› 恢复回原文件夹；原文件夹已删除则回根目录`、`› 恢复分配新 sync_seq 且 meta_rev+1`、`› 恢复不自动恢复分享（占位用例）`、`› 永久删除 10 条时 D1 语句数 ≤45`、`› 永久删除写墓碑且 sync_seq 与删除那次一致`、`› 永久删除把版本 r2_key 全部登记 r2_gc_queue`、`› 永久删除不动附件对象（留给孤儿流程）`、`› 文件夹删除连同内容一起进回收站`、`› 单请求超过 10 条被拒（客户端分批判定边界）`；
  - 语句计数断言要能打印实际 `batch` 长度（失败时给出提示）；
  - `pnpm --filter @menote/worker test -- tenant-isolation` 通过。

### M4-7 同步协议扩展（`tombstones` + 三类 min + 客户端墓碑删除分支）

- **目标**：物理删除能传播到其他设备；`next_cursor` 从两类改三类不破坏既有分页语义。
- **涉及文件**：
  - `apps/worker/src/services/sync.ts`（pull 载荷加 `tombstones` 数组（`entity` / `entity_id` / `sync_seq`）；`next_cursor` 取 **items / folders / tombstones 三类末端序号的 min**，守 §3.3「整组回退、空类不参与 min」；`full_resync` 条件维持 `cursor > 0 && cursor < tombstone_floor`）；
  - `packages/shared/src/sync.ts`（载荷类型与校验 schema）；
  - `apps/web/src/data/sync/pull.ts`（墓碑分支：删 `items` / `folders` 行、正文缓存 `bodies`、`searchIndex` 行、`drafts`、`conflicts` 关联、该条目在本地的 `attachmentsMeta`）；
  - `apps/web/src/data/db/repository.ts`（`applyTombstones` 事务）；
  - `apps/worker/test/sync.test.ts`（扩）、`apps/web/test/sync-pull.test.ts`（扩/新增墓碑组）。
- **验收**：
  - `pnpm --filter @menote/worker test` 通过，用例名：`sync.test.ts › pull 返回 tombstones 数组`、`› next_cursor 取三类 min`、`› 某类为空时不参与 min（不倒退）`、`› cursor < tombstone_floor 返回 full_resync`；
  - `pnpm --filter @menote/web test` 通过，用例名：`sync-pull.test.ts › 墓碑删除本地 items 与正文缓存`、`› 墓碑同时清 searchIndex 与 drafts`、`› 墓碑清 conflicts 关联`、`› 墓碑清该条目 attachmentsMeta`、`› 未知实体的墓碑被忽略不报错`；
  - **回归面**：M1 既有同步用例全绿（`pnpm --filter @menote/web test -- sync-pull`、`pnpm --filter @menote/worker test -- sync`）。

### M4-8 Cron（`triggers.crons` + `scheduled` 接线 + 配额 + 游标 + 每日维护五步）

- **目标**：空壳 `scheduled` 改为调 `services/jobs.ts`；入口仍只做装配；任务顺序、每轮配额、游标键、幂等口径全部落地。
- **涉及文件**：
  - 根 `wrangler.jsonc`（加 `"triggers": { "crons": ["*/15 * * * *"] }`；`r2_buckets` 已在 M4-4 加）；
  - `apps/worker/src/index.ts`（`scheduled: (event, env, ctx) => runScheduled(env, ctx)`，仍 ≤100 行）；
  - `apps/worker/src/services/jobs.ts`（新增：顺序 ① 注册开关到期 ② **R2 GC 20 个** ③ 快照队列 10 个【接口位】 ④ **idle 封存兜底 3 条** ⑤ 外部备份【接口位】 ⑥ 每日维护推进一步；**不加锁**，靠"配额 + 游标 + 幂等"容忍重复）；
  - `apps/worker/src/jobs/maintenance.ts`（新增：每日维护五步——回收站到期永久删除 → 版本稀疏化 → 附件孤儿标记与到期删除 → 引用一致性检查 → 清理（审计 90 天 / MCP 幂等 7 天 / 过期会话 / `auth_throttle` / 墓碑 180 天 + 推进 `tombstone_floor`））；
  - 游标键（`app_meta`）：`job:gc:cursor`、`job:sweep:item`、`job:maintenance:day`、`job:maintenance:step`；
  - `apps/worker/test/jobs.test.ts`（新增）。
- **验收**：
  - `pnpm --filter @menote/worker test` 通过，用例名：`jobs.test.ts › 一轮最多删 20 个 GC 对象并推进 job:gc:cursor`、`› 一轮最多 idle 封存 3 条`、`› 每日维护推进一步并写 job:maintenance:step`、`› 同一天不重复推进 job:maintenance:day`、`› 连跑两轮不产生重复副作用（不做锁的幂等要求）`、`› 回收站到期条目被永久删除并写墓碑`、`› 墓碑超过 180 天被清理且 users.tombstone_floor 推进`、`› pending_uploads 到期登记为 orphan 进 r2_gc_queue`；
  - `scheduled` 用 `cloudflare:test` 的 `createExecutionContext()` + `waitOnExecutionContext()` 驱动，断言 `index.ts` 只转调、不含业务（架构 §2.3.1）；
  - `pnpm lint` 通过（`index.ts` 行数与白名单内容检查）、`pnpm typecheck`；
  - 本地手验：`pnpm dev` 后用 `wrangler dev --test-scheduled` 触发 `http://127.0.0.1:<port>/__scheduled?cron=*/15+*+*+*+*`（本地 miniflare 模拟 R2），确认无异常、`app_meta` 出现四个游标键。

### M4-9 前端表格（视图 / 列定义 / 图册 / 筛排 / 虚拟滚动 / 降级）

- **目标**：M05-01~10 全量界面，逻辑下沉到 `features/tables/model.ts` 与 `packages/mdcore`。
- **涉及文件**：
  - `apps/web/src/features/tables/model.ts`（新增：列操作、行操作、筛选排序纯函数、大小与降级判定、`ensureRowIds` 调用）；
  - `apps/web/src/features/tables/ui/TableEditor.tsx`、`TableGrid.tsx`、`ColumnPanel.tsx`、`GalleryView.tsx`、`RowDrawer.tsx`、`TableSizeBar.tsx`（新增）；
  - `apps/web/src/features/notes/`（新建表格入口、表格条目的打开路径、更多菜单加"降级为普通笔记"）；
  - `apps/web/src/app/workarea/`（表格与笔记的渲染分支）；
  - `apps/web/test/table-model.test.ts`、`apps/web/test/table-view.test.ts`（新增）。
- **不做**：分组、多视图、筛排状态落 YAML（关闭即重置）。
- **验收**：
  - `pnpm --filter @menote/web test` 通过，用例名：`table-model.test.ts › 新建表格默认一列名称（文字）`、`› 增删改列与改类型按新类型宽容解析`、`› 删除列确认文案含"版本历史"`、`› _id 列不可删改且默认隐藏`、`› 筛选排序纯本地且关闭后重置`、`› 图册在无图片列时置灰`、`› 超过软上限 1MB 变色但可保存`、`› 超过硬上限 1900000 字节阻止保存并建议拆分`、`› 结构损坏自动降级且降级前封存 reason=pre_convert`、`› 主动降级需确认且不提供反向转回`；
  - 大表虚拟滚动用 2,000 行 × 20 列的手工样例在 `pnpm dev` 下滚动无卡顿（记录帧率或 DOM 行数上限断言：渲染行数 ≤ 视口行数 + 缓冲）；
  - `pnpm lint` / `pnpm typecheck` 通过；**动手前先按架构 §2.3.1/§2.3.3 检查 `App.tsx` 与 `useNotesWorkspace.ts` 的行数**，接近 500 行预算就先做拆分规划（见 §三 风险 8）。

### M4-10 前端附件（粘贴 / 拖入 / 选择、缩略图、引用上报、outbox、下载、`attachmentsMeta`）

- **目标**：M10-01/02 全量界面 + Dexie v5；上传走浏览器算哈希与缩略图，服务端只代理。
- **涉及文件**：
  - `apps/web/src/features/attachments/model.ts`（新增：哈希、`check` → `blob` 两段流程、引用上报、重试、本地预览生命周期）；
  - `apps/web/src/features/attachments/thumbnail.ts`（新增：Canvas / `OffscreenCanvas` → 最长边约 400px WebP，目标 ≤40KB 超了降质量，失败回退文件图标）；
  - `apps/web/src/features/attachments/ui/AttachmentChip.tsx`、`AttachmentDropZone.tsx`、`AttachmentPreview.tsx`（新增）；
  - `apps/web/src/data/db/schema.ts`（**Dexie v5**：`attachmentsMeta` 表，`item_id` / `attachment_id` / `sha256` 索引）；
  - `apps/web/src/data/sync/pull.ts` + `push`/`outbox`（引用上报随条目上报；弱网进 outbox 重试）；
  - `apps/web/test/attachments-model.test.ts`、`apps/web/test/thumbnail.test.ts`、`apps/web/test/db.test.ts`（扩 v5 升级）。
- **验收**：
  - `pnpm --filter @menote/web test` 通过，用例名：`attachments-model.test.ts › check 命中直接复用不重传`、`› 上传成功后 attachment_refs 随条目上报`、`› 上传失败进 outbox 并可重试`、`› 未上传完成时用本地 blob: 预览且锁定/离开即撤销`、`› 非图片附件渲染为文件链接`、`› 锁定态附件显示占位且不进搜索结果`、`thumbnail.test.ts › 400px WebP 生成（含 OffscreenCanvas 缺失时回退 Canvas）`、`› 解码失败回退文件图标且不阻塞上传`、`› 超过 40KB 时降质量重新编码`；
  - `db.test.ts › Dexie 升到 v5 保留既有表数据且新增 attachmentsMeta`；
  - `pnpm lint` / `pnpm typecheck` / `pnpm build` 通过（浏览器生成缩略图不引入新依赖）。

### M4-11 前端版本历史 + 设置页「版本与回收站」分类

- **目标**：M11-01~06 的界面与设置项；封存触发（客户端触发 + 服务端 idle 兜底）与恢复流程打通。
- **涉及文件**：
  - `apps/web/src/features/versions/model.ts`（新增：封存触发时机（停止编辑 10 分钟 / 标签页隐藏或关闭 / 跨设备或 >1 小时首编辑 / 破坏性操作前）、`reason` → 中文映射的取用、版本列表与 diff 的纯函数）；
  - `apps/web/src/features/versions/ui/VersionList.tsx`、`VersionDiff.tsx`、`SaveVersionDialog.tsx`、`VersionRestoreDialog.tsx`（新增）；
  - `apps/web/src/features/notes/`（更多菜单加"版本历史" / "存为版本"；标签页 `visibilitychange` 与关闭前封存）；
  - `apps/web/src/features/settings/model.ts` + `ui/SettingsPanel.tsx`（新增「版本与回收站」分类：封存间隔 / 密度 / 每条最多保留条数 20–500 默认 100 / 最长保留时长默认不限；「打开回收站」带条目数）；
  - `packages/shared/src/settings.ts`（版本与回收站设置字段 + 默认值，缺字段填默认值）、`packages/shared/src/`（`reason` 中文映射表集中一处）；
  - `apps/web/test/versions-model.test.ts`、`apps/web/test/settings-client.test.ts`（扩）。
- **验收**：
  - `pnpm --filter @menote/web test` 通过，用例名：`versions-model.test.ts › 停止编辑 10 分钟触发 autosave_idle`、`› 标签页隐藏触发封存`、`› 跨设备或间隔 1 小时首编辑触发 session`、`› 内容与上一版本相同不生成新版本`、`› reason 全枚举都有中文文案`、`› 锁定态版本入口整体不可用`、`› 单篇加密条目未逐篇解密时不展示版本内容`、`› 恢复确认后先封存 pre_restore 再覆盖当前稿`、`› 恢复后可再撤回`、`› 标记保留后不参与稀疏化提示`；
  - `settings-client.test.ts › 版本与回收站设置缺字段填默认值`、`› 条数上下限 20–500 校验`；
  - 手验：`pnpm dev` 下走一遍"手动存为版本 → 改正文 → 恢复 → 再恢复回滚"。

### M4-12 前端回收站页与删除入口

- **目标**：M12-01/02/03/04 的界面；**删除入口是 M2 遗留、M4 补上**的破坏性操作。
- **涉及文件**：
  - `apps/web/src/features/trash/model.ts`（新增：列表分组与"剩余保留天数"计算、**每批 10 条**的永久删除分请求编排、清空回收站进度、失败清单与重试）；
  - `apps/web/src/features/trash/ui/TrashPage.tsx`、`TrashRow.tsx`、`PurgeConfirmDialog.tsx`（新增）；
  - `apps/web/src/features/settings/ui/SettingsPanel.tsx`（「打开回收站」入口）与 `apps/web/src/features/notes/`（条目更多菜单的"删除"、文件夹删除、Memo 删除、表格删除；删除后"已移入回收站"提示 + 撤销）；
  - `apps/web/src/app/`（回收站页的路由/视图切换与「返回设置」）；
  - `apps/web/test/trash-model.test.ts`、`apps/web/test/trash-view.test.ts`（新增）。
- **验收**：
  - `pnpm --filter @menote/web test` 通过，用例名：`trash-model.test.ts › 每批 10 条拆分永久删除请求`、`› 单条失败跳过并进失败清单可重试`、`› 清空回收站按批推进且显示进度`、`› 剩余保留天数按 30 天默认值计算`、`› 恢复调用后从列表移除`、`› 加密空间条目锁定时标题占位`、`› 删除提示含"已移入回收站"与撤销（撤销即恢复）`、`trash-view.test.ts › 永久删除确认框文案写明条目+全部版本+不再被引用的附件`、`› 确认框不承诺删除快照文件`、`› 破坏性按钮需要二次确认`；
  - 手验：`pnpm dev` 下删除一条 → 回收站恢复 → 再永久删除；一次选 12 条验证拆成 2 个请求（Network 面板）。

### M4-13 验收与收口（**→ v0.5.0**）

- **目标**：走查《功能拆解 v2.5》M05 / M10 / M11 / M12 的逐条口径，线上逐屏，五条命令全绿，收口出复核文档与版本。
- **动作**：
  1. **逐条走查**：M05-01~10、M10-01~03、M11-01~06、M12-01~04 共 23 条逐条给证据（用例名 / 截图 / 命令输出）；M10-03 的界面按设计 §3.6 记为"接口与 Cron 已就绪、界面留 M6"；
  2. **云端逐屏**：线上 `me.861306.xyz` 逐屏点验（补 M2/M3 遗留的云端逐屏项）——表格新建与列定义、图册、粘贴上传与缩略图、下载与 `Range`、版本列表 / diff / 恢复、回收站恢复 / 永久删除 / 清空、设置「版本与回收站」；
  3. **命令全绿**：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm check:size`；
  4. **迁移演练**：线上库从 0003 升到 0004（首个请求自愈建六表），并确认 `EXPECTED_SCHEMA_VERSION` 与 `app_meta.schema_version` 一致；
  5. **文档**：写收口复核文档（沿用 M2 的做法：逐条证据 + 偏离 + 未验证项）；执行设计 §九 的 `wiki/` 回写清单（**须先经用户点头**）；
  6. **CHANGELOG**：在顶部按当日小标题追加一条，一句话说明 M4 内容；
  7. **版本**：里程碑收口 → 根 `package.json` **`version` 改为 `0.5.0`**（M3 收口应为 v0.4.0，若 M3 未收口则本步顺延）；实施计划移入 `docs/archive/`。
- **验收**：走查表全绿或明确标注偏离；五条命令零失败；线上逐屏记录；CHANGELOG 与版本号一致（`pnpm --filter @menote/web test -- version-consistency` 通过）。

---

## 三、风险与未验证

| # | 风险 | 应对 |
|---|---|---|
| 1 | **Worker CPU 预算**：附件流式代理与版本快照（>256KB 不压缩）都是重活，架构 §14.2 的数字**全是估计值**，未在任何真实 Worker 上量过 | 附件请求体直写 R2、Worker 不缓冲不算哈希；服务端封存设 256KB 压缩门槛；M4-4/M4-5 落地后**立刻在线上量一次**（`observability` 已开），超预算先降"每轮 idle 封存 3 条"配额，再考虑移到客户端触发 |
| 2 | **D1 单请求 45 语句上限与"每批 10 条"的关系**：10 条 ×（`items` + `item_bodies` + `attachment_refs` + `item_versions` + `tombstones`）≈ 40–50 语句，贴边 | M4-6 的验收点直接断言"永久删除 10 条时语句数 ≤45"；逼近上限就**降到每批 8 条**（改一处共享常量），客户端分批逻辑不受影响 |
| 3 | **R2 禁用 `ListObjects`** 带来的孤儿检测约束：只能靠 `pending_uploads` + `attachment_refs` 反查，**扫不出"从未登记过"的对象** | 上传前先写 `pending_uploads`（`due_at = now + 24h`）堵住崩溃窗口；每日维护按 `due_at` 登记 `orphan`；已知残留：登记前就中断的极窄窗口会留垃圾对象，接受并用 M6 管理页的占用显示观察 |
| 4 | **大表渲染性能**：虚拟滚动、筛选排序、图册缩略图都可能拖慢主线程 | 逻辑放 `features/tables/model.ts` 纯函数并缓存派生结果；虚拟滚动先做 DOM 行数断言；2,000 行 × 20 列作为基线样例写进 M4-9 手验 |
| 5 | **缩略图在 Safari / HEIC 的兼容**：`OffscreenCanvas`、WebP 编码、HEIC 解码三处都可能缺 | 三级回退（`OffscreenCanvas` → `Canvas` → 文件图标），**任何情况下不阻塞原图上传**；HEIC 走文件图标并按 M10-01 口径实现；M4-10 用例覆盖回退分支，线上用 iPhone 实机补一次 |
| 6 | **墓碑协议变更对 M1 同步用例的回归面**：`next_cursor` 从两类改三类，牵动"整组回退 / 空类不参与 min"的既有断言 | 先改用例后改实现（TDD）；`sync.test.ts` 新增"某类为空不倒退"与"三类 min"两条；M4-7 提交前单独跑 `pnpm --filter @menote/worker test -- sync` 与 `pnpm --filter @menote/web test -- sync-pull` |
| 7 | **删除入口是破坏性操作**：M2 把删除整体推到 M4，删除 / 永久删除 / 清空三处文案与二次确认都在本程新增 | 文案分级：软删给"撤销"、永久删除与清空必须二次确认且**写明范围**（不承诺删快照）；不可逆说明保持**可见**（不进 `InfoHint`）；`trash-view.test.ts` 用断言兜住文案要点 |
| 8 | **`App.tsx` 与 `useNotesWorkspace.ts` 已接近 500 行预算**：M4 三块前端功能（表格 / 版本 / 回收站）都要往接线层加分支 | **动手前先规划拆分**（M4-9 起手第一步）：按架构 §2.3.3 把渲染分支与视图切换下沉到 `app/workarea/` 的子组件，接线层只留编排；拆分单独一次提交，不与功能混提 |
| 9 | **M4 四处依赖 M3 门禁（见 §一）**：M3 未落地时这四处只能写占位 | 开工前置把"M3 已落地"设为硬门禁；若排期倒挂，M4-5 / M4-10 / M4-11 / M4-12 相应验收点标"待 M3 就绪后补验"，不得默认通过 |
| 10 | **未验证**：R2 与 `triggers.crons` 均未在线上开通过，本地 miniflare 与生产行为可能有差（尤其 `Range`、`Cache-Control`、Cron 触发延迟） | 前置项要求先开通线上 R2 与建 bucket；M4-4 与 M4-8 完成后各做一次线上实测，结果写进收口复核文档的"未验证项"一节 |

---

## 四、交付物

1. **代码**：
   - `apps/worker`：迁移 `0004_content_integrity.ts`、自愈登记、`db/tables.ts` 常量、`adapters/r2.ts`、`services/attachments.ts` / `versions.ts` / `trash.ts` / `jobs.ts`、`jobs/gc.ts` / `maintenance.ts`、`routes/attachments.ts` / `versions.ts`、`routes/items.ts`+`sync.ts` 扩展；
   - `packages/mdcore`：`table.ts`（表格编解码、`_id`、十类型、转义、宽容解析）；
   - `packages/shared`：上限常量、同步载荷 `tombstones` 类型、版本与回收站设置字段、`reason` 中文映射；
   - `apps/web`：`features/tables/`、`features/attachments/`、`features/versions/`、`features/trash/`、设置「版本与回收站」分类、Dexie v5（`attachmentsMeta`）、删除入口与撤销；
   - 根 `wrangler.jsonc`：`r2_buckets` + `triggers.crons`。
2. **可体验的线上环境**：`me.861306.xyz` 上可完成的表格编辑、附件上传与下载、版本历史与恢复、回收站恢复与永久删除全流程。
3. **走查记录**：M4 收口复核文档（23 条功能点逐条证据 + 偏离 + 未验证项 + 云端逐屏记录）。
4. **CHANGELOG**：顶部当日小标题下追加一条（代码与文档分开提交）。
5. **版本**：根 `package.json` → **v0.5.0**（M4 收口；M3 收口应为 v0.4.0）。

---

## 五、需要用户点头的事项

| # | 事项 | 状态 |
|---|---|---|
| 1 | **《M4 设计》v1 的四条待拍板**（设计 §十）：① 缩略图改浏览器生成（否决 `media.worker`）② 附件管理页留 M6 ③ 版本回滚语义（覆盖当前稿 + 先封存 `keep=1` + `rev+1`、版本表不动、可再撤回）④ 附件不设硬配额 | ⬜ 待点头（设计稿整体确认即视为四条一并通过） |
| 2 | **《M4 界面稿》v1**（M4-1 的产出，8 组界面） | ⬜ 未创建；**硬前置**，确认前不写界面代码 |
| 3 | **线上开通 R2 并建 bucket**，根 `wrangler.jsonc` 加 `r2_buckets` 与 `triggers.crons` | ⬜ 待执行（Cron 属部署配置变更，设计 §7 已获原则点头） |
| 4 | **设计 §九 的 `wiki/` 回写清单**（架构 §5.1 / §5.2 / §八+§2.3.2 / §12.1–12.3、同步引擎设计 §3.2/§3.3/§五、功能拆解 M05/M10/M11/M12、设计文档 v7.6、`components.md`） | ⬜ 待点头，建议与 M4 开工同批（不改也能开工，口径以设计稿为准） |
| 5 | **前端接线层拆分**（`App.tsx` / `useNotesWorkspace.ts` 接近 500 行预算，详见 §三 风险 8） | ⬜ 待点头；同意即作为 M4-9 的独立前置提交 |
| 6 | **永久删除确认框的文案口径**（写明"条目 + 全部版本 + 不再被引用的附件"，**不承诺**删快照文件） | ⬜ 待点头；设计 §5.2 已给口径，落地前请确认措辞 |

# Menote 同步引擎设计 v1

| 项 | 值 |
|---|---|
| 文档版本 | v1.4 |
| 文档状态 | 生效（用户确认 2026-09-26：设计稿生效、登出不清除本机缓存、Valibot 引入、wiki 同步项 a–f 获批准） |
| 目的和适用范围 | 解掉 M1 的硬前置：`docs/modules/` 原先没有同步专项设计。本文定 M1 起可实现的同步协议、游标语义、outbox 与冲突规则，并明确 M1 / M2 / M4 的边界 |
| 权威级别 | 模块规则（同步与离线）。需求与接口形态以 `wiki/Menote-设计文档-v7.4.md` §15 与 `wiki/Menote-项目架构-v1.md` §6 为准；本文只在两处**已废弃内容**上给出净化后的口径（§2） |
| 最后更新日期 | 2026-09-26 |

修改记录：

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型 |
|---|---|---|---|---|
| v1 | v0.1.2 | 2026-09-26 | 初稿：协议与载荷、游标与分页语义、outbox/退避、条件 batch 写入模式、冲突与幂等、测试用例、M1 最小集边界 | deepseek-v4.1-flash |
| v1.1 | v0.1.3 | 2026-09-26 | 状态改「生效」；据实测与独立复核修正（条件写改为带双守卫的 upsert、判定改读 `results[0]`、分页游标取两类末端较小值、`too_large` 改 413、补 `tags?`、引注改章节号）；M1/M2 边界统一 | deepseek-v4.1-flash |
| v1.2 | v0.1.6 | 2026-09-26 | M1-5 落地回写：新增 §3.5（文件夹接口、应答形状、新建状态码、服务端不重算哈希的取舍、413 超限、正文行缺失的 upsert 分支） | deepseek-v4.1-flash |
| v1.3 | v0.1.7 | 2026-09-26 | M1-6 落地回写：`full_resync` 条件收紧为 `cursor > 0` 且 `< tombstone_floor`（否则游标 0 会死循环）；§3.3 补"某类没有新行时不参与 `next_cursor` 的 min"（实测出现过的原地打转问题） | deepseek-v4.1-flash |
| v1.4 | v0.1.9 | 2026-09-26 | M1-8 落地回写：新增 §4.8（草稿清理顺序、`full_resync` 只清已同步内容、失败列表哨兵、元数据冲突胜者、冲突副本、退避上限、无 Web Locks 的退化） | deepseek-v4.1-flash |

---

## 一、一句话模型

服务端每个用户一个单调计数器 `users.sync_seq`；每次写入把新序号写进受影响的行；客户端只维护**一个游标**，用 `sync_seq > 游标` 增量拉元数据，正文按需另取；本地写入先进 Dexie + outbox，由"同步主标签页"按队列推送，冲突以 `rev` 条件写判定、以 `content_hash` 区分"真冲突"与"响应丢失"。

---

## 二、先净化：架构文档里两处 v1.0 遗留（本文不实现）

| 位置 | 遗留内容 | 处理 |
|---|---|---|
| 架构 §6.1 拉取接口说明 | 拉取实体清单里含"**数据密钥**" | **删除**。v1.1 模型修订已取消 DEK / 数据密钥层级（架构 §7 章首修订声明、§7.2、§7.4）。M1 拉取实体只有条目与文件夹 |
| 架构 §6.3 outbox 实体枚举 | 含 `key` 实体 | **删除**。outbox 实体集合 = `item` / `folder` /（M2 起）`setting` /（M4 起）`attachment` / `version` |

保留的实体与列名不动：`items.in_enc_space`、`items.enc_self`（架构 §7.1 原文："仅携带标记：`in_enc_space = 1` 或 `enc_self = 1`（字段名沿用需求 DDL，不改名）"）。**隐私锁（M3）不引入任何新的同步实体**——它只读写 `items` 上已有的两个标记列，加上 `user_crypto`。这是一个有用的结论：**M3 不阻塞也不会改动 M1 定下的同步协议**。

> `user_crypto` 的 verifier 如何到端：架构 §5.1 的补充表给 `user_crypto` 加了 `sync_seq`（即走增量同步）、§7.2 说 verifier 用于"多设备门禁校验"。但架构 §5.1 那一行本身标着**【待确认】**，且把密钥材料放进普通同步载荷需要单独评估。**M1 不实现**，M3 开工前在《隐私锁》专项设计里定（专用 `GET` 还是并入 sync），列为待确认（见 §7）。

> **同步落地情况（用户已批准 2026-09-26）**：上表两条遗留已从架构文档删除（§6.1 拉取实体清单、§6.3 的 outbox `key` 实体），架构升 v1.9。

---

## 三、接口契约（M1 实现的子集）

### 3.1 接口清单

| 方向 | 接口 | M1 | 说明 |
|---|---|---|---|
| 拉取元数据 | `GET /api/sync?cursor=N` | ✅ | 只返回 `sync_seq > N` 的**元数据**，不含正文 |
| 取正文 | `GET /api/items/:id/body` | ✅ | `Content-Type: text/markdown`；`ETag: <content_hash>`；`If-None-Match` 命中返回 304 |
| 新建（客户端生成 ID） | `PUT /api/items/:id` | ✅ | 请求体 = 正文原文；元数据在 `X-Menote-Meta`（base64url JSON）；重复提交幂等 |
| 全文保存 | `PUT /api/items/:id/body` | ✅ | `If-Match: <base_rev>`、`X-Menote-Hash` |
| 元数据更新 | `PATCH /api/items/:id/meta` | ✅ | `{ base_meta_rev, title?, folder_id?, tags?, pinned?, starred? }`，逐字段独立判定冲突 |
| 增量补丁保存 | `PATCH /api/items/:id/body` | ⏳ M1 收尾 | `{ base_rev, ops:[[start,end,text]], hash, bytes, chars }`，位置按**码点**计；≥64 KB 且改动小才用 |
| 批量元数据 | `POST /api/batch` | ⏳ M1 收尾 | 多操作一请求，逐个独立判定冲突；单批语句 ≤45 条 |
| 回收站 | `POST /api/items/:id/trash` / `/restore` | ⏳ M1 收尾 | 软删。M1 的删除只需 `deleted_at` + `sync_seq` 变化即可传播 |
| 永久删除 | `DELETE /api/items/:id` | ❌ M4 | 需要墓碑表，M4 随回收站一起做 |

### 3.2 拉取载荷

```jsonc
{
  "items": [
    // items 表除 user_id 外的全部列 + 计算字段 deleted(= deleted_at != null)
  ],
  "folders": [ /* folders 表除 user_id 外的全部列 */ ],
  "next_cursor": 412,
  "has_more": false,
  "full_resync": false
}
```

- **只回元数据**，保证首屏只需"元数据增量 + 当前条目"（架构 §6.1 设计要点）。
- 每类**合计最多 200 行**（M1 具体为 items ≤200、folders ≤200），超出置 `has_more: true`。
- 删除信号：软删行的 `deleted_at` 随增量下发，客户端据此标记本地删除。**M1 不需要墓碑表**——墓碑只为"行被物理删除"服务，而 M1 没有永久删除（见《数据模型与迁移设计》§3.4）。
- `full_resync: true` 的条件：**`cursor > 0` 且 `cursor < users.tombstone_floor`**。M1 该列恒为 0，所以 M1 永不触发；客户端**必须**实现该分支（收到后清空本地条目/文件夹与正文缓存，从 cursor=0 重建，outbox 中未上传的改动先导出为本地备份文件）。
  - 为什么必须排除 `cursor = 0`：0 本身就是"从头拉"，若 `0 < floor` 也算 `full_resync`，客户端会被永久钉在"重建"状态（拉 0 → 又是 full_resync）——**死循环**。服务端此时返回 `next_cursor: 0`，明确让客户端从零开始重建。

### 3.3 游标与分页（易错点，必须按此实现）

- 游标 = `sync_seq` 整数值，**items 与 folders 共用同一序列**，客户端只推进一个游标（架构 §6.1 设计要点）。
- **约束：一个逻辑写操作影响的所有行共享同一个 `sync_seq`。**
- **分页不得把同一 `sync_seq` 的组切开**：每类各取 ≤200 行后若被截断，把末尾与最后一条同 `sync_seq` 的行整组回退，得到本类的末端序号；**`next_cursor` 取两类末端序号的较小值（`min(items 末端, folders 末端)`）**。
  - 为什么必须取 min：items 与 folders 是两次独立查询，截断点不同。若取 items 的末端作为游标，folders 落在两者之间区间、而本次没被取回的行会被**永久跳过**（下次查询条件变成 `sync_seq > 该游标`）。
  - **某类本次没有新行时，它不参与 min**（实现上取 `+∞`）。否则"空的那一类"末端会被算成当前游标，`min` 直接把游标拖回原地，客户端永远推进不了（M1 实测踩到过）。
  - 只推进到 min 的代价是下一轮会重复返回一部分行——upsert 按 `id` 幂等，重复无害。
  - 若某一组本身就超过 200 行（M1/M2 不可能：单次逻辑写只影响 1 行；M4 的批量标记届时把上限写进该接口的约束），返回 **413 `too_large`**（架构 §4.3 的错误码表里 413 才是 `too_large`，422 是 `invalid`）而非死循环。
- 查询形状：`SELECT ... FROM items WHERE user_id = ? AND sync_seq > ? ORDER BY sync_seq LIMIT 201`（多取 1 条判 `has_more`）。

### 3.4 服务端写入：条件 batch 模式

D1 没有跨语句事务 API，只有 `batch()`（单事务）。**所有写操作必须用一个 batch，且副作用语句挂在主写入"条件生效"之上**，否则冲突时会写脏数据。范式来自需求 §18.3（mutation guard），本文只做两处加固：① 计数器用"条件推进"而不是先取号；② 正文写入用带守卫的 upsert，兼容"正文行还不存在"的情况。**以下语句已在 SQLite 上实测跑通（见《数据模型与迁移设计》§3.2 末注）。**

顺序：**预检读 → 一个 batch（3 条语句）**。

```text
-- 0) batch 之前：预检（1 次 D1 读）
SELECT rev, content_hash FROM items WHERE id = :id AND user_id = :uid;
  无行                          → 走"新建"路径
  rev == :base_rev              → 走保存 batch
  rev != :base_rev 且 hash 相同  → 判为"上次已成功"（响应丢失），直接 200，不写库
  rev != :base_rev 且 hash 不同  → 直接 409 rev_conflict，不写库
```

```sql
-- 1) 主写入（mutation guard）：rev 条件；sync_seq 取"将要写入的值"，此刻不推进计数器
UPDATE items
   SET rev = rev + 1, size_bytes = :bytes, content_hash = :hash,
       updated_at = :now, last_edit_at = :now, last_device = :device,
       sync_seq = (SELECT sync_seq + 1 FROM users WHERE id = :uid)
 WHERE id = :id AND user_id = :uid AND rev = :base_rev;

-- 2) 正文：守卫 = rev 与 content_hash 双条件；upsert 兼容"正文行尚不存在"
INSERT INTO item_bodies (item_id, body)
SELECT :id, :body
 WHERE EXISTS (SELECT 1 FROM items
                WHERE id = :id AND user_id = :uid
                  AND rev = :base_rev + 1 AND content_hash = :hash)
ON CONFLICT(item_id) DO UPDATE SET body = excluded.body;

-- 3) 计数器：只在主写入确实生效时推进
UPDATE users SET sync_seq = sync_seq + 1
 WHERE id = :uid
   AND EXISTS (SELECT 1 FROM items WHERE id = :id AND rev = :base_rev + 1 AND content_hash = :hash);
```

- 判定：读 `results[0].meta.changes`（**第 1 条语句**的影响行数）。为 1 → 200，返回 `{ rev: base_rev + 1, bytes, chars }`；为 0 → 409 `rev_conflict`，载荷带服务端当前 `rev` 与 `content_hash`（预检已经排除了"重放成功"与"条目不存在"两种情形）。
- **为什么正文守卫必须带 `content_hash`**：只判 `rev = base_rev + 1` 时，两个并发保存都带 `base_rev = 1`，先到者把 `rev` 推到 2；后到者的主写入影响 0 行（正确地冲突），但它的正文守卫**成立**，于是落败者的正文覆盖了已提交的版本。已在 SQLite 上做出反例验证（《数据模型与迁移设计》§3.2 末注）。带上 `content_hash` 后：内容不同 → 不写；内容相同 → 写入相同字节，无害。
- **为什么用带守卫的 `INSERT ... ON CONFLICT` 而不是需求 §18.3 的裸 `UPDATE item_bodies`**：需求写法假定正文行一定存在；`ON CONFLICT(item_id) DO UPDATE` 在守卫通过时对"行存在"与"行缺失"两种情形都正确，守卫不通过时 `SELECT` 不产生行、什么也不写。
- **为什么正文用 `INSERT ... SELECT` 而非先 `UPDATE` 再补 `INSERT`**：`item_id` 是主键，对已存在条目直接 `INSERT` 会抛主键冲突，整个 batch 回滚成 500——这正是必须用 upsert 的原因（已实测：裸 `INSERT` 在重放与并发冲突路径上会 500）。
- **新建路径（`PUT /api/items/:id`，客户端生成 ID）**：`INSERT INTO items (...) SELECT ... WHERE NOT EXISTS (SELECT 1 FROM items WHERE id = :id)`，随后同样用带守卫的正文 upsert。
  - **这里的 `NOT EXISTS` 故意只判 `id`、不带 `user_id`**，与本设计"每条 SQL 都带 `user_id`"的规则不矛盾：`id` 是全局主键，若同一 `id` 已属于他人，带 `user_id` 的 `NOT EXISTS` 会返回 true，接着插入就会撞主键异常；只判 `id` 则安静地不插入，随后 `SELECT ... WHERE id = ? AND user_id = ?` 查不到行 → **404**（不泄露他人条目存在性，也不 500）。已实测。
- 每条**查询/修改用户数据**的 SQL 必须带 `user_id` 条件（架构 §13.2）。单次写入 3 条语句，远低于 45 条上限。
- **本条是本设计最需要在 M1 用集成测试钉死的部分**（架构 §15.1 已把"条件 batch 与冲突判定"列为必测）。

### 3.5 M1 落地补充（实现回写 2026-09-26）

| 项 | 结论 |
|---|---|
| 文件夹接口 | 补 `POST /api/folders`（`{ id, parent_id, name }`，ID 由客户端生成，层级上限 2 层）与 `PATCH /api/folders/:id`（`{ base_meta_rev, name?, parent_id? }`）。原 §3.1 只列了条目接口，但 M1 的拉取要回文件夹、条目要能归档，创建/改名/移动是必需的 |
| 应答形状 | 新建与全文保存 → `{ id, rev, bytes, chars }`（`bytes`/`chars` 为服务端实测，供客户端核对）；元数据补丁 → `{ id, meta_rev }`；文件夹写 → `{ id, meta_rev }`。**不含 `sync_seq`**：游标由拉取推进，写应答不必回带 |
| 新建的状态码 | 重复提交（同 id 同哈希）返回 **200**（PUT 语义），不返回 201——客户端只关心 `rev` |
| 服务端不重算内容哈希 | `content_hash` 由客户端计算，服务端**不校验**它与正文是否一致：省掉大文档上的一次 SHA-256（10 ms CPU 预算内更稳），代价是哈希正确性由客户端保证。若后续真出现"哈希与正文不符"的问题，再补校验（或仅在 < 64 KB 时校验） |
| 大小超限 | 服务端在写库前用 `utf8ByteLength` 判 `> 1,900,000` 直接返回 **413 `too_large`**，不依赖 DB CHECK 报错（约束失败会变成 500） |
| 正文行缺失 | 保存路径用带守卫的 upsert，正文行缺失时由 INSERT 分支补回，不会因主键冲突整批回滚 |
- **已知精度缺陷**：第 3 条计数器的守卫只能判"当前状态是否等于本次写入后的状态"，无法区分"本次生效"与"上次已生效"。上面的预检挡掉了绝大多数重放，但"预检通过后又被并发抢先"的窗口仍会让计数器空推一格。空洞对游标协议无害，根治办法见《数据模型与迁移设计》§3.5。

---

## 四、客户端：本地库、outbox 与推送
### 4.1 Dexie 表（M1 子集，落 `data/db/`）

| 表 | 主键 / 索引 | M1 内容 |
|---|---|---|
| `items` | `id`；`[folderId+updatedAt]`、`syncSeq` | 与服务端 `items` 同构的元数据 + `pendingOp`（无待上传时为 null） |
| `bodies` | `itemId` | 正文缓存：`{ itemId, body, rev, contentHash }` |
| `drafts` | `itemId` | 未上传编辑稿（**每 2 秒写一次**，与上传节奏无关） |
| `folders` | `id`；`parentId`、`syncSeq` | 文件夹树 |
| `outbox` | 自增 `seq`；`[entity+entityId]` | 待上传操作 |
| `syncState` | 单行 | `{ cursor, lastSyncAt, deviceId }` |

M2 增加 `settings` 与 `searchIndex`；M3 增加 `privacyState`。Dexie 版本号随客户端发布递增；本地库可清空重建（清空前把 outbox 未上传项导出为本地文件）。

### 4.2 outbox 记录与合并

```
{ seq, entity, entityId, op, baseRev, payload, retries, nextRetryAt, lastError }
```

- 载荷引用：正文**不复制**，指向 `drafts`（架构 §6.3）。
- 合并规则：同一条目的正文保存**只保留最新一份，并保留最早的 `baseRev`**；连续补丁合并为一个，合并后超过正文 25% 或超过 20 个操作时改为全文。
- 依赖顺序：新建文件夹先于移入该文件夹的条目（M2 才需要）；附件上传先于引用它的正文保存（M4）。
- 退避：单请求超时 **15 秒**（`AbortController`）；失败按 1/2/4/8…秒指数退避 + 抖动，**上限 60 秒**；`online` 事件与标签页重新可见时立即重试。
- 持续失败（如 422/400）移入"上传失败"列表，可手动重试，**不阻塞队列其他项**（M1 只需最小列表，UI 可在 M2 补全）。

### 4.3 触发时机（M13-02）

应用打开、写入成功后、标签页重新可见、网络恢复、前台每 5 分钟一次。**不做实时推送**（需求 §15.2）。

### 4.4 多标签页（M13-03，M1 只做选主）

- `navigator.locks.request('menote-sync', …)` 选出唯一同步主标签页；其他标签页只写本地 Dexie 与 outbox。**M1 必须有选主**，否则两个标签页会互相覆盖。
- BroadcastChannel 的"某条目已更新""游标已推进"广播与"已在其他标签页修改"提示 → M1 收尾。
- 同一条目在两个标签页同时编辑时以 `drafts` 为准，后写入者收到广播后提示，**不静默覆盖编辑器内容**。

### 4.5 拉取算法

```text
cursor ← syncState.cursor
loop
  GET /api/sync?cursor=cursor
  if full_resync: 导出未上传改动 → 清空本地 → cursor ← 0 → continue
  upsert items / folders：
    若本地该条目在 outbox 中有待上传项 → 只更新元数据，保留本地正文与草稿，并标记"待处理冲突"
    否则 → 更新元数据、rev、contentHash，并使正文缓存失效（contentHash 变化时）
  cursor ← next_cursor
while has_more
syncState.cursor ← cursor
```

拉取完成后，对"已打开过的条目"以并发 3–4 拉正文（架构 §6.1 设计要点）；"全部离线缓存"开关属 M2/Q21。

### 4.6 保存路径与冲突处理

```text
编辑器输入
  → 每 2s 写 drafts（始终）
  → 停止输入 2s（正文 >256KB 时 5s；持续输入最长 30s / 60s）→ 写 outbox（合并，保留最早 baseRev）
同步主标签页取队首
  → M1 一律 PUT /api/items/:id/body（全文）
  → 200：删 outbox 项、更新本地 rev/contentHash
  → 409 rev_conflict：
        服务端 content_hash == 本地待上传内容 hash → 视为已成功（上次响应丢失）
        否则 → 取服务端正文采纳为原条目当前稿；
               本地内容另存为**冲突副本**（新 UUIDv7，标题「原标题（冲突副本 时间 · 设备名）」，
               同一文件夹，走 PUT /api/items/:id 新建）→ Toast 提示
  → 网络错/5xx：退避重试
```

- 元数据冲突（`meta_rev`）**不生成副本**：后写覆盖，界面只提示"已在其他设备更新"（拆解 M13-04）。
- 服务端的"重放 vs 真冲突"由 §3.4 的**预检读**在写库之前判定：`rev != base_rev` 且 `content_hash` 相同 → 直接 200，不写库（同时避免计数器空推）；哈希不同 → 直接 409。客户端侧只需按 409 载荷里的 `content_hash` 做同一判断。
- 服务端在返回 409 之前把当前正文封存为版本（原因 `conflict`，≤256 KB 时压缩，同一条目 10 分钟内最多一次）→ **M4 与版本历史一起实现**；M1 返回 409 时不做封存（`sealed_rev` 保持 NULL）。
- "对比两者 / 保留某一份"的完整界面 → M2（M1 只做副本 + Toast）。

### 4.7 幂等与响应丢失

- 新建用客户端生成的 **UUIDv7/ULID**，重复 `PUT /api/items/:id` 由服务端 `NOT EXISTS` 判定 + `content_hash` 比较处理。
- 保存重试恒带同一 `base_rev`；服务端 409 时客户端用 `content_hash` 区分"真冲突"与"上次其实已成功"。
- outbox 合并**必须保留最早的 `baseRev`**，否则会把服务端已有版本误判为冲突。

### 4.8 M1 落地补充（实现回写 2026-09-26）

| 项 | 结论 |
|---|---|
| 上传成功后如何清草稿 | **只有草稿正文与刚上传的内容一致才清**；不一致（用户在飞行期间又敲了字）则立刻 `enqueueBodySave` 再排一次——否则会停在"有草稿但没入队"的悬空状态。实现时踩到过一次：**必须先把队列项出队、再判断草稿**，否则紧接着的入队会被"队列里还有这一条"合并规则挡住 |
| `full_resync` 的本地清理 | 只清 `pending === null` 的条目/文件夹与它们的正文缓存，**保留未上传的条目、正文与草稿**。设计稿 v1 说的"导出为本地备份文件"是 M5 的导出模块；M1 用"不删未上传项"达到同一目的 |
| 不可重试错误的"失败列表" | 复用 outbox 行：`next_retry_at` 置为哨兵值 `MAX_SAFE_INTEGER`、`last_error` 记原因。该行**不再被队首选中**（不阻塞其他项），但仍在 `listOutbox()` 里可见，M2 的手动重试把它重置即可 |
| 元数据冲突的胜者 | `meta_conflict` **不生成副本**，服务端版本胜出：本地清 `pending`、按 `detail.meta_rev` 更新版本号，下一次拉取把新值带下来 |
| 冲突副本 | 标题为「原标题（冲突副本 MM-DD HH:mm · 设备名）」；副本自己入队一条 `create`；原条目采纳服务端版本并**使正文缓存失效**（下次按需重取）。M1 只做「副本 + 提示」，"对比两者 / 保留某一份"界面属 M2 |
| 退避抖动 | 指数部分先封顶 60 秒，再叠 ±20% 抖动，最后再兜一次 60 秒上限——**上抖动不能越过 60 秒** |
| 没有 Web Locks 的环境 | 退化为直接执行（单标签页场景行为一致）；Node 测试环境即走这条分支 |
| **引擎的生命周期只随登录状态**（M1-11 浏览器走查回写） | 启动引擎的 effect **只能依赖登录状态**，回调经 `ref` 间接调用。反例：把 `refreshAll` 直接放进依赖数组，而它会 `setItems(...)` 写入新数组 → 重渲染 → 依赖身份变化 → effect 重跑 → 引擎被 stop/create/start → 立刻又跑一轮 → **请求风暴**（实测 10 秒 35 次 `GET /api/sync`）。同理，`useNotesWorkspace` 的返回值必须 memo，否则调用方 effect 依赖每次渲染都变 |
| **编辑器保存态每 tick 自愈，且顺序是"先对齐、再决定写草稿/入队"**（M1-11 回写） | 状态不能只靠"引擎跑完回调 App 再通知控制器"这条链：链上任何一处静默失败（例如被 `void` 掉的 rejected promise）都会让状态卡在"待上传"，而 tick 仍每 2 秒入队一次 → **无限重传同一份内容**（实测 rev 从 405 涨到 483，内容一字未改）。改成控制器在每个 tick 开头自行按本地库 + `content_hash` 对齐；顺序反了（先写草稿再对齐）同样会退化成重传 |
| 保存态的判据（同一处） | ① 本地有未上传痕迹（`items.pending` 或草稿）→ 待上传/已达硬上限；② 本地干净但内存有改动：与服务端记录的 `content_hash` 一致 → 已同步；不一致 → **先落草稿再入队**（绝不能丢，否则打字内容永远不上传） |
| 浏览器走查的验收口径（M1-11） | 空闲时**不应有任何 API 请求**（HAR 实测 0 请求才算过）；写一次正文只应产生 **1 个 PUT**；顶栏胶囊与正文状态栏不得自相矛盾 |
| 服务端不可达时的行为（M1-11 实测 2026-09-26） | 请求失败（连接被拒）→ 队列项留队、`retries` 递增、`last_error` 记"无法连接服务器，请检查网络后重试"，草稿**保留在本地**（实测 72 字符草稿未丢）；顶栏胶囊显示**同步失败**、状态栏显示**待上传**；服务端恢复后按退避时间自动补传成功（本地 `pending=null`、草稿清空、队列清空，服务端正文含离线期间敲入的内容）。期间页面还重载过一次，内容依然补传成功 |
| 停在失败列表的条目如何显示（M1-11 补充） | 队列项被置为哨兵时间（不可重试）后，**状态栏必须显示"上传失败"**而不是一直"待上传"——否则用户以为还在传，实际它再也不会自己传。M1 只提示，手动重试界面属 M2 |

---

## 五、M1 / M2 / M4 边界（避免范围蔓延）

| 能力 | M1 | M2 | M4 |
|---|---|---|---|
| 拉取 items + folders 元数据 | ✅ | | |
| 拉取 `user_settings` | | ✅（设置页落地时） | |
| 正文按需取 + 已打开过的缓存 | ✅ | | |
| 新建 / 全文保存 / 元数据更新 | ✅ | | |
| 增量补丁、`POST /api/batch`、trash/restore | M1 收尾（清单同时列在 M1 计划 M1-12 与 M2 计划 M2-9，实际做在哪一步由当时排期决定） | 若 M1 未做完则顺延 | |
| 冲突副本生成 | ✅ | 完整对比 UI（"对比两者 / 保留某一份"） | |
| 多标签页选主 | ✅ | BroadcastChannel 通知 | |
| 墓碑、`full_resync` 真实触发、永久删除 | ❌ | ❌ | ✅ |
| 附件元数据、版本元数据同步、封存 conflict 版本 | ❌ | ❌ | ✅ |
| "全部离线缓存"开关 | ❌ | ✅（设置 › 通用） | |

---

## 六、必测用例（同步正确性 = M1 起最大风险）

| # | 用例 | 断言 |
|---|---|---|
| 1 | 幂等重放 | 同一 `PUT /api/items/:id` 两次 → 库里 1 行、`rev` 不增、第二次返回 200 |
| 2 | 响应丢失 | 保存成功后用旧 `base_rev` 重发 → 409，且载荷 `content_hash` == 本地 hash → 客户端判成功、outbox 清空 |
| 3 | 真冲突 | 双端并发编辑 → 后到者 409；客户端生成副本条目（新 id、标题含"冲突副本"），原条目保留服务端版本 |
| 4 | 元数据冲突不产生副本 | `meta_rev` 过期 → 409 `meta_conflict`，条目数不变 |
| 5 | 游标不漏拉 | 写入 N 条后分页拉取（items 与 folders 混合）→ 客户端集合与服务端逐一相等；同一 `sync_seq` 组不被切开 |
| 6 | 软删传播 | A 软删条目 → B 增量拉取后本地 `deleted_at` 非空 |
| 7 | 多用户隔离 | A 的游标与 token 拿不到 B 的任何行（含 404 而非 403 的信息泄露面） |
| 8 | 退避与恢复 | 连续 3 次 5xx → 重试间隔 1/2/4 秒（fake timers）；`online` 事件立即重试 |
| 9 | 选主 | 两个标签页上下文只有一个在推拉（Web Locks） |
| 10 | `full_resync` 分支 | 人为把 `tombstone_floor` 设为大于客户端游标 → 客户端清空重建 |
| 11 | **并发保存的正文覆盖竞态** | 两个请求同带 `base_rev = 1`、内容不同、并发发出 → 只有一个 200；另一个 409；**胜者写入的正文与 `items.rev`/`content_hash` 三者一致**（失败者不得覆盖正文） |
| 12 | `sync_seq` 与行的一致性 | 保存成功后 `items.sync_seq` == `users.sync_seq`；同一 batch 内不再多分配 |
| 13 | **重放不推进计数器** | 保存成功后再用同一 `base_rev` + 同一 `hash` 提交 → 预检判为"已成功"、返回 200、**`users.sync_seq` 不变**、`item_bodies` 未重写 |
| 14 | 正文行缺失时的保存 | 人为删掉 `item_bodies` 行后保存 → 守卫通过时靠 `ON CONFLICT` 之外的 INSERT 分支补回正文，不报主键冲突 |

用例 1–5、7 在 `@cloudflare/vitest-pool-workers` 里用真实 workerd + 本地 D1 跑（架构 §15.1）；用例 8–10 属前端数据层，M1 用 Vitest + `fake-indexeddb` 覆盖，端到端（Playwright）在 M6 前补齐。

---

## 七、待确认

| # | 项 | 建议 |
|---|---|---|
| 1 | 冲突副本标题里的"时间"格式与"设备名"来源 | 用条目 `updated_at` 的本地时间 `MM-DD HH:mm`；设备名取 `syncState.deviceId` 首次生成时记录的浏览器平台串，可设置里改（M2） |
| 2 | `full_resync` 时"导出为本地备份文件"的格式 | M1 简化为导出 JSON（items+folders+outbox），M5 复用导出模块重做 |
| 3 | 前台定时同步间隔（需求只说"每几分钟"） | **5 分钟**（本文决定，实现处集中成常量便于调） |
| 4 | 409 载荷是否带服务端正文 | 不带（正文另取 `GET /api/items/:id/body`），保持 409 载荷小 |
| 5 | `X-Menote-Meta` 的 base64url JSON 是否需要 schema 校验 | 需要；`packages/shared` 用 Valibot 定义并两端复用（M1 引入 Valibot 依赖） |
| 6 | `user_crypto` 的 verifier 怎么到端（架构 §5.1 给它加了 `sync_seq`，那一行本身标【待确认】） | M1 不实现，M3 前在《隐私锁》专项设计里定：专用 `GET /api/crypto/verifier`（推荐，密钥材料不混进普通同步载荷）或并入 `GET /api/sync` |

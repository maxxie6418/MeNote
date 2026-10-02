# Menote 备份与导出设计 v1（文档版本 v5）

| 项 | 值 |
|---|---|
| 文档版本 | v5 |
| 文档状态 | 生效（导出 / 导入 / 设置页 / 回收站条目的服务端还原均已落地；冲突预览经用户拍板不做，见 §五 / §八-2） |
| 目的和适用范围 | M5 的「备份 / 导出 / 导入」：**备份包长什么样、谁来生成、怎么恢复、重复导入会不会刷出重复条目**。本文定格式契约与取舍，不含界面稿；界面另走「界面怎么做」。产品口径见 `wiki/Menote-功能拆解-v2` M06/M07（**只读，不改**） |
| 权威级别 | 模块规则（格式契约另需回写 `wiki/`，见 §九） |
| 最后更新日期 | 2026-10-02 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.6.8 | 2026-10-01 | 初版。参照外部项目 inkstone 的备份做法（`COMPLETE` 提交标记、内容寻址附件），结合 MeNote 实际的离线优先 + outbox 架构重新设计幂等方案 | MiniMax-M3.1-Flash-Preview |
| v2 | v0.6.9 | 2026-10-01 | 导出/导入/设置页三批落地后回写：新增 §4.1（第三处被推翻的判断——`createLocalItem` 不能用，另写 `restoreLocalItem`）与 §4.2（回收站条目在服务端要补一次软删）、补全 §七 落点与 §八 待办、记录 zip 库选型 | MiniMax-M3.1-Flash-Preview |
| v3 | v0.6.10 | 2026-10-02 | §4.2 的软删时序已落地（v0.6.10）：outbox 新增 `trash_item` 操作，回收站条目按「`create` → `trash_item`」入队，推送器以本地为准补服务端软删；§4.2 与 §八-1 改写为实施结果，更正 §4.2 原写的端点路径（实际是 `DELETE /api/items/:id`） | GLM-5.3-Flash |
| v4 | v0.6.11 | 2026-10-02 | 冲突预览经用户拍板**不做**：§五与 §八-2 改写为定论（维持既有 rev_conflict → 另存副本链路），新增导入结果 `itemsOverwritten`（与本机内容不同被覆盖的条目数）；二次确认弹窗补覆盖说明并修掉会被原样渲染的 `**` 标记 | GLM-5.3-Flash |
| v5 | v0.6.12 | 2026-10-02 | 单篇导出落地（M15，用户拍板做、附件可选）：§七 落点表补 `export-note.ts`——`.md` 逐字、草稿优先、可选附件按备份布局打包（哈希不符整次失败）；入口在笔记「更多」菜单，锁定态禁用并说明 | GLM-5.3-Flash |

---

## 一、结论

1. **备份 = zip，内层是明文目录**。zip 解决"往哪儿放"（WebDAV / S3 / 邮箱 / U 盘），内层明文解决"不依赖我们的 app 就能读"。
2. **`COMPLETE` 提交标记**：只认哈希对得上的完整快照，半截包直接拒收。这是本设计里最该抄的一条。
3. **导出在客户端**：数据本来就在 IndexedDB，不占 Worker 的 CPU/内存配额。
4. **导入复用现有 outbox 推流，不新建 `import_mappings` 表**——见 §五，这是本设计相对 inkstone 的最大简化。
5. **绝不导出密钥材料**，加密条目的密文原样搬运。

## 二、包结构

```text
menote-backup-<UTC 时间戳>.zip
└─ snapshot/
   ├─ manifest.json      格式版本、app 版本、导出时刻、条目索引、附件索引
   ├─ notes/<id>.md      一篇一个文件；front matter 与正文原样，不改一个字
   ├─ folders.json       文件夹树
   ├─ attachments/<sha256>--<文件名>
   ├─ settings.json      用户设置
   └─ COMPLETE           manifest.json 的 SHA-256
```

### 2.1 元数据分两层（**这是本文最关键的一处设计**）

初稿曾想把 `folder_id` / `memo_at` / `pinned` 一股脑塞进 `.md` 的 front matter。**核对后否掉了**：`mdcore` 的 `MenoteMeta` 只有 `type` / `tags` / `task` / `convertedTo` / `preservedLines`（`packages/mdcore/src/frontmatter.ts:27-41`），塞不进去；而硬塞进去的结果是那些 `.md` 文件不再是"一篇正常的笔记"，人工恢复的路子也就没了。

改为：

| 层 | 放什么 | 理由 |
|---|---|---|
| `.md` 自己的 front matter | **原样，一个字不改**（`preservedLines` 保证表格的 `columns` / `views` 等未知键往返无损） | 这份 `.md` **就是这篇笔记**。用户能用任何编辑器看、能 grep、能进 git；**也能直接拖回 MeNote 当笔记打开**——这是人工恢复的救命路子 |
| `manifest.json` 的条目索引 | `id` / `folder_id` / `memo_at` / `pinned` / `starred` / `created_at` / `updated_at` / `deleted_at` / `enc_self` / `in_enc_space` / `content_hash` / `size_bytes` / `rev`，以及该文件的 `path` + `sha256` | 库侧状态集中在一处，可校验、可 diff、可比大小 |

### 2.2 `COMPLETE` 标记

内容是一行纯文本：

```text
menote-backup v1
manifest-sha256 <64 位十六进制>
```

**只有它存在、且哈希与解出来的 `manifest.json` 对得上，才算完整快照**；否则导入方直接拒绝该快照。多个快照共存时取最新的**完整**者，半截的跳过并给可见警告。zip 内 `COMPLETE` 放在**最后一个条目**，解包到一半不会有它。

### 2.3 附件内容寻址

路径固定为 `attachments/<sha256>--<原文件名>`。同一张图被十篇引用只存一份，且改名不影响去重。导入时逐个校验 `bytes` + `sha256`。

### 2.4 路径安全

manifest 里的每个 `path` 在读盘前都要过一遍：拒绝绝对路径、拒绝 `..`、拒绝盘符、拒绝反斜杠；归一化后必须仍落在 `snapshot/` 内。

## 三、导出（客户端）

- 数据源是 IndexedDB（`data/db`），**不是**服务端接口——离线也能导出。
- 正文取 `getEditableBody`（**优先未上传草稿**），否则导出会丢掉用户刚敲还没同步的内容。
- 附件逐个走 `/api/attachments/h/<sha256>` 下载。
- 全量导出在浏览器里会慢，**必须有可见进度与可中断**（`DESIGN.md` §5.4-3：实时状态必须可见）。

## 四、导入

导入**不是**"把文件塞进数据库"，而是**把备份还原成一次正常的创建动作**：

1. 校验 `COMPLETE` 与 `manifest.json`；不合格直接拒收并说明原因。
2. 逐个文件校验 `bytes` + `sha256`；附件重算哈希比对。
3. 对每条：写本地行（`features/backup/restore.ts` 的 `restoreLocalItem`）+ `enqueue`，**然后照常走 outbox 推流**。
4. 文件夹同理：`createLocalFolder` + `create_folder` 出队。

**关键前提（已验证，2026-10-01）**：本项目的 id 由**客户端**用 `newUlid()` 生成（`apps/web/src/data/db/repository.ts:44,449,505`），先写 IndexedDB 再入 outbox，最后由 `push.ts` 回放；服务端 `SQL_INSERT_ITEM` 带 `WHERE NOT EXISTS (SELECT 1 FROM items WHERE id = ?)`（`apps/worker/src/db/tables.ts:89-91`）——**接受客户端给的 id**。所以导入可以原样复用这条链路，不需要任何新协议。**服务端在本功能里零改动。**

### 4.1 第三处被核对推翻的判断：`createLocalItem` 不能用

初稿写的是「对每条调 `createLocalItem`」。**实现时核对发现那是"新建一条笔记"的接口，不是"还原一条条目"的接口**——它把下面这些字段硬编码成新建时的样子：

| 字段 | `createLocalItem` 给的值 | 后果 |
|---|---|---|
| `pinned` / `starred` | `0` | **置顶与收藏丢失** |
| `enc_self` | `0` | **单篇加密标记丢失** |
| `created_at` / `updated_at` | `now` | **创建时间变成恢复时刻** |
| `deleted_at` | `null` | **回收站状态丢失** |

所以另写了 `features/backup/restore.ts` 的 `restoreLocalItem`：这些字段按备份原样写，`rev` / `meta_rev` / `sync_seq` 仍归零（那是本机的乐观锁与同步游标，服务端不认备份里的旧值，照抄会**永久冲突**）。**结论要收窄成一句：推流链路可以复用，写入函数不能。**

### 4.2 回收站条目：本地能还原，服务端补一次软删（**已落地，v0.6.10**）

`deleted_at` 不在 create 的元数据里，回收站软删是**服务端**接口（`DELETE /api/items/:id`，见 `routes/trash.ts`）。而 `create` 推上去只会建成一条正常条目。所以回收站条目按**两步走**，靠 outbox 的 FIFO 保序：

1. `restoreLocalItem` 写本地行（回收站态）后，先入队 `create`、**紧跟入队一条 `trash_item`**（v0.6.10 新增的 outbox 操作；`enqueue` 是裸追加，不受「同一实体已有待推 op 就合并」规则影响，两条都保得住）；
2. `push.ts` 的 `pushTrashItem` **以本地为准**：出队时本地已不是回收站态（用户先恢复了）或条目已不在，就只出队不调服务端；否则调软删接口并把服务端推进的 `meta_rev` 记回本地。404 等不可重试失败进「上传失败」列表，可见、不默默变。批量路径不吸收它（不在 `BATCHABLE_OPS`，队首断点保住 FIFO）。

导入结果里 `itemsFromTrash` 照旧如实回报这个数，便于对照失败列表核对。

## 五、幂等与冲突

**不需要 `import_mappings` 表。** 这是相对 inkstone 的最大简化，理由是它们的架构里没有这套离线优先 + outbox，才不得不自建源→目标映射表。我们天然拿到三层幂等：

| 层 | 机制 | 位置 |
|---|---|---|
| 本地库 | 同一个 `id` 再写一次是覆盖，不是新增 | IndexedDB `put` |
| outbox | 同一实体已有待推 op 时不再重复入队 | `repository.ts:283,597` 的 `rows.some(...)` |
| 服务端 | `WHERE NOT EXISTS` 让重复 insert 变 no-op | `tables.ts:89` |

**结果：同一份备份反复导入，不会刷出重复条目。** 这已由上面三处代码结构确认，但**尚未用真实导入跑通**（见 §八）。

**冲突走既有链路（不做预览，用户 2026-10-02 拍板）**：同 id 条目在服务端已存在且内容不同时，`createItem` 抛 `rev_conflict`（`services/items.ts:98-106`），客户端既有冲突路径把备份内容**自动另存为副本**（标题带后缀），不丢数据。原设想「恢复预览里逐条改三档」**不做了**；导入结果如实回报与本机内容不同（被覆盖）的条目数（`itemsOverwritten`，v0.6.11），与云端的不一致在推送后经「上传失败 / 冲突副本」可见。

## 六、安全底线

- **绝不导出 `user_crypto` 的任何字段**（`k_wrapped_pw`、`k_wrapped_backup`、`verifier`、`kdf_salt`），备份包里也不出现明文密钥。否则**备份文件本身就是一份可直接解密的资产**——这是底线不是选项。
- 加密条目（`enc_self=1` 或 `in_enc_space=1`）导出**密文原样**。恢复时由用户重新输密码包裹，不从备份里取密钥。
- 恢复动作是破坏性的（会覆盖现有内容），**必须前置二次确认**并显示将影响多少条目。

## 七、落点

| 文件 | 作用 |
|---|---|
| `packages/shared/src/backup.ts`（新增） | 格式契约：`manifest` / `COMPLETE` 的 schema 与编解码、**包内路径的唯一产地**（`notePath` / `attachmentPath` / `foldersPath` / `completePath` / `manifestPath`）、路径归一化与安全校验、`verifySnapshot`。**纯函数、可测、不依赖浏览器** |
| `packages/shared/test/backup.test.ts`（新增） | 纯函数用例：COMPLETE 解析、哈希比对、路径穿越拒绝、坏 manifest 拒收、**所有包内路径都带 `snapshot/` 前缀** |
| `apps/web/src/features/backup/build.ts`（新增） | 纯构建层：条目 + 正文 + 附件 → manifest 与文件清单。不做 IO，可在 jsdom 里断言 |
| `apps/web/src/features/backup/export.ts`（新增） | 导出编排：读 IndexedDB（**草稿优先**）、下载附件、算哈希、可见进度与可中断、fflate 异步打包 |
| `apps/web/src/features/backup/export-note.ts`（新增，v0.6.12） | 单篇导出（M15）：`.md` 逐字 + 可选附件打包；`zip` 布局与备份一致（`attachments/<sha256>--<文件名>`），附件重算哈希、不符整次失败 |
| `apps/web/src/features/backup/restore.ts`（新增） | 还原专用的本地写入（见 §4.1） |
| `apps/web/src/features/backup/import.ts`（新增） | 导入编排：解包 → 校验 → 文件夹 → 条目 → 附件 |
| `apps/web/src/features/backup/ui/BackupPage.tsx`（新增） | 设置页「备份与导出」：导出无确认但有进度与取消；导入先出摘要再二次确认 |
| `apps/web/test/backup.test.ts`（新增） | 往返用例：包能过校验、正文逐字往返、**连导两次条目数不变**、坏包整包拒收、路径越界在读文件前被拒 |
| `apps/web/src/features/attachments/model.ts` | 新增 `extractAttachmentRefsWithNames`（备份要文件名，URL 里只有哈希） |
| `apps/web/src/app/router.ts` + `SettingsPanel` | 设置页新开一档「备份与导出」 |

**zip 库**：`fflate`（用户 2026-10-01 拍板）。约 30KB、专为现代浏览器、tree-shake 友好。用它的**异步** `zip` 而非 `zipSync`——全量备份动辄几百个文件，同步压缩会把主线程堵死几百毫秒到几秒。

**关于 `packages/crypto-format`**：`AGENTS.md` 写它「M3 落最小骨架」，但**实际不存在**（`packages/` 下只有 `mdcore` 与 `shared`）。本设计**不需要**独立包——格式契约就是纯数据 schema，和 `items.ts` / `content.ts` / `sync.ts` 同类，放 `packages/shared` 即可。为此新建一个包属于扩大范围，且 AGENTS.md 那句与实现不符，**改它需要用户点头**（已登记 §九）。

## 八、未做 / 待办

1. ~~**回收站条目的服务端还原**~~ —— **已落地（v0.6.10）**：outbox 新增 `trash_item`，按「`create` → `trash_item`」先建后删，见 §4.2。
2. ~~**冲突三档的界面**~~ —— **不做（用户 2026-10-02 拍板）**：维持既有链路，导入覆盖本机同 id 内容、推送时与云端不一致的自动另存冲突副本；导入结果回报覆盖数（`itemsOverwritten`，v0.6.11），见 §五。
3. **大备份的分片与断点续传**不做。首期接受"全量导出很慢"，靠可见进度与可中断兜住。
4. **加密备份（整个包用密码加密）**首期不做。先出明文包，真需要再加一层——但那会让"解包即可读"这个优点消失，要重新权衡。
5. **定时自动备份**（定期推到 WebDAV / S3）属 M5 后半段。
6. **导出的服务端侧**不做（见 §三，客户端导出够用）。
7. ~~**导入幂等只做了结构确认，未跑通端到端**~~ —— **已跑通**：`apps/web/test/backup.test.ts` 有一条「同一份备份连导两次，条目数不变」的用例，是这三层的看门狗。

## 九、待回写 `wiki/`（需用户同意，本轮未动）

| 目标文件 | 要补什么 |
|---|---|
| `wiki/guides/local-dev.md` §四 | `pnpm dev:seed` 的用法（v0.6.6 起有，尚未写进去） |
| `wiki/Menote-项目架构-v1.md` | 备份包的格式契约与落点；`packages/crypto-format` 一句与实现不符的处理结论 |
| `wiki/Menote-功能拆解-v2` M06/M07 | 备份/导出/导入的实现状态与剩余项 |
| `AGENTS.md` | `packages/crypto-format` 的描述改为实际落点（`packages/shared`）；若最终决定保留独立包则反之 |

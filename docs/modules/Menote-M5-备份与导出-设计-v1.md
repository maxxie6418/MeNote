# Menote 备份与导出设计 v1（文档版本 v1）

| 项 | 值 |
|---|---|
| 文档版本 | v1 |
| 文档状态 | 草案（**待用户确认后转生效**） |
| 目的和适用范围 | M5 的「备份 / 导出 / 导入」：**备份包长什么样、谁来生成、怎么恢复、重复导入会不会刷出重复条目**。本文定格式契约与取舍，不含界面稿；界面另走「界面怎么做」。产品口径见 `wiki/Menote-功能拆解-v2` M06/M07（**只读，不改**） |
| 权威级别 | 模块规则（格式契约另需回写 `wiki/`，见 §九） |
| 最后更新日期 | 2026-10-01 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.6.8 | 2026-10-01 | 初版。参照外部项目 inkstone 的备份做法（`COMPLETE` 提交标记、内容寻址附件），结合 MeNote 实际的离线优先 + outbox 架构重新设计幂等方案 | MiniMax-M3.1-Flash-Preview |

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
3. 对每条：`createLocalItem({ id: <备份里的 id>, ... })` + `enqueue`，**然后照常走 outbox 推流**。
4. 文件夹同理：`createLocalFolder` + `create_folder` 出队。

**关键前提（已验证，2026-10-01）**：本项目的 id 由**客户端**用 `newUlid()` 生成（`apps/web/src/data/db/repository.ts:44,449,505`），先写 IndexedDB 再入 outbox，最后由 `push.ts` 回放；服务端 `SQL_INSERT_ITEM` 带 `WHERE NOT EXISTS (SELECT 1 FROM items WHERE id = ?)`（`apps/worker/src/db/tables.ts:89-91`）——**接受客户端给的 id**。所以导入可以原样复用这条链路，不需要任何新协议。

## 五、幂等与冲突

**不需要 `import_mappings` 表。** 这是相对 inkstone 的最大简化，理由是它们的架构里没有这套离线优先 + outbox，才不得不自建源→目标映射表。我们天然拿到三层幂等：

| 层 | 机制 | 位置 |
|---|---|---|
| 本地库 | 同一个 `id` 再写一次是覆盖，不是新增 | IndexedDB `put` |
| outbox | 同一实体已有待推 op 时不再重复入队 | `repository.ts:283,597` 的 `rows.some(...)` |
| 服务端 | `WHERE NOT EXISTS` 让重复 insert 变 no-op | `tables.ts:89` |

**结果：同一份备份反复导入，不会刷出重复条目。** 这已由上面三处代码结构确认，但**尚未用真实导入跑通**（见 §八）。

冲突策略沿用现有的三档语义，与同步一致：**服务端版本胜 / 保留我的 / 另存副本**。导入时默认 `newer`（按 `updated_at` 单调比较），用户在恢复预览里逐条改。

## 六、安全底线

- **绝不导出 `user_crypto` 的任何字段**（`k_wrapped_pw`、`k_wrapped_backup`、`verifier`、`kdf_salt`），备份包里也不出现明文密钥。否则**备份文件本身就是一份可直接解密的资产**——这是底线不是选项。
- 加密条目（`enc_self=1` 或 `in_enc_space=1`）导出**密文原样**。恢复时由用户重新输密码包裹，不从备份里取密钥。
- 恢复动作是破坏性的（会覆盖现有内容），**必须前置二次确认**并显示将影响多少条目。

## 七、落点

| 文件 | 作用 |
|---|---|
| `packages/shared/src/backup.ts`（新增） | 格式契约：`manifest` / `COMPLETE` 的 schema 与编解码、路径归一化与安全校验。**纯函数、可测、不依赖浏览器** |
| `packages/shared/test/backup.test.ts`（新增） | 纯函数用例：COMPLETE 解析、哈希比对、路径穿越拒绝、坏 manifest 拒收 |
| `apps/web/src/features/backup/`（新增） | 导出编排（读 IndexedDB、下载附件、算哈希、进度与中断）与导入编排（校验、还原、冲突） |
| `apps/web/src/app/router.ts` + `SettingsPanel` | 设置页新开一档「备份与导出」（M5 界面稿另走） |

**关于 `packages/crypto-format`**：`AGENTS.md` 写它「M3 落最小骨架」，但**实际不存在**（`packages/` 下只有 `mdcore` 与 `shared`）。本设计**不需要**独立包——格式契约就是纯数据 schema，和 `items.ts` / `content.ts` / `sync.ts` 同类，放 `packages/shared` 即可。为此新建一个包属于扩大范围，且 AGENTS.md 那句与实现不符，**改它需要用户点头**（已登记 §九）。

## 八、未做 / 待办

1. **导入幂等只做了结构确认，未跑通端到端**。开工人第一件事就是写一个「同一份备份连导两次，条目数不变」的用例。
2. **大备份的分片与断点续传**不做。首期接受"全量导出很慢"，靠进度与中断兜住。
3. **加密备份（整个包用密码加密）**首期不做。先出明文包，真需要再加一层——但那会让"解包即可读"这个优点消失，要重新权衡。
4. **定时自动备份**（定期推到 WebDAV / S3）属 M5 后半段，本设计只保证手动导出可用。
5. **界面稿**未做。`DESIGN.md` §5.1-2 要求多步危险流程有明确入口与退出方式，恢复流程要按那条画。
6. **`item_versions` 默认不进备份**，另给一个「含历史版本」开关（用户 2026-10-01 确认）。理由：版本是 2000 条上限的大头，恢复价值远低于正文。
7. **回收站条目（`deleted_at`）进备份**（用户 2026-10-01 确认）。"误删了从备份找回来"是真实需求，且不含的话备份就不是"那个时刻的真实状态"。

## 九、待回写 `wiki/`（需用户同意，本轮未动）

| 目标文件 | 要补什么 |
|---|---|
| `wiki/guides/local-dev.md` §四 | `pnpm dev:seed` 的用法（v0.6.6 起有，尚未写进去） |
| `wiki/Menote-项目架构-v1.md` | 备份包的格式契约与落点；`packages/crypto-format` 一句与实现不符的处理结论 |
| `wiki/Menote-功能拆解-v2` M06/M07 | 备份/导出/导入的实现状态与剩余项 |
| `AGENTS.md` | `packages/crypto-format` 的描述改为实际落点（`packages/shared`）；若最终决定保留独立包则反之 |

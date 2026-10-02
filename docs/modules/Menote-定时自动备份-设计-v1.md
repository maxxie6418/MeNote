# Menote 定时自动备份（外部备份目标）设计 v1（文档版本 v1）

| 项 | 值 |
|---|---|
| 文档版本 | v1 |
| 文档状态 | **草案（M6 拍板后实施）**。用户 2026-10-02 拍板：定时自动备份顺延 M6，先出本设计稿 |
| 目的和适用范围 | 需求 §16.3 / 功能拆解 M16 的**备份目标管理与自动备份**（M16-01 / M16-02 / M16-03 的服务端部分）：把用户内容增量推送到自有的 WebDAV / S3 / Git。**不含** M5 已交付的客户端全量 zip 备份（`Menote-M5-备份与导出-设计`），也**不含** M16-04 恢复（恢复走 M5 导入）与分享 |
| 权威级别 | 模块规则（草案；机制不得与 `wiki/Menote-项目架构-v1` §3.2 / §12.4 冲突） |
| 最后更新日期 | 2026-10-02 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.6.12 | 2026-10-02 | 初稿：按架构 §12.4 的定稿机制（快照队列 / 适配器 / 出站加密 / 凭据包裹）整理成可实施的设计，列 M6 开工前待拍板点 | GLM-5.3-Flash |

---

## 一、定稿依据（只复述，不改口径）

| 定稿 | 内容 |
|---|---|
| 架构 §3.2 | md 快照目录是**备份与导出的统一格式**——外部备份与 zip 导出共用同一目录结构 |
| 架构 §12.4 | 快照按队列写入 R2 `snap/{uid}/`（`export_queue` 接口位，M4 已留）；外部备份适配器统一接口 `put(path, stream)` / `delete(path)` / `commit()`（仅 Git）；「立即备份」与首次全量由**浏览器循环调 `POST /api/backup/:target/run`**，每次一批；出站加密按 §7.3 信封、每轮配额 ≤ 4 MB；凭据与内容密钥 K 用**备份包裹键**（`AUTH_PEPPER` 域分离派生）AES-GCM 加密存 D1，只在 Worker 内存解密 |
| 架构 §2.3.2 | 落点：`jobs/backup.ts`、`jobs/snapshot.ts`、`adapters/webdav.ts` / `s3.ts` / `git.ts`；S3 签名用 aws4fetch（`UNSIGNED-PAYLOAD`）；Git 一批 ≈ 40 文件（50 子请求上限） |
| 功能拆解 M16-01~03 | 目标可多个、可启停；凭据保存后**不回显**（只显示"已配置"）；删除策略（同步删除 / 只增不删）；保存前**测试连接**；自动备份**增量推送变化文件**；隐私条目出站前**强制加密**，普通条目明文；设置页显示每个目标最近备份时间与结果 |

## 二、流水线（一次自动备份的生命周期）

```text
Cron（每日）──▶ jobs/backup.ts 轮询启用的目标
                 │
                 ├─ 1. 快照物化：export_queue 队列项 → mdcore 快照格式 → R2 snap/{uid}/
                 │     （M4 只留了接口位；本设计补"生成与按 rev 条件出队"）
                 │     Memo 月份文件由该月全部 Memo 拼成，月份键用客户端随写入提交的值
                 │
                 ├─ 2. 差异计算：目标游标（每目标记录已推到的 sync_seq / 文件清单）
                 │     得出 新增 / 变更 / 删除 三组路径
                 │
                 ├─ 3. 出站加密：隐私条目（enc_self / in_enc_space）的文件按 §7.3 信封
                 │     加密；每轮加密字节 ≤ 4 MB，超出留到下一轮（状态机继续推普通文件）
                 │
                 ├─ 4. 推送：适配器 put / delete；Git 目标最后 commit()
                 │     删除策略 = 同步删除 时才执行 delete（只增不删则记日志）
                 │
                 └─ 5. 落账：目标行更新 last_run_at / last_result / 推送文件数；
                       失败写原因（设置页平铺，DESIGN.md §5.4-2）
```

- **单批上限**：一轮 Cron 内每目标最多推 N 批（建议 20 批 / 批 40 文件，实测校准），推不完的下一轮继续——状态机**可中断可续推**，与"立即备份"共用同一套游标。
- **频率**：Cron 触发每日一次（复用 `wrangler.jsonc` 已有的 `triggers.crons`，与 M4 维护任务并列调度）；目标级档位（每天 / 每周）在**拍板点 ②**。

## 三、数据模型（新增一张表 + 迁移）

```sql
-- 0005（示例，实施时按《数据模型与迁移设计》规范落）
CREATE TABLE user_backup_targets (
  id TEXT PRIMARY KEY,                -- ULID
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- 'webdav' | 's3' | 'git'
  label TEXT NOT NULL,                -- 用户起的名字
  endpoint TEXT NOT NULL,             -- URL / bucket 信息
  username TEXT,
  secret_wrapped BLOB NOT NULL,       -- 凭据，备份包裹键 AES-GCM 加密
  enabled INTEGER NOT NULL DEFAULT 1,
  delete_policy TEXT NOT NULL,        -- 'sync' | 'append_only'
  schedule TEXT NOT NULL,             -- 'daily' | 'weekly'（拍板点 ②）
  cursor_seq INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER,
  last_result TEXT,                   -- 'ok' | 'partial' | 'failed'
  last_error TEXT
);
```

- 凭据**只在保存时写一次**，任何接口不回显（响应只有 `"has_secret": true`）；测试连接用**提交时的一次性明文**，不落库。
- 内容密钥 K 已有 `k_wrapped_backup`（M3 起），本设计**不新增密钥材料**。

## 四、API（`routes/backup.ts`，均需会话）

| 接口 | 说明 |
|---|---|
| `GET /api/backup/targets` | 列目标（凭据只回 `has_secret`） |
| `POST /api/backup/targets` | 新建；`secret` 收一次性明文，包裹后落库 |
| `PUT /api/backup/targets/:id` | 改配置；`secret` 缺省 = 不改凭据 |
| `DELETE /api/backup/targets/:id` | 删目标（远端文件不动，仅本账本清账） |
| `POST /api/backup/targets/:id/test` | 保存前测试连接（用请求体里的临时凭据） |
| `POST /api/backup/targets/:id/run` | **立即备份**：浏览器循环调用，每次一批，返回进度与剩余量（架构 §12.4 定稿） |

## 五、安全底线（与 M5 同源）

- 凭据与密钥材料**绝不**出服务端（不进任何 GET 响应、不进日志、不进错误消息）。
- 出站包**不含** `user_crypto` 任何字段；隐私条目密文出站，普通条目明文（M16-02 定稿）。
- 外部目标由**用户提供凭据**，内容推到用户自己控制的存储——服务端只做搬运与加密，不做第三方中转。

## 六、待拍板点（M6 开工前）

1. **目标类型顺序**：建议首期 WebDAV + S3（Git 的 tree/commit 编排最重、价值面窄，放最后）。
2. **调度档位**：每天 / 每周（或两档都给）。
3. **远端保留策略**：`同步删除` 是否首期就做（只增不删更安全但会积垃圾）；Git「同步删除清不掉历史提交」的提示文案（M16-01）。
4. **快照格式对齐**：§3.2 快照目录与 M5 zip 内层 `snapshot/` 的 manifest 是否完全同构（建议**同构**，客户端"打开备份包"的工具就能直接读 R2 快照）。
5. **预算实测前置**：Workers CPU 限额、50 子请求上限下的大库首轮全量耗时——先拿自建实例实测再定单批参数（架构 §14.2 的估计值要校准）。

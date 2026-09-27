# Menote M3 实施计划（隐私锁）

| 项 | 值 |
|---|---|
| 文档版本 | v1.1 |
| 文档状态 | **执行中**（M3-1 界面稿已完成，下一步 M3-2） |
| 目的和适用范围 | M3（隐私锁，功能点 M08-01~16）的实施计划：范围边界、前置条件、分步拆解、每步的涉及文件与验收点。设计依据是 `docs/modules/Menote-隐私锁设计-v1.md`（v1.3，全文成稿） |
| 权威级别 | 模块规则（执行依据）。产品对错以 `wiki/` 定稿为准；与本文设计冲突时以设计稿为准并停下确认 |
| 最后更新日期 | 2026-09-27 |

修改记录：

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.3.1 | 2026-09-27 | 初稿：范围边界、前置条件、12 步子计划（含先稿后码的界面稿）、风险与交付物 | deepseek-v4.1-flash |
| v1.1 | v0.3.2 | 2026-09-27 | **M3-1 完成**（《M3 界面稿》v1.1 经用户确认）；状态由「草案」改「执行中」；开工前置两项打勾 | deepseek-v4.1-flash |
| v1.2 | v0.3.3 | 2026-09-27 | **M3-2 完成**：`packages/shared/src/privacy.ts` 判定契约 + `privacy` 设置契约 + 22 个用例（全套 487 通过）；用户已授权 M3/M4 一并执行、允许 wiki 回写与前端接线层拆分 | deepseek-v4.1-flash |
| v1.3 | v0.3.4 | 2026-09-27 | **M3-3 完成**：迁移 0003 `user_crypto`、crypto 四端点、`ensureEncSpace`（注册/登录补建）、`db/privacy.ts` 过滤常量、`BACKUP_CRED_KEY` 可选绑定；新增 16 个用例并把 7 个既有用例按"每个账号自带空间行"修正（全套 511 通过） | deepseek-v4.1-flash |
| v1.4 | v0.3.5 | 2026-09-27 | **M3-4 前半完成**：crypto 原语 / 纯函数状态机 / 材料缓存 + Dexie v5 / `PUT /api/crypto` 的 `k` 契约（首次启用由服务端包裹，补掉"浏览器拿不到 BACKUP_CRED_KEY"的设计缺口）；web 337、worker 108、全套 542 通过；剩余组装层（hook / 广播握手 / api 方法） | deepseek-v4.1-flash |
| v1.5 | v0.3.6 | 2026-09-27 | **M3-4 完成**：`cryptoApi`、五个隐私广播事件（只带状态不带内容）、`usePrivacyLock` 组装层（缓存装门禁 / rev 失效 / 设备长期档 / 计时 / 多标签握手 / 动作集）；修掉"有缓存但离线时门禁不生效"的真 bug；全套 549 通过 | deepseek-v4.1-flash |
| v1.6 | v0.3.7 | 2026-09-27 | **M3-5 前半完成**：搜索索引拆标题/正文两段（Dexie v6）、`searchLocal` 按门禁过滤、`useSearch` 与 `App` 接线；按授权拆出 `app/AuthScreens.tsx` 守住入口行数预算；全套 553 通过 | deepseek-v4.1-flash |
| v1.7 | v0.3.8 | 2026-09-27 | **M3-5 后半（一）**：`filterByView`/`recentPreview`/`openTaskPreview` 接门禁、`HomePanel` 用 gate 取代 `memoLocked`、`noPrivacyGate()` 冻结单例（修掉"门禁对象每渲染重建"的引用稳定性陷阱）；全套 556 通过；Memo/待办占位与解锁框一并排入界面批次 | deepseek-v4.1-flash |
| v1.8 | v0.3.9 | 2026-09-27 | **M3-5 完成 + 界面批次（一）**：`LockedPlaceholder`、`UnlockModal`（含逐次加等待）、`PrivacyCapsule`（三态与菜单）、Memo/待办占位；按授权再拆 `App.tsx`（`PrivacySlot`/`MemoView`/`TaskView`）；全套 570 通过；M3-10 标部分完成（缺 VaultNode / ItemRow / 编辑器状态栏 / 文案红线），胶囊开锁字形待确认 | deepseek-v4.1-flash |
| v1.9 | v0.3.10 | 2026-09-27 | **M3-9 完成**：`PrivacySettingsPage`（启用/关闭/改密/重置 + 档位 + 范围）、组装层 `changePassword`/`resetPassword`（都不改 K）、`PRIVACY_MINUTES_OPTIONS` 同源常量、`SettingsPanel` 插槽、按授权拆 `app/SettingsView.tsx`；全套 584 通过；线上四条流程走查归 M3-12（需端上配好 BACKUP_CRED_KEY） | deepseek-v4.1-flash |
| v1.10 | v0.3.11 | 2026-09-27 | **M3-6 完成**：空间节点三态、空间内文件夹树与空间内新建、笔记本树排除空间子树（修真问题）、`FolderRenameModal` 去重、按授权拆 `useVaultScope`/`useNoteCreation`/`NavPanels`；全套 593 通过 | deepseek-v4.1-flash |
| v1.11 | v0.3.12 | 2026-09-27 | **M3-7 完成**：`enc_self` 补丁（补上白名单漏掉的一列）+ 两条服务端硬约束、`LockedDocPanel`、编辑器「更多」四动作（锁定态可加密 / 取消须先解锁）、按授权拆 `NotesPane`；全套 603 通过。**过程事故**：批量改名时误用 PowerShell 写坏一个源文件（BOM + 乱码），已重写并全仓扫描确认无其它受损 | deepseek-v4.1-flash |
| v1.12 | v0.3.13 | 2026-09-27 | **M3-8 前半完成**：`in_enc_space` 契约与四条服务端自洽校验、`moveItemToVault`/`moveItemOutOfVault`、列表行菜单四态、按授权拆 `NotesSlot`、worker 隐私用例拆到 `items-privacy.test.ts`（两个文件都到行数预算）；全套 611 通过 | deepseek-v4.1-flash |
| v1.13 | v0.3.14 | 2026-09-27 | **M3-8 完成**：文件夹的 `in_enc_space` 契约与整夹校验（含"空间根不可移可改名"）、空间内新建改由服务端按父级推导（修 M3-6 遗留）、`batch.ts` 纯执行器（逐条/失败跳过/进度）、树菜单与"处理中 12 / 40" + 失败清单 + 重试、按授权拆 `useItemPatchActions`；全套 621 通过 | deepseek-v4.1-flash |

---

## 一、范围与边界

**包含**：M08-01 ~ M08-16 全部 16 条功能点（启用 / 解锁 / 锁定 / 档位 / 加密空间 / 单篇加密 / 移入移出 / 批量标记 / 状态标识 / 改密 / 重置 / 关闭 / 设置）。

**不做**（属其他里程碑，本文只留接口位）：

| 事项 | 归属 |
|---|---|
| 表格、附件与图片、版本历史、回收站 | M4 |
| 分享、导出、备份（含 `crypto-format` 的消费方） | M5 |
| MCP 本体、令牌配置界面、`list_folders` 的计数排除 | M6（M3 只把"配置在 设置 › MCP、与隐私范围解耦"写进契约与文档） |
| 需求 §6 全章按新模型重写（v7.5） | 另案，与 M3 并行 |
| `attachments` / `item_versions` / `tombstones` / `r2_gc_queue` 五表 DDL | M4 开工前必补 |

**开工前置**（逐条打勾后再进 M3-2）：

- [x] 《隐私锁设计》v1.3 成稿（本计划的唯一设计依据）
- [x] `BACKUP_CRED_KEY` 提前到 M3（用户 2026-09-27 确认）
- [x] **M3 界面稿**（`docs/modules/Menote-M3-界面稿-v1.md` v1.1，用户 2026-09-27 确认）
- [ ] 附录 B 的 `wiki/` 回写清单执行（建议与 M3 开工同批；不改也能开工，口径以设计稿为准）
- [ ] `BACKUP_CRED_KEY` 四处接线（`.dev.vars.example` / 部署页 / `EnvBindings` / `vitest.config.ts`）

---

## 二、分步计划

每一步都按「完成后立刻提交」执行（AGENTS「里程碑执行节奏」）：代码与文档分开提交，推送前跑 `pnpm lint` / `pnpm typecheck` / `pnpm test`。

### M3-1 界面稿（**先稿后码**，代码前唯一的人工确认点）—— ✅ **完成（2026-09-27）**

- **产出**：`docs/modules/Menote-M3-界面稿-v1.md`。至少覆盖三屏 + 两态：
  1. **解锁框**（`UnlockModal`）：密码输入、错误提示与逐次等待、本次档位临时选择、"忘记隐私密码"入口；未启用时的引导态；
  2. **加密空间视图**（`VaultPanel`）：锁定占位（"此空间已锁定" + 解锁按钮）、解锁后的列表 + 正文双栏、空间内两层文件夹、空态 `VaultDocEmpty`（含保护边界说明）；
  3. **隐私锁设置页**：启用 / 关闭 / 修改密码 / 忘记后重置 / 三档 + N 分钟 / 范围配置（加密空间只读行 + Memo 开关 + 预留扩展位）/「解锁时可搜索加密内容」；
  4. **四处状态标识**与**单篇加密的编辑器两态**（对照设计 §9.2）。
- **涉及文件**：新增文档；对照 `DESIGN.md`（视觉已定稿 v1.3）与 `wiki/components.md`（`PrivacyCapsule` / `VaultNode` / `VaultPanel` / `UnlockModal` / `ResetPrivacyModal` / `TierMenu` / `VaultDocEmpty` / `LockedDocPanel`）；原型锚点 `#unlockOverlay` / `#vaultNode` / `#setNav` / `#lockCapsule` 可复用。
- **验收**：用户确认该稿；文档说明"这一屏有哪些块、主操作、空状态"；未确认前不写任何界面代码。 ✅ **已完成**：`Menote-M3-界面稿-v1.md` v1.1，用户 2026-09-27 确认（三条待确认按稿内默认结论关闭）。

### M3-2 共享判定契约与设置契约（纯函数）—— ✅ **完成（2026-09-27，v0.3.3）**

- **涉及文件**：`packages/shared/src/privacy.ts`（新增）、`packages/shared/src/settings.ts`（增 `privacy` 四字段 + 默认值；`QUICK_MENU_FEATURES` 的 `lock.pendingStep` → `null`）、`packages/shared/src/index.ts`（导出）、`packages/shared/test/privacy.test.ts`（新增）。
- **验收**：设计 §3.2 的判定规则表**逐行有用例**（六类内容 × 列表/正文/标题搜索/正文搜索）；设置 schema 对缺字段填默认值（部署窗口兼容）；`pnpm --filter @menote/shared test` 通过。

### M3-3 服务端：迁移 0003 + crypto 端点 + 空间行补建 + 机密接线 —— ✅ **完成（2026-09-27，v0.3.4）**

- **涉及文件**：`apps/worker/src/db/migrations/0003_user_crypto.ts`（新增）、`apps/worker/src/db/selfheal.ts`（注册迁移 + `REQUIRED_TABLES`）、`apps/worker/src/db/tables.ts`（crypto 语句常量）、`apps/worker/src/db/privacy.ts`（`PRIVACY_EXCLUDE_SQL` 常量）、`apps/worker/src/services/crypto.ts` + `routes/crypto.ts`（新增，四点端点）、`apps/worker/src/services/folders.ts`（`ensureEncSpace`）、`apps/worker/src/routes/auth.ts`（注册与登录两处调用）、`apps/worker/src/services/search.ts`（改用常量）、`apps/worker/src/types.ts`（`BACKUP_CRED_KEY`）、`apps/worker/src/index.ts`（挂子路由）、`.dev.vars.example`、`apps/worker/vitest.config.ts`。
- **验收**：空库首个请求后 `user_crypto` 出现在 `sqlite_master`；迁移幂等（连调两次版本不变）；`GET/PUT/DELETE /api/crypto` 与 `POST /api/crypto/reset` 各自有用例（含 `DELETE` 在"有隐私内容"时 409、`reset` 用 `BACKUP_CRED_KEY` 解包成功）；`ensureEncSpace` 并发两次只留一行、M1/M2 存量账号登录后补建；搜索语句断言包含 `PRIVACY_EXCLUDE_SQL`。

### M3-4 前端门禁核心（crypto 模块 + 会话态 + 多标签 + 计时）—— ✅ **完成（2026-09-27，v0.3.6）**

> 已完成：`features/privacy/crypto.ts`（PBKDF2 / verifier / K 包裹解包）、`features/privacy/model.ts`（纯函数状态机）、`data/db/privacy.ts` + Dexie v5（材料缓存与 `rev` 失效）、`data/api/endpoints.ts` 的 `cryptoApi`、`data/sync/broadcast.ts` 的五个隐私事件、`features/privacy/usePrivacyLock.ts`（组装层：缓存装门禁 / 服务端刷新 / 设备长期档 / 计时 / 多标签握手 / 动作集）、服务端 `PUT /api/crypto` 的 `k` 契约（首次启用由服务端包裹）。
> 顺带修掉一个真 bug：有缓存但离线时门禁原本不生效（现在缓存一读到就按"已启用 + 锁定"处理）。

- **涉及文件**：`apps/web/src/features/privacy/model.ts`（状态机 / 档位 / 计时 / 握手）、`apps/web/src/features/privacy/crypto.ts`（PBKDF2 派生、verifier 校验、K 包裹与解包）、`apps/web/src/data/db/privacy.ts`（`privacyState` 缓存 + `rev` 失效）、`apps/web/src/data/db/schema.ts`（Dexie v5：`privacyState` 新表 + `searchIndex` 拆列）、`apps/web/src/data/sync/broadcast.ts`（四个新事件）、`apps/web/src/app/usePrivacyGate.ts`（组装 `PrivacyGate` 供 props 注入）。
- **验收**：正确/错误密码的 verifier 校验各有用例；K 包裹解包往返一致；服务端 `rev` 变高 → 覆盖缓存并清空解锁态；多标签握手（替身）与"无人应答 = 锁定"；N 分钟计时用假时钟；`BroadcastChannel` 缺失时降级不报错。

### M3-5 门禁接入全局 + 搜索改造 —— ✅ **完成（2026-09-27，v0.3.7 + v0.3.8 + v0.3.9）**

> 已完成：**搜索**（索引拆标题/正文两段 + Dexie v6 + `searchLocal(…, gate)` 按 `searchFields` 过滤 + `useSearch`/`App` 接线，v0.3.7）；**列表与三视图**（`filterByView(…, gate)`，标签云/计数不过门禁，v0.3.8）；**首页**（`recentPreview`/`openTaskPreview` 接门禁、`homeStats` 口径不变、`HomePanel`/`HomeView` 用 gate 取代 `memoLocked`，v0.3.8）；**Memo 与待办锁定占位**（`LockedPlaceholder` + 两个面板的 `gate`/`onUnlock`，v0.3.9）；顺带按授权拆出 `app/AuthScreens.tsx`、`app/PrivacySlot.tsx`、`app/workarea/MemoView.tsx`、`app/workarea/TaskView.tsx`（入口行数预算）与 `noPrivacyGate()` 冻结单例。编辑器锁态归 M3-7。

- **涉及文件**：`apps/web/src/data/db/search.ts`（索引含隐私条目、拆标题/正文两段、查询按 `searchFields` 过滤）、`apps/web/src/features/search/useSearch.ts`、`apps/web/src/features/notes/views.ts`（`gate` 入参）、`apps/web/src/features/home/*`（计数含全部、最近动态按门禁、Memo 占位接真值）、`apps/web/src/features/memos/*`、`apps/web/src/features/tasks/*`、`apps/web/src/app/fnbar/VaultNode.tsx`（未启用 / 锁定 / 解锁三态）。
- **验收**：M2 那条"加密条目既不进索引也搜不到"用例改写为四组断言（进索引 / 锁定搜不到 / 解锁标题可搜 / 开关控正文 / 单篇标题可搜正文不可）；锁定态首页最近动态不含空间内条目、计数含；三视图在锁定/解锁切换后**立即重渲染**。

### M3-6 加密空间视图 —— ✅ **完成（2026-09-27，v0.3.11）**

> 已完成：`privacy/vault.ts` 纯函数（**笔记本树排除整个空间子树**——修掉"空间行混进根目录文件夹"）、`VaultNode` 三态（未启用置灰说明 / 已锁定开解锁框 / 已解锁显示计数并可进入）、`VaultTree` 空间内文件夹树（复用 `FolderTree` + 抽出的 `FolderRenameModal`）、空间内新建（`createLocalItem`/`createLocalFolder` 支持空间标记，**不经过先建后移**）、锁定后自动离开空间视图；装配层拆出 `useVaultScope` 与 `useNoteCreation`。
> **未做**：空间行的"不可删除"守卫——客户端目前没有删除文件夹的入口（删除能力在 M4），所以现在没有可被绕过的路径；守卫随 M4 一起加。空间内"新建笔记"按钮落在功能栏的「新建笔记」上（当前视图在空间里即天然带标记）。

- **涉及文件**：`apps/web/src/features/privacy/ui/VaultPanel.tsx` + `VaultDocEmpty.tsx`（新增）、`apps/web/src/features/notes/*`（空间内的列表与正文复用既有双栏组件）、空间重命名（复用文件夹改名路径）、空间内新建条目（创建时置 `in_enc_space = 1`）。
- **验收**：锁定时只显示"已锁定 + 解锁"占位且**不展开**；解锁后两层文件夹限制与服务端一致（非法目标置灰并说明）；空间内新建天然带标记；空间行竞态下不可删、不可重建第二个。

### M3-7 单篇加密（含锁定态开启）—— ✅ **完成（2026-09-27，v0.3.12）**

> 已完成：服务端 `enc_self` 补丁（白名单 + SQL 字段 + 两条硬约束：**Memo 拒绝**、**未启用隐私锁拒绝**）；客户端 `setItemEncryption`；`LockedDocPanel`（只替换正文区、**编辑器不挂载**、状态栏不显示实时大小）；`NoteWorkspace`「更多」菜单四个动作（禁用都带原因、**锁定态可加密**（Q25）、**取消加密必须先解锁**）；按授权拆出 `app/workarea/NotesPane.tsx`。
> **未做**：分享 / 撤销接口只留位（M5 接）；「锁上此篇」后的 30 秒闪烁提示归 M3-10 的状态标识收尾。
> **实现要点**：`enc_self` 是**设计已定**（§5.1 单篇标记走 `meta_rev` 补丁）但 M2 的白名单里漏掉的一列，本轮补上——属于补齐既定设计，不是新增 API 契约。

- **涉及文件**：`apps/web/src/features/privacy/ui/LockedDocPanel`（新增，或复用 `app/workarea` 的占位件）、编辑器「更多」菜单（`apps/web/src/app/editor/*` 或 `features/notes/ui/DocStatusBar.tsx` 一带）、`features/privacy/model.ts`（逐篇已解密集合）。
- **验收**：**锁定态**开启成功且该篇立即按锁定显示（Q25）；逐篇独立（解开 A 后 B 仍锁）；取消必须解锁；「锁上此篇」与「锁上全部单篇」行为正确；分享撤销接口留位（M5 接）。

### M3-8 移入 / 移出与批量标记 —— ✅ **完成（2026-09-27，v0.3.13 + v0.3.14）**

- **涉及文件**：`apps/web/src/features/notes/*`（"移动到…"的目标集合：加密空间节点）、`apps/web/src/data/db/repository.ts`（`patch_meta` 的标记变更）、批量走 `POST /api/batch` 与 outbox（M2 已有）、进度与失败清单 UI。
- **验收逐条对照**：①锁定态单篇只能移到空间根、目标菜单不展开空间内文件夹 —— **满足**（v0.3.13：菜单在锁定时只给"入根"）；②整夹移入/移出受两层限制校验 —— **满足**（v0.3.14：非第 1 层或有子文件夹时入口置灰并说明，服务端同样校验）；③批量进度"处理中 12/40"、单条失败跳过并列失败清单 + 重试 —— **满足**（`batch.ts` 纯执行器 + `NotebookPanel` 的进度行、失败清单与「重试」）；④中断后重开继续（outbox 未清）—— **满足**（每条 patch 各自入队 outbox，执行器不自己存队列）。
- **实现要点**：`in_enc_space` 与目标（`folder_id` / `parent_id`）**必须同一条补丁**，服务端核对目标归属，避免"标记在空间、行却挂在普通文件夹"的裂缝；顺带修掉 M3-6 遗留的"空间内新建文件夹服务端硬编码 `in_enc_space = 0`"，改由服务端按父级推导。

### M3-9 设置页「隐私锁」分类 —— ✅ **完成（2026-09-27，v0.3.10）**

> 已完成：`PrivacySettingsPage`（状态与关闭 / 档位与 N 分钟 / 范围与搜索 / 改密与重置）+ 组装层的 `changePassword` 与 `resetPassword`（**都不改内容密钥 K**）+ `PRIVACY_MINUTES_OPTIONS` 同源常量 + `SettingsPanel` 的 `privacyPage` 插槽 + 按授权拆出的 `app/SettingsView.tsx`。
> **未验证**：四条流程的**线上**逐条走查（启用需要 Cloudflare 端配好 `BACKUP_CRED_KEY`，属 M3-12 的线上验收项）；界面侧契约有 14 个用例覆盖，加密与请求路径另有用例。

- **涉及文件**：`apps/web/src/features/settings/ui/SettingsPanel.tsx`（分类进导航）、新增分类页组件、`features/settings/model.ts`（读改 `privacy` 设置）、`useUserSettings`（即时生效 + 同步）。
- **验收**：启用 / 关闭 / 改密 / 重置四条流程各走一次（含联网前置与失败提示）；关闭被拒时给出"先取消单篇标记并清空空间"的原因；范围配置改动立即影响 Memo 门禁；三档与 N 分钟写入并同步到其他设备。

### M3-10 状态标识与文案（四处）—— 🟡 **部分完成（2026-09-27，v0.3.9）**

> 已完成：`PrivacyCapsule`（顶栏第 5 块）三态与菜单（`TierMenu` 的功能以菜单项形式落在胶囊里）。**待做**：`VaultNode` 的计数与三态、`ItemRow` 的锁标识与"已加密"摘要位、编辑器状态栏与 30 秒提示、文案集中一处 + 文案红线断言。
> **一处待确认**：sprite 只有 `lock`、没有开锁字形，胶囊两态暂共用它（颜色 + 文字区分）；补字形要动 `Icon.tsx` 与 `DESIGN.md §5.5`，需用户点头。

- **涉及文件**：`apps/web/src/app/topbar/PrivacyCapsule.tsx`（新增，顶栏第 5 块）、`TierMenu`（三档）、`VaultNode`（计数 + 三态）、`ItemRow`（锁标识与"已加密"摘要位）、编辑器状态栏与 30 秒提示、文案常量集中一处。
- **验收**：设计 §9.2 四处逐条对照；两套标识（隐私锁态 / 单篇加密态）同屏可辨；30 秒闪烁 + 状态栏文案；**文案红线**用 grep 型断言兜住（禁止"加密存储""数据已加密""已加密保存"等词）。

### M3-11 备份信封纯函数（`packages/crypto-format`，**可顺延**）

- **涉及文件**：`packages/crypto-format/`（新增包：信封编解码纯函数 + 测试）、根 `tsconfig` / `pnpm-workspace` 引用、dev/build/test 链路。
- **验收**：架构 §7.3 的字段偏移与 103 字节固定开销逐项断言；编解码往返一致；不引入新依赖。
- **说明**：M3 运行时不消费它（消费方是 M5）。若 M3 排期紧，**整步可移到 M5 开工前**——格式已定稿、实现独立，不影响 M3 验收。

### M3-12 验收与收口

- **动作**：按设计 §11 走查表逐格走查（16 行能力矩阵 × 四态 + 20 项流程 + 7 条反例）；`pnpm lint` / `typecheck` / `test` / `build` / `check:size`；线上 `me.861306.xyz` 逐屏点验（补 M2 遗留的云端逐屏项）；写收口复核文档（沿用 M2 的做法：逐条证据 + 偏离 + 未验证项）。
- **验收**：走查表全绿或明确标注偏离；CHANGELOG 记录；**里程碑收口 → 次版本 +0.1（v0.4.0）**；实施计划移入 `docs/archive/`。

---

## 三、风险与未验证

| # | 风险 | 应对 |
|---|---|---|
| 1 | PBKDF2-SHA-256 600k 在手机上的耗时未知（桌面实测 95 ms） | 只在解锁时跑一次；M3 起步就在目标手机上量一次，超过 ~1.5 s 再评估参数（参数存 `user_crypto.kdf_iterations`，可平滑调整） |
| 2 | 本地搜索索引改造的回归面最大（拆列 + 过滤 + M2 用例改写） | Dexie 升版时**清空并重建 `searchIndex`**；用例先改后写实现（TDD）；反例清单里第 1、5 条专门盯它 |
| 3 | 多标签握手在老浏览器 / 无 `BroadcastChannel` 环境 | 降级为"每标签页独立"，不得因此阻塞解锁；已有 M2 的降级先例 |
| 4 | 存量账号（M1/M2 已注册）的空间行补建 | 登录时幂等补建 + 唯一索引兜底；用例覆盖"两次登录只一行" |
| 5 | 锁定态界面泄漏（列表 / 搜索 / 首页 / MCP） | 判定集中一处 + 反例清单逐条自动化；服务端 SQL 常量配断言 |
| 6 | `BACKUP_CRED_KEY` 轮换导致备份包裹失效 | 解锁态重新包裹即可修复；登记进运维注意项（Runbook 属 M6） |
| 7 | 界面稿未确认就写界面代码 | M3-1 为硬前置；计划里界面相关的步（M3-6 / M3-7 / M3-9 / M3-10）在稿子确认后才动 |

---

## 四、交付物

1. 代码：`packages/shared`（判定 + 设置契约）、`apps/worker`（迁移 0003 + crypto 端点 + 空间行）、`apps/web`（门禁核心 + 搜索改造 + 空间视图 + 单篇 + 设置页 + 标识）；
2. 线上可体验的隐私锁全流程（解锁 / 锁定 / 单篇 / 移入移出 / 改密重置关闭）；
3. M3 收口复核文档（逐条证据、偏离、未验证项）；
4. CHANGELOG 记录与版本 **v0.4.0**。

---

## 五、需要用户点头的事项

| # | 事项 | 状态 |
|---|---|---|
| 1 | **M3 界面稿**（M3-1 的产出） | ✅ 已确认（2026-09-27） |
| 2 | **附录 B 的 `wiki/` 回写清单**（设计稿 24 条 + 关于页 2 条） | ⬜ 待点头，建议与 M3 开工同批 |
| 3 | **`BACKUP_CRED_KEY` 的四处接线**（`.dev.vars.example` / 部署页 / `EnvBindings` / `vitest.config.ts`） | ⬜ 已获原则确认，落地时执行 |

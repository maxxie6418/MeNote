# Menote M3 收口验收复核

| 项 | 值 |
|---|---|
| 文档版本 | v1.1 |
| 文档状态 | 生效（收口复核记录） |
| 目的和适用范围 | M3（隐私锁与加密空间）收口时的逐条验收复核：设计 §11 的 **16 行能力矩阵 × 四态**、**20 项流程走查**、**7 条反例清单**逐条登记"怎么验的、证据在哪、有没有偏离"；同时列出未验证项与待用户拍板事项 |
| 权威级别 | 模块规则（M3 收口记录）。与 `wiki/` 冲突时以 `wiki/` 为准 |
| 最后更新日期 | 2026-09-28 |

修改记录：

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.4.0 | 2026-09-27 | M3 十四个提交批次的逐条验收复核、能力矩阵 16 行、流程 20 项、反例 7 条、偏离与未验证项、待拍板清单 | deepseek-v4.1-flash |
| v1.1 | v0.5.14 | 2026-09-28 | **实例机密收敛后的口径同步**（用户 2026-09-28 确认）：§六-1 的"前置动作"、§六-3 的"线上验收窗口"、§七 的"§六 七项未验证"门槛改为"**无需额外机密**（备份包裹键由 `AUTH_PEPPER` 域分离派生）"；§七"§五 八处偏离"①补注 M3 时用 `BACKUP_CRED_KEY`、2026-09-28 起改用派生键。其余复核结论不改 | deepseek-v4.1-flash |

## 一、收口时的实测证据

| 项 | 命令 | 结果 |
|---|---|---|
| 代码规范 | `pnpm lint` | exit 0 |
| 类型 | `pnpm typecheck` | exit 0（四个包全 Done） |
| 测试 | `pnpm test` | **644** 通过（shared 59 + mdcore 38 + web 429 + worker 118） |
| 构建 | `pnpm build` | exit 0 |
| 首屏体积 | `pnpm check:size` | **146.9 KB** gzip（上限 200 KB；M2 收口时 135.3 KB，M3 增加 11.6 KB） |
| 原型不变量 | `node prototype/verify-prototype.js` | 通过 55 / 失败 0 |
| 线框页 | `node prototype/verify-framework.js` | 通过 35 / 失败 0 |

M3 期间共 **14 个提交批次**（v0.3.3 → v0.3.18），其中 **2 次是线上问题修复**（见 §四）。

## 二、能力矩阵（设计 §11.1，逐格勾选）

列含义：**未启用** / **锁定** / **解锁·单篇未解密** / **解锁·单篇已解密**。

| # | 断言 | 未启用 | 锁定 | 解锁·未解密 | 解锁·已解密 | 证据 |
|---|---|---|---|---|---|---|
| 1 | 空间节点可见且含条目数 | ✓ | ✓（不可展开） | ✓ | ✓ | `VaultNode`（未启用显示"去启用"、锁定显示"已锁定 + 计数"）＋ `fnbar.test.tsx` 三态用例（含"锁定仍显示计数"） |
| 2 | 空间可展开、可浏览条目 | 不可（引导启用） | ✗ | ✓ | ✓ | `VaultNode`：未启用可点去设置、锁定只开解锁框、解锁后才渲染 `VaultTree` ＋ `fnbar.test.tsx` |
| 3 | 空间内条目出现在最近编辑/收藏/标签 | ✗ | ✗ | ✓ | ✓ | `filterByView(items, view, gate)` 先过 `canShowInList` ＋ `notes-views.test.ts`（锁定不出现、解锁出现、单篇仍列出） |
| 4 | 空间内条目**标题**可被搜到 | ✗ | ✗ | ✓ | ✓ | `searchLocal(…, gate)` 按 `searchFields` 决定标题/正文字段 ＋ `search-index.test.ts`（锁定标题不命中） |
| 5 | 空间内条目**正文**可被搜到 | ✗ | ✗ | 开关开时 ✓ | 开关开时 ✓ | 同上 ＋ `search-index.test.ts`（"解锁态与正文开关"用例） |
| 6 | Memo 与待办视图正常显示 | ✓ | ✗（整体占位） | ✓ | ✓ | `MemoPanel` / `TaskPanel` 的 `gate` 分支 ＋ `memos-panel` / `tasks-panel` 各自锁定占位用例（含"解锁按钮是活出口"） |
| 7 | Memo 可被搜到 | ✓ | ✗ | ✓ | ✓ | `search-index.test.ts`（"范围内且锁定时 Memo 完全搜不到；移出范围后照常"） |
| 8 | 单篇条目标题在列表可见 | ✓ | ✓ | ✓ | ✓ | `NoteList` 行标识（标题恒明文）＋ `notes-views.test.ts`（单篇仍在三视图） |
| 9 | 单篇条目**标题**可被搜到 | ✓ | ✓ | ✓ | ✓ | `searchFields` 的"单篇标题任何状态可搜" ＋ `search-index.test.ts`（锁定态命中 `field === "title"`） |
| 10 | 单篇条目**正文**可读 | ✗（需先解密） | ✗ | ✗ | ✓ | `LockedDocPanel`（编辑器**根本不挂载**）＋ `privacy-doc.test.tsx`（锁定占位、解锁后编辑器挂载） |
| 11 | 单篇条目**正文**可被搜到 | ✗ | ✗ | ✗ | 开关开时 ✓ | `search-index.test.ts`（"单篇逐篇解密后才搜得到正文"：同一 gate 换 `unlockedItems`） |
| 12 | 首页统计/导航/文件夹树/标签云计数**含全部内容** | ✓ | ✓ | ✓ | ✓ | `homeStats` 不过门禁、`collectTags` 不过门禁 ＋ `home-model` / `notes-views`（"标签云计入隐私条目"） |
| 13 | 「关闭隐私锁」入口可用 | — | 有隐私内容时 ✗（说明原因） | 同左 | 无隐私内容时可关 | 设置页关闭按钮 ＋ worker `crypto.test.ts`（有内容 422 + `detail.reason = privacy_content_exists`、无内容可关） |
| 14 | 「开启单篇加密」入口可用 | ✗（引导启用） | **✓（Q25）** | ✓ | ✓ | 编辑器「更多」菜单 ＋ `privacy-doc.test.tsx`（锁定态可加密、未启用时禁用并说明）＋ worker（未启用/Memo 两种拒绝） |
| 15 | 「移入加密空间」入口可用 | ✗（引导启用） | ✓（只能入根） | ✓（可选层级） | ✓ | `NoteList` 行菜单 ＋ `ui.test.tsx`（四态）＋ worker `items-privacy.test.ts`（目标自洽四条） |
| 16 | 「移出空间 / 取消单篇」入口可用 | — | ✗（先解锁） | 移出 ✗ / 取消 ✗ | ✓ | 行菜单 `disabled: vault.locked` ＋ `privacy-doc.test.tsx`（"已加密但未解锁时取消加密被拦住并说明原因"） |

**矩阵缺口（如实登记）**：第 3、8 行只验到"过滤函数的门禁行为 + 列表标识"，**没有**一条"渲染出的三视图在解锁/锁定切换瞬间立即少一行/多一行"的端到端断言；这条留给 §三 的线上逐屏（与反例 3、7 同源）。

## 三、流程走查（设计 §11.2，20 项）

| # | 流程 | 结论 | 证据 / 说明 |
|---|---|---|---|
| 1 | 启用隐私锁 | ✅ 自动化 | `privacy-settings.test.tsx`（两次输入校验 + 联网说明）＋ worker（`PUT /api/crypto` 形状校验、缺机密 503） |
| 2 | 三档各解锁一次（会话 / N 分钟 / 设备长期） | ✅ 自动化 | `privacy-model.test.ts`（档位与到期时刻）＋ `privacy-ui.test.tsx`（胶囊三态文案与菜单改档） |
| 3 | 立即锁定 | ✅ 自动化 | `privacy-model`（`lockAll` 清单篇集合）＋ `privacy-ui`（菜单「立即锁定」回调） |
| 4 | 30 秒倒计时提示 | ✅ 自动化（文案） | `privacy-status.test.tsx`（>30s 不提示、≤30s 提示"会先保存"）；**"胶囊闪烁一次"未做**（需 CSS 动画，待视觉定稿） |
| 5 | 单篇加密开启（**锁定态**，Q25） | ✅ 自动化 | `privacy-doc.test.tsx`（锁定态「加密此篇」可用） |
| 6 | 单篇逐篇解密（开 A 后 B 仍锁） | ✅ 自动化 | `privacy-model`（`unlockedItems` 是集合、`lockItem` 只动一条）＋ `privacy-doc`（逐篇语义） |
| 7 | 锁上此篇 / 锁上全部单篇 | ✅ 自动化 | `privacy-doc.test.tsx`（两个菜单项的可用性与回调）＋ `privacy-lock.test.tsx` |
| 8 | 移入空间（解锁态选层级） | ✅ 自动化 | `ui.test.tsx`（解锁后列出空间内文件夹）＋ worker（目标必须在空间内） |
| 9 | 移入空间（**锁定态**单篇入根） | ✅ 自动化 | `ui.test.tsx`（锁定只给入根、不下发层级） |
| 10 | 整夹移入（含两层限制校验） | ✅ 自动化 | `notebook-panel.test.tsx`（进度行、失败清单、重试）＋ `folders-vault.test.ts`（四种拒绝、空间根不可移可改名） |
| 11 | 移出空间 | ✅ 自动化 | `ui.test.tsx`（空间内条目才显示移出、锁定时置灰）＋ worker（移出目标不能在空间内） |
| 12 | 批量标记的进度与失败重试 | ✅ 自动化 | `batch.test.ts`（逐条、失败跳过、进度、兜底原因）＋ `notebook-panel.test.tsx`（"处理中 1 / 3" + 失败清单 + 重试） |
| 13 | 修改隐私密码（验旧备份说明） | ✅ 自动化 | `privacy-settings.test.tsx`（含"已加密的内容不受影响"）＋ `privacy-lock` 的 `changePassword` 路径 |
| 14 | 重置隐私密码（不丢内容、`reset` 返回 K） | ✅ 自动化 | worker `crypto.test.ts`（端到端：启用时交出的 K，重置原样解回来）＋ `privacy-settings`（文案"内容密钥没有变"） |
| 15 | 关闭隐私锁（有内容被拒 → 清空后成功） | ✅ 自动化 | worker `crypto.test.ts`（有内容 422 + 原因、无内容清理材料）＋ `privacy-settings`（把原因显示出来） |
| 16 | 多标签握手（A 解锁 B 即解锁；A 锁定 B 即锁） | ⏳ **需真实浏览器** | 逻辑在 `usePrivacyLock` 的广播订阅/应答里，`sync-broadcast.test.tsx` 只覆盖**通道层**（事件解析）；jsdom 不实现 `BroadcastChannel`，真实握手要开两个标签页手验 |
| 17 | 离线解锁（断网但有缓存） | ✅ 自动化（离线路径） | `privacy-lock.test.tsx`（有缓存、服务端拉不到时仍能解锁——**这正是缓存的意义**，且修掉过一个真 bug） |
| 18 | 无缓存离线（提示需联网） | ✅ 自动化 | `privacy-settings`/`privacy-lock`（无本地材料时禁用并说明"需要联网校验"） |
| 19 | **存量账号**登录后空间行自愈补建 | ✅ 自动化（服务端） | worker `enc-space.test.ts`（注册即建、幂等、并发补建、存量账号）＋ 客户端不依赖该行存在（`VaultNode` 恒显示） |
| 20 | MCP 令牌读 Memo（与范围设置无关） | ⏳ **M6 未做** | 服务端已有唯一隐私过滤常量 `PRIVACY_EXCLUDE_SQL` 且被搜索断言引用；MCP 落地时直接引用它（设计 §5.3 的 I3/I4） |

**20 项小结**：**17 项自动化覆盖**，**3 项待外部条件**（16 需真实浏览器、20 属 M6、4 的动画部分待视觉定稿）。

## 四、反例清单（设计 §11.3，7 条）

| # | 反例 | 结论 | 防它的是什么 |
|---|---|---|---|
| 1 | 锁定态下搜索命中隐私条目**正文** | ✅ 有用例 | `search-index.test.ts`：锁定态"空间正文/单篇正文"均搜不到 |
| 2 | 锁定态下首页「最近动态」列出空间内条目标题 | ✅ 有用例 | `home-model.test.ts`：`recentPreview(items, gate)` 锁定不列空间条目（而 `homeStats` 仍计入——两者刻意不同） |
| 3 | 锁定态下 `ItemRow`/三视图出现空间内条目 | ✅ 有用例 | `notes-views.test.ts`：`filterByView` 锁定时空间条目不出现、单篇仍列出 |
| 4 | 隐私条目出现在 MCP 查询结果或 `list_folders` 计数里 | ⏳ **M6 前用常量断言** | `db/privacy.ts` 的 `PRIVACY_EXCLUDE_SQL`（唯一处）＋ `apps/worker/test/search.test.ts` 断言"搜索语句里必须出现该常量"；MCP 落地后必须引用它 |
| 5 | 解锁但单篇未解密时正文被渲染或进搜索结果 | ✅ 有用例 | `privacy-doc.test.tsx`（`LockedDocPanel`：编辑器**不挂载**）＋ `search-index.test.ts`（单篇正文锁定搜不到） |
| 6 | 计数漏掉隐私内容 | ✅ 有用例 | `home-model.test.ts`（`homeStats` 含全部）＋ `notes-views.test.ts`（标签云计入） |
| 7 | 设置改动 / 登录后被清空的解锁态没有立即重渲染（界面残留明文） | ✅ 有据（部分靠结构保证） | 门禁对象进 `useMemo`/`useEffect` 依赖，其身份变化必然重渲染；`privacy-cache.test.ts`（`rev` 变高 ⇒ `invalidatesUnlock`）＋ `privacy-lock.test.tsx`（解锁态被清空后 `runtime` 复位）；**端到端渲染断言**见 §二 的矩阵缺口说明 |

## 五、偏离与实现选择（都已写进对应文档）

| 项 | 计划写法 | 实际做法 | 理由 |
|---|---|---|---|
| 首次启用的第二份包裹由谁包 | 浏览器包两份 | **服务端**用 `BACKUP_CRED_KEY` 包 `k_wrapped_backup`（`PUT /api/crypto` 带一次性明文 `k`） | 浏览器拿不到也不该拿到该机密；内容本就明文存储，服务端知道 K 不改变保护边界（设计 P1/P3） |
| 关闭隐私锁被拒的状态码 | 409 | **422 `invalid` + `detail.reason`** | 现有错误码表没有"状态冲突"这一类，新增错误码属 API 契约变更，留待需要时统一加 |
| 二进制线上编码 | base64 | **base64url** | 与登录密钥、会话令牌同一套（复用 shared 的 `base64url.ts`） |
| 隐私过滤常量的形状 | `PRIVACY_EXCLUDE_SQL = "enc_self = 0 AND …"` | 带别名的 `privacyExcludeSql(alias)` + 默认常量 | 要直接拼进 `items` 查询，别名由调用方定 |
| 空间视图的组件落点 | `features/privacy/ui/VaultPanel.tsx` + `VaultDocEmpty.tsx` | 空间视图**就是作用域在空间里的笔记视图**（复用 `NoteList`/`NoteWorkspace`），空间文件夹树挂在 `app/fnbar/VaultTree.tsx` | 只有 `app/` 允许同时依赖 notes 与 privacy 两个 feature（架构 §2.3.3）；也避免再起一套双栏骨架 |
| 搜索标注的实体 | 结果行带标注 | `SearchItemLike` 增可选 `enc_self`/`in_enc_space`，**服务端来源恒为空** | 服务端搜索恒排除隐私内容，缺省即"无标记"，不需要额外区分 |
| `App.tsx` / `useNotesWorkspace.ts` 行数 | 500 行预算内 | 按用户授权**多次拆分**：`AuthScreens`/`PrivacySlot`/`MemoView`/`TaskView`/`SettingsView`/`NotesPane`/`NotesSlot`/`NavPanels`（app）+ `useVaultScope`/`useNoteCreation`/`useItemPatchActions`（feature） | 入口文件只做装配，装配块越拆越薄；两个确认点之一就是这个 |
| M3-11 `crypto-format` | M3 落最小骨架 | **顺延到 M5**（设计本就允许） | 消费方是 M5 的备份导出；格式已定稿，实现独立，不影响 M3 验收 |

## 六、未验证项（明确留白，不假装验过）

1. **线上逐屏点验**：`https://me.861306.xyz` 上尚未逐屏走过 M3 的隐私流程（**前置动作**（2026-09-28 起）：**无需额外机密**——备份包裹键由 `AUTH_PEPPER` 域分离派生，原 `BACKUP_CRED_KEY` 已删除，配好 `AUTH_PEPPER` 即可）；
2. **真实浏览器的多标签握手**（流程 16）：jsdom 不实现 `BroadcastChannel`，只验了通道层与降级路径；
3. **真机 PBKDF2 600k 耗时**（设计风险 #1）：桌面实测 ~95 ms，**目标手机未测**；参数存在 `user_crypto.kdf_iterations`，可平滑调整；
4. **真实断网**下的离线解锁：验的是"服务端拉不到时用缓存"这条路径，没有真拔网线跑；
5. **大数据量下的搜索与批量**：批量用于例覆盖了逐条/失败/进度，但没有在几百条规模上观测耗时；
6. **MCP 的隐私排除**（反例 4）：M6 才有 MCP 本体；
7. **胶囊"剩 30 秒闪烁一次"**：需 CSS 动画，按界面规则要先把视觉效果定稿（功能面的提示已落地）。

## 七、待用户拍板

1. **补一个"开锁"字形**（胶囊与列表的"已解锁/已解密"态现在与"已锁定"共用 `lock` 图标，靠颜色 + 文字区分）：要动 `apps/web/src/app/ui/Icon.tsx` 与 `DESIGN.md §5.5`；
2. **`M3-11`（`crypto-format`）顺延到 M5 前**——请确认；
3. **线上验收窗口**：只需在 Cloudflare 端配好 `AUTH_PEPPER`（**2026-09-28 起无需第二个机密**：备份包裹键由它域分离派生）即可跑 §六-1 的逐屏点验；
4. **移动端界面稿的 3 条阻塞项**（M2 遗留，仍在挂）。

---

## 八、M4 收口时的复核（2026-09-27 追加）

M4 期间改动了不少 M3 碰过的地方（共享包、同步层、正文加载、图标与拆分层），所以按"M4 收口前的账目核对"把本文的结论**逐条对回当前代码**。**结论：没有一处过时**，另有三条补充事实。

**§五 八处偏离**：逐条仍成立——①`k_wrapped_backup` 由服务端包出（M3 时用 `BACKUP_CRED_KEY`；**2026-09-28 起改用 `AUTH_PEPPER` 域分离派生的备份包裹键**）（迁移 0003 + `services/crypto.ts` + 端到端用例都在）；②关闭被拒仍是 **422 + `detail.reason`**；③二进制线上编码仍是 base64url（`packages/shared/src/base64url.ts`，登录密钥与会话令牌同源）；④`privacyExcludeSql(alias)` + 默认常量都在，**且服务端搜索确实用它**（`services/search.ts` 导入 `PRIVACY_EXCLUDE_SQL` 拼进 `WHERE`——这条我在核对时一度以为它没人用，是我自己的检索命令在多根目录 `-Include` 下漏了文件，**再查确认无问题**）；⑤空间视图复用笔记视图、空间树在 `app/fnbar/`（`VaultTree` / `VaultNode` / `NavPanels`）✓；⑥`SearchItemLike` 的可选字段 ✓；⑦入口拆分的清单**在 M4 又多了一项**（`fnbarWiring` 从 `App.tsx` 抽出，见 M4 收口复核 §五-12）；⑧`M3-11 crypto-format` 仍**顺延**——`packages/` 下目前只有 `mdcore` 与 `shared`，该包尚未创建，与"顺延到 M5"一致。

**§六 七项未验证**：全部仍未验证（线上逐屏的门槛没变：本机 `wrangler` 未登录；**2026-09-28 起不再需要额外机密**——备份包裹键由 `AUTH_PEPPER` 域分离派生，原 `BACKUP_CRED_KEY` 已删除；多标签握手与 PBKDF2 真机耗时仍需真实浏览器/手机；真断网、大数据量仍是留白；MCP 属 M6；"剩 30 秒闪烁"仍需先定视觉效果）。**M4 又给线上验证添了一批**（R2 桶、Cron 真的在跑、附件的四个流程），合并清单在《M4 发布清单》§五。

**§七 四条待拍板**：全部仍在挂，其中第 1 条**可以更精确了**——M4 收口时做了一次**图标集审计**：`IconName` 联合的 20 个名字与 sprite 的 20 个字形**一一对应、无缺口也无多余**，而**缺的确实只有 `unlock` 一个**（胶囊与列表的"已解锁/已解密"态仍与"已锁定"共用 `lock` 图标，靠颜色 + 文字区分）。要补它需动 `apps/web/src/app/ui/Icon.tsx` 与 `DESIGN.md §5.5`（改视觉源 → 需你同意）。

**另记一条工具层面的教训**：本次核对里我用一条"快速检索命令"判断"某常量无人使用"，结论是错的（多根目录 + `-Include` 会漏文件）。**凡是要下"没人用/没接上"这种结论，必须用能列出文件名与行号的方式再确认一次**——这与 §8.2 的两条审计手段是同一个道理：**审计工具本身先要自证**。

# Menote M2 收口验收复核

| 项 | 值 |
|---|---|
| 文档版本 | v1 |
| 文档状态 | 生效（收口复核记录） |
| 目的和适用范围 | M2（界面与本地功能里程碑）收口时的逐条验收复核：每条验收点**怎么验的、证据在哪、有没有偏离**；同时列出未验证项与待用户拍板的事项 |
| 权威级别 | 模块规则（M2 收口记录）。与 `wiki/` 冲突时以 `wiki/` 为准 |
| 最后更新日期 | 2026-09-26 |

修改记录：

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.3.0 | 2026-09-26 | M2 九个步骤的逐条验收复核、偏离与未验证项、待拍板清单 | deepseek-v4.1-flash |

## 一、收口时的实测证据

| 项 | 命令 | 结果 |
|---|---|---|
| 代码规范 | `pnpm lint` | exit 0 |
| 类型 | `pnpm typecheck` | exit 0 |
| 测试 | `pnpm test` | **464** 通过（shared 29 + mdcore 38 + web 307 + worker 90） |
| 构建 | `pnpm build` | exit 0 |
| 首屏体积 | `pnpm check:size` | **135.3 KB** gzip（上限 200 KB） |
| 原型不变量 | `node prototype/verify-prototype.js` | 55 / 55 |
| 线框页 | `node prototype/verify-framework.js` | 35 / 35 |

## 二、M2 各步验收点复核

| 步 | 验收点 | 证据 | 结论 |
|---|---|---|---|
| M2-1 mdcore | 标签来自 YAML + 正文 `#标签`；任务字段从 YAML 解析；前后端同一份实现；纯函数 | `packages/mdcore/test/*`（38 用例，含改写保真、容错降级、标签语法边界） | ✅ |
| M2-2 框架 | 录入框 136px / 导航区 y=252 不变量；两种导航造型区分；加密空间贴底固定；功能栏无账户区；录入框三行顺序 | `apps/web/test/layout-invariants.test.ts`（结构尺寸/几何/无裸色值/渐变令牌）+ `fnbar.test.tsx`（DOM 结构：加密空间是滚动区兄弟、无账户区） | ✅ |
| M2-3 文件夹 | 两层限制（第 2 层无"新建子文件夹"入口）；移动目标非法时置灰并说明、服务端同样校验；重命名走 `meta_rev`；四个视图同构；行内显示摘要/时间/同步状态/置顶收藏 | `notes-folders.test.ts`（9）+ `notebook-panel.test.tsx`（11）+ `apps/worker/test/folders*`（服务端两层校验） | ✅（删除按修正移至 M4） |
| M2-4 Memo | 时间轴按设置时区分天；发布乐观免密；`- [ ]` 触发"设为清单？"；原位编辑 `Ctrl+Enter`/`Esc`；无收藏；转笔记单向且原 Memo 保留显示链接 | `memos-model.test.ts`（13，含跨时区边界）+ `memos-panel.test.tsx`（9）+ `fnbar.test.tsx`（清单提示与乐观发布） | ✅（瀑布流随 M4 图片、锁占位随 M3） |
| M2-5 待办 | 独立导航项与列表/看板切换；看板点卡片改状态即改 YAML；排序筛选纯本地；新建清单默认"待办"；去掉标记删字段；字面量定死并补约束 | `tasks-model.test.ts`（17）+ `tasks-panel.test.tsx`（7）+ `apps/worker/test/task-constraints.test.ts`（7，直接走 SQL 验触发器） | ✅（**约束用触发器而非 CHECK**，理由见数据模型稿 v1.3） |
| M2-6 搜索 | 顶栏入口 + `Ctrl/Cmd+K`；清空回原视图；标题/正文/标签；过滤与高亮片段；离线优先；索引按 `sync_seq` 增量；未建完回退服务端并提示；隐私过滤位集中一处 | `search-model.test.ts`（17）+ `search-index.test.ts`（14）+ `search-panel.test.tsx`（8）+ `search-hook.test.tsx`（4）+ `apps/worker/test/search.test.ts`（9） | ✅（**`search.worker.ts` 未做**：检索在纯函数模块里，接口不变） |
| M2-7 设置 | 两栏分页 + 只显示已实现分类；页头三要素；通用页四项；编辑器页三档 + 第四档置灰；快捷菜单 5 候选；账户快捷菜单结构与"主题切换不收起菜单"；即时生效并同步 | `settings-client.test.ts`（6）+ `account-menu.test.tsx`（7）+ `ui.test.tsx` 设置壳（5）+ `apps/worker/test/settings.test.ts`（6） | ✅（启动视图随 M2-8 接上） |
| M2-8 首页 | 数据全由本地元数据算、不发额外请求；统计始终含加密条目；Memo 部分锁定时占位；各卡片有空态 | `home-model.test.ts`（9）+ `home-panel.test.tsx`（8，含锁定两条分支） | ✅ |
| M2-9 同步补全 | BroadcastChannel 广播与"已在其他标签页修改"提示；`POST /api/batch` 单批 ≤45 语句、逐操作独立判定；冲突对比与保留 | `sync-broadcast.test.tsx`（5）+ `sync-engine.test.tsx`（3）+ `notes-remote-change.test.tsx`（4）+ `sync-push-batch.test.tsx`（4）+ `apps/worker/test/batch.test.ts`（9）+ `notes-conflict.test.tsx`（5） | ✅（trash/restore 并入 M4） |

## 三、偏离与实现选择（都已写进对应文档）

| 项 | 计划写法 | 实际做法 | 理由 |
|---|---|---|---|
| 任务字段约束 | 给 `items` 补 CHECK | **触发器**（0002 迁移，6 条） | SQLite 补 CHECK 只能重建热表，风险与收益不成比例 |
| `user_settings` 进同步 | 含 `sync_seq`、进单一游标 | 整份带回、**不参与游标**（schema optional 兜部署窗口） | 一行数据，并进取小的收益不抵复杂度 |
| 搜索 Worker 化 | `search.worker.ts` | 未做，检索在纯函数模块 | 个人量级不阻塞界面；接口不变，后续只改调用方式 |
| Memo 瀑布流 / 锁占位 | M2 落地 | 移到 M4 / M3 | 依赖图片管线 / 门禁行为 |
| 删除（文件夹与 Memo） | M2 落地 | 并入 M4（回收站） | 没有回收站的删除不可逆 |
| 看板改状态 | "点卡片或拖到另一列" | 卡片上的文字按钮 | 无障碍友好，不把拖拽当唯一入口（禁止项 #16） |

## 四、未验证项（收口时明确留白，不假装验过）

1. **真机两设备同步验证**（M1 遗留）：目前只在本地 workerd + 单元/集成测试层面验证过；
2. **跨标签页广播的真实浏览器验证**：jsdom 不实现 `BroadcastChannel`，测试走的是**降级路径**与替身；
   真实广播行为需要开两个标签页手验；
3. **移动端布局**：`DESIGN.md` §2.4 未定稿，本轮只守住"不留仅桌面成立的写法"；
4. **云端逐屏点验**：M2 新增的界面尚未在 `https://me.861306.xyz` 上逐屏走过（云端此前验证的是 M1）；
5. **搜索的服务端兜底**：只在 worker 测试里验过接口与 SQL，未在真实大数据量下观测过。

## 五、待用户拍板

1. **`wiki/` 同步清单**（改定稿须用户同意）：
   - 《项目架构》§2.3.2 落点表补：`packages/mdcore`、`apps/worker/src/routes/search.ts` +
     `services/search.ts` + `services/batch.ts`、`apps/web/src/data/db/{search,settings,conflicts}.ts`、
     `apps/web/src/features/{search,tasks,home,memos}/`；
   - 《功能拆解》/需求中与实现不一致的两处旧写法：账户入口位置（已在 M2-7 按【已定】口径实现）、
     功能栏是否出现加密空间；
   - `wiki/components.md` 的 5 处措辞收敛 + 新增组件名（`CardQuickMenu`、`SearchPanel`、`TaskCard`、
     `HomeCard`、`MemoItem` 等）。
2. **移动端界面稿的 3 条阻塞项**（三段数量 / 顶栏保留几块 / 页签与输入行顺序）——第 2 条要改
   `DESIGN.md` §2.5-1 的【已定】内容与脚本断言。

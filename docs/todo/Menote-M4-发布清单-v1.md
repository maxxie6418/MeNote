# Menote M4 发布清单（v0.5.0）

| 项 | 值 |
|---|---|
| 文档版本 | v1 |
| 文档状态 | 评审中（**待用户拍板 12 条后按本清单逐项执行**） |
| 目的和适用范围 | M4 收口与 v0.5.0 发布的**执行清单**：前置拍板、代码动作、文档动作、发布动作、发布后验证、范围守卫。写完即归档 |
| 权威级别 | 临时规则（执行清单；执行完并入《M4 收口验收复核》并归档 M4 计划） |
| 最后更新日期 | 2026-09-27 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.4.34 | 2026-09-27 | 首版：六段清单（前置 / 代码 / 文档 / 发布 / 发布后 / 范围守卫），逐项带命令或文件路径 | deepseek-v4.1-flash |

---

## 一、前置：拍板结论（逐条填结论）

依据《M4 待拍板影响清单 v1.1》的 12 条。**回"按建议"即按下表右列执行**。

| # | 决策 | 建议 | 结论（待填） |
|---|---|---|---|
| 1 | 缩略图浏览器端生成 | 确认现状 | |
| 2 | 附件管理页留 M6 | 留 M6 | |
| 3 | 版本回滚语义（四步） | 确认现状 | |
| 4 | 附件不设硬配额 | 确认现状 | |
| 5 | 版本历史＝独立面板页 | 确认现状（不改 `DESIGN.md`） | |
| 6 | 保留密度只读 | 只读 | |
| 7 | 「标记为保留」可取消 | 可取消 | |
| 8 | 永久删除确认框不提快照 | **不提** | |
| 9 | 删除附件引用入口 | 留 M6（需接口变更） | |
| 11 | 允许降级改 `items.type`（单向） | **做** | |
| 12 | 扩服务端支持文件夹永久删除 | **做** | |
| 13 | `session` 封存怎么落地 | **B：服务端按 `last_device` + `last_edit_at` 自动判** | |

## 二、代码动作（拍板后执行；每步一个提交）

| 步 | 做什么 | 涉及文件 | 验收 |
|---|---|---|---|
| C1 | **降级改 `items.type`**（第 11 条）：`ItemMetaPatchSchema` 增**单向**类型变更字段（只允许 `table → note`，校验非 Memo / 不在加密空间） | `packages/shared/src/items.ts`、`apps/worker/src/services/items.ts`（`patchItemMeta` 分支）、`features/notes/ui/NoteWorkspace.tsx`（去掉禁用、接上写入）、`features/tables/ui/TableEditor.tsx` | worker 用例：合法降级成功、非法（note→table / Memo / 空间内）被拒；web 用例：确认框点"降级"后真的写 |
| C2 | **文件夹永久删除**（第 12 条）：`permanentDeleteItems` 增文件夹分支（删 `folders` 行 + `entity='folder'` 墓碑，与条目同批共享 `sync_seq`）、`emptyTrash` 一并处理 | `apps/worker/src/services/trash.ts`、`routes/trash.ts`（若需区分）、`features/trash/ui/TrashPage.tsx`（去掉置灰）、`features/trash/useTrash.ts` | worker 用例：删文件夹行 + 墓碑；web 用例：文件夹行「永久删除」可用且真的提交 |
| C3 | **`session` 封存（B 方案）**（第 13 条）：正文保存路径里比较 `items.last_device` 与本次设备头、以及 `last_edit_at` 的间隔（> 1 小时或设备不同）→ 自动封存一条 `session`（`keep=0`） | `apps/worker/src/services/items.ts`（保存路径）、`services/versions.ts`（复用 `sealVersion`） | worker 用例：换设备保存 → 多一条 `session` 版本；同设备连续保存 → 不产生 |
| C4 | （可选，第 9 条若改为现在做）**引用集合对齐**：`PUT /api/items/:id/body` 携带引用集合 | `packages/shared/src/items.ts`、`routes/items.ts`、`features/attachments/model.ts`（用上 `extractAttachmentRefs`） | 用例：删掉正文里的引用后，`attachment_refs` 随之减少 |

> 每步落地后**都要跑**：`pnpm lint` / `pnpm typecheck` / `pnpm test`，并**顺带跑一遍调用点审计**（新增的界面/接口必须能贴出调用点）。

## 三、文档动作

| # | 动作 | 文件 | 说明 |
|---|---|---|---|
| D1 | 收口复核**转「生效」** | `docs/modules/Menote-M4-收口验收复核-v1.md` | 把 §一 的实测数字按最终一次重跑更新；§七 每条标结论；文档状态改「生效」 |
| D2 | **设计文档 v7.6 的处理**（§九 唯一剩下的一行） | `wiki/Menote-设计文档-v7.4.md` | 三选一：**照做**（改 §10.2 / §12.4 / §14.3 并升 v7.6 + 补修订记录）/ **只加标注**（就地标"M4 已实现，口径见 X"，不升版）/ **先不动**（等 v7.6 那一批一起改）。**改 `wiki/` 需你明确同意** |
| D3 | **`AGENTS.md` 状态段更新** | `AGENTS.md` | 按 M1–M3 收口的先例：`当前版本` → v0.5.0；「现在做到哪」改写为 M4 已收口（落地内容 + 收口复核路径 + 未做项与归属），下一步 M5（分享 / 导出 / 备份）。**只改状态事实，不动规则条款** |
| D4 | **M4 实施计划归档** | `docs/todo/Menote-M4-实施计划-v1.md` → `docs/archive/` | ①先把头部 `文档状态` 改为「**已完成**（M4 收口；本文件已归档）」；②移动文件；③改引用：`docs/todo/Menote-开发计划-v1.md` 第 189 行的路径改为 `docs/archive/…` |
| D5 | **待办分派**（未做项写进后续里程碑） | `docs/todo/Menote-开发计划-v1.md` | 把"删除附件引用入口 + 附件管理页 + 引用集合对齐 + `pre_mcp` 封存"归 M6；"`pre_conflict` 封存"归 M5/M6 看 M2 的冲突副本路径；"版本列表页脚已保留 N 个 / `sealed_rev` 去留 / 拖拽之外的小项"归 M5 顺手项 |
| D6 | wiki 三份**修订记录**的应用版本号核对 | `wiki/Menote-项目架构-v1.md`、`wiki/components.md`、`wiki/Menote-功能拆解-v2.md` | 已是 `v0.4.25（M4 收口期间的写回；里程碑版本为 v0.5.0）` ✓ 无需再动；**只核对不修改** |

## 四、发布动作

| # | 动作 | 命令 / 文件 | 验收 |
|---|---|---|---|
| R1 | 版本号升到 **0.5.0** | 根 `package.json` | `pnpm --filter @menote/web exec vitest run test/version-consistency.test.ts` 通过 |
| R2 | CHANGELOG 顶部写 **v0.5.0 收口条目** | `CHANGELOG.md` | 一句话说清"里程碑收口"并列出：M4 四域落地、wiki 三份已同步、收口复核路径、未做项与归属、测试与体积数字 |
| R3 | 五条命令 + 审计三步重跑 | `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm check:size`；调用点检查 / 可达性 / 端点覆盖 | 全绿；把**实测数字**填进收口复核 §一（测试总数 / gzip 体积） |
| R4 | 代码与文档**分开提交**、逐个点名文件 | `git add <显式路径>` + `git commit -F .git/COMMIT_MSG.txt` | `git log -1 --format="%s"` 与预期一致再 push |
| R5 | 推送 | `git push` | `git rev-parse HEAD` == `origin/main` |
| R6 | 收口清单自身归档 | 本文件 → `docs/archive/`（在 D4 之后一并移动） | `docs/todo/` 不再有 M4 的执行文件 |

> **不引入 git tag**：仓库至今没有 tag，收口不新发明惯例。

## 五、发布后（线上验证；本机 wrangler 未登录，需在部署后做）

| # | 项 | 怎么看 |
|---|---|---|
| P1 | R2 桶确实存在 | Dashboard → R2 → `menote-attachments`；若 Workers Builds 未自动供给则手建同名桶 |
| P2 | Cron 真在跑 | 部署后等一轮 15 分钟 → Workers 日志里看 `scheduled` 的 summary（含 `idleSeal` / `maintenance`） |
| P3 | 附件端到端 | 线上粘贴一张图 → 状态栏进度 → 列表出现 → 刷新后仍在；再传同一张 → 提示"已复用同一文件" |
| P4 | 版本端到端 | 编辑器「更多」→ 版本历史 → 存为版本 → 改正文 → 与当前稿对比 → 恢复 → 确认可再撤回 |
| P5 | 回收站端到端 | 删条目 / 删文件夹（看确认框计数）→ 回收站页看到两者 → 恢复 → 永久删除（条目） |
| P6 | **正文按需取**（v0.4.31 修的那条） | 浏览器清掉站点数据（或换设备）→ 打开一篇旧笔记 → **应看到正文而不是空白** |
| P7 | 移动端底线 | 窄屏打开表格与回收站：滚动每层一个、操作都有非悬停入口 |

## 六、范围守卫（收口期间**不要**顺手做）

1. **不碰 M5/M6 的东西**：分享、导出、备份、附件管理页、MCP、成员管理——它们的接口位已在代码里，别提前实现；
2. **不改 `DESIGN.md` 与 `wiki/` 的规则条款**：本轮只在 D2 的三选一范围内动设计文档，其余 wiki 文件只读；
3. **不新增依赖**、不改部署方式 / 端口 / 环境变量约定；
4. **不再扩大审计范围**：五轮审计已经足够；收口期间只跑既定的三步，不新开审计线。

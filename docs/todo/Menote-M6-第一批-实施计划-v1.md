# Menote M6 第一批实施计划：分享失效兜底 + 附件引用闭环

| 项 | 值 |
|---|---|
| 文档版本 | v1.1 |
| 文档状态 | 待执行（设计稿《Menote-M6-第一批-分享失效与附件引用-设计-v1》确认后开工） |
| 目的和适用范围 | 拆步、涉及文件与验收点。设计口径以那份专项设计为准，本文件只管怎么落地 |
| 权威级别 | 临时规则（M6 第一批的执行清单） |
| 最后更新日期 | 2026-10-03 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.6.18 | 2026-10-03 | 初稿。依据《M6 第一批设计》v1 拆步 | MiniMax-M3.1-Flash-Preview |
| v1.1 | v0.6.20 | 2026-10-03 | 回填进度：**批 1（步 1.1–1.3）与批 2a（步 2.1–2.10）已落地**。记三处实施中才浮现的事实：①`json_each` 在 D1 **实测可用**（步 2.3 的探针用例已证，不必再退回分片方案）；②`PushApi.saveBody` 的参数顺序**改成与 `itemsApi.saveBody` 一致**（deviceId 在前、refs 在后），`push.ts` 里那层「按上下文包一层」的包装因此整个删掉——既省了 11 行预算，也少一个「把引用数组当 deviceId 发出去」的坑；③`SQL_DELETE_ITEM_DRAFT_REFS` 的注释写着「历史版本引用不能动」而语句漏了 `version_id IS NULL`，**被新写的用例当场抓住** | MiniMax-M3.1-Flash-Preview |

---

## 目标

一批两件事，都是**已登记的欠账**、不是新功能：

1. **软删条目连带撤销分享**——修「从回收站恢复后链接复活」这个真缺陷。
2. **附件引用闭环**——保存正文时对齐 `attachment_refs`（与正文同一次写）、删除正文里附件引用的入口、附件管理页。

## 拆步

每步结束都是一次可提交、可推送、可验证的落点（按 AGENTS.md「每完成一个关键阶段就即时提交并推送」）。

### 批 1 · 服务端连带撤销

| 步 | 做什么 | 涉及文件 |
|---|---|---|
| 1.1 | `softDeleteItem` 的 batch 加第三条 `UPDATE shares SET revoked_at …`（限 `user_id`、限 `revoked_at IS NULL`、不推 `sync_seq`） | `apps/worker/src/services/trash.ts` |
| 1.2 | **待拍板**：若选「加密此篇也连带撤销」，在 `patchItemMeta` 的 `enc_self` 置位路径加同样语句 | `apps/worker/src/services/item-meta.ts` |
| 1.3 | 用例：软删→恢复→访客**仍** `invalid`（核心断言）；重复软删幂等；跨租户不误伤；撤销分享不影响附件/版本/条目 | `apps/worker/test/shares.test.ts`、`apps/worker/test/trash.test.ts` |

### 批 2a · 引用集合对齐

| 步 | 做什么 | 涉及文件 |
|---|---|---|
| 2.1 | shared 契约：`ITEM_REFS_HEADER` + `encodeAttachmentRefs` / `decodeAttachmentRefs`（base64url JSON，与 `encodeItemWriteMeta` 同款），带用例 | `packages/shared/src/items.ts`、`packages/shared/test/` |
| 2.2 | 两条 SQL 常量（DELETE 当前稿引用 / `json_each` 版 INSERT） | `apps/worker/src/db/tables.ts` |
| 2.3 | **先实测 D1 是否启用 `json_each`**；不可用则改按 90 个分片 | 新增一条 worker 用例当探针 |
| 2.4 | `saveItemBody` 增加可选 `refs` 参数，接进现有 batch | `apps/worker/src/services/items.ts` |
| 2.5 | 路由读头并传参 | `apps/worker/src/routes/items.ts` |
| 2.6 | `POST /api/batch` 的 `save_body` op 加可选 `refs`（离线主路径，不能漏） | `apps/worker/src/services/batch.ts` |
| 2.7 | worker 用例：带 refs 保存后 `refs/:itemId` 返回新集合；**不带 refs 时引用集合原样不动**；不存在的 sha 跳过不报错；非 NULL `version_id` 的历史引用不被清；跨租户不写入 | `apps/worker/test/attachments.test.ts` |
| 2.8 | 客户端直存路径带上请求头 | `apps/web/src/data/api/endpoints.ts` |
| 2.9 | outbox `save_body` op 带 refs，**复用 `extractAttachmentRefs`（分享查看器已在用，不另写解析）** | `apps/web/src/data/sync/push.ts` |
| 2.10 | web 用例：正文删图后保存 → 请求带正确的 refs 头；无图正文 → 带空数组 | `apps/web/test/` |

### 批 2b · 删除附件引用入口

| 步 | 做什么 | 涉及文件 |
|---|---|---|
| 2.11 | **界面定稿**（新交互点，先稿后码）：更多菜单为主 + 选中后常驻小工具条为辅，**都不靠悬停**；语义提示写明「移除引用 ≠ 删除文件」 | 本文 + 《M6 第一批设计》§4.1 |
| 2.12 | 接线：删正文里的 `![名](/api/attachments/h/<sha>)`，把那条没人调用的 `removeAttachmentMeta` 接上 | `apps/web/src/app/workarea/`、`apps/web/src/data/db/attachments.ts` |
| 2.13 | 用例：两个入口都在；移除后正文里该行消失、其余不动 | `apps/web/test/` |

### 批 2c · 附件管理页

| 步 | 做什么 | 涉及文件 |
|---|---|---|
| 2.14 | **新屏界面定稿**（先稿后码）：概览三数、列表列、手动清理孤儿、三种空态 | 本文 + 《M6 第一批设计》§4.2 |
| 2.15 | 新增 `GET /api/attachments` 列表接口（M4 漏了这个接口），留 `limit`/`cursor` 位 | `apps/worker/src/routes/attachments.ts`、`services/attachments.ts` |
| 2.16 | 设置导航新增「**数据管理**」分类（当前 9 类里没有它） | `apps/web/src/router.ts`、`features/settings/ui/SettingsPanel.tsx` |
| 2.17 | 附件管理页组件（复用 `setrow` 行式布局与既有按钮层级，不新造组件） | `apps/web/src/features/attachments/ui/` |
| 2.18 | 用例：接口三态（空 / 有附件无孤儿 / 有孤儿）、清理有二次确认 | `apps/worker/test/attachments.test.ts`、`apps/web/test/` |

### 收尾

| 步 | 做什么 |
|---|---|
| 3.1 | `docs/todo/Menote-开发计划-v1.md` 的「M4 遗留」第 1/2 行标完成；「M6」段回填进度 |
| 3.2 | `wiki/components.md` 登记新组件（附件管理页、删除引用入口）；`wiki/Menote-项目架构-v1.md` §2.3.2 补 `GET /api/attachments` 落点与 `X-Menote-Refs` 头 |
| 3.3 | CHANGELOG 追加；版本号按 AGENTS.md「修复/小功能 +0.0.1」逐批升 |
| 3.4 | 全量验证：`pnpm lint` / `typecheck` / `test` / `check:size`，逐条对《M6 第一批设计》§六 验收点 |

## 验收点

见《M6 第一批设计》§六（八条）。执行时逐条勾，**没验证过的不写「完成」**。

**2026-10-03 第一批收口：八条全部达成**——自动化侧 worker 246 / web 1219 / shared 101 / mdcore 65、typecheck 4 包 0 error、lint 0 error；**线上点验（部署后用户确认）**：移除附件引用入口可用、引用移除后正确落到孤儿并能被清掉、附件管理页附件正常显示 / 可移除 / 孤儿判定正确 / 手动清理可用。唯一未做的是**批 2b 的辅助入口**（选中后常驻小工具条），已按设计稿 §4.1 记明未做与原因。

## 风险与回退

| 风险 | 应对 |
|---|---|
| D1 不支持 `json_each` | 步 2.3 先探针；退回按 90 个分片，代价是多几条语句 |
| 引用对齐漏了 batch 路径 | 步 2.6 独立成步、不并入 2.5——这是离线主路径，漏了等于没做 |
| 加了「数据管理」分类后设置页变长 | 该分类本就在功能拆解 M18-01 的 11 类定稿里，导航顺序按 §7.5 表 |
| 撤销分享影响了别的功能 | 步 1.3 用例钉住「撤销分享不碰附件/版本/条目」 |

# Menote 添加内容窗口 · 实施计划 v1（已执行·已归档）

| 项 | 内容 |
|---|---|
| 文档版本 | v1.1 |
| 文档状态 | **已执行 → 已归档**（2026-10-01 移入 `docs/archive/`）。实现、测试与定稿回写均已完成（应用版本 v0.5.26，2026-09-29）；**真机观感仍未验证**（本机无可用登录态，需用户点验） |
| 目的和适用范围 | 落地 `docs/modules/Menote-添加内容窗口-设计-v1.md`（已废弃）的实现步骤与验收 |
| 权威级别 | 历史参考。**后续改动走 `docs/todo/Menote-添加内容窗口-实施计划-v2.md`** |
| 最后更新日期 | 2026-10-01 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.5.26 | 2026-09-29 | 初稿 | mimo-v2.6-flash |
| v1.1 | v0.6.4 | 2026-10-01 | 标归档：后续改动转 v2 实施计划 | minimax-M3 |

## 目标

Memo / 待办视图的「添加」入口由「跳左侧录入框」改为「打开统一添加窗口」，字段与录入框对应档位一致，
发布后关窗 + toast + 条目即时出现。

## 涉及文件

- `apps/web/src/app/fnbar/Composer.tsx` — 导出 `ModeExtras`、`TASK_ITEM_PATTERN`（复用，不复制）
- `apps/web/src/app/fnbar/AddEntryDialog.tsx` — **新增**：通用窗口（kind = memo | task）
- `apps/web/src/app/App.tsx` — 新增窗口状态；Memo/待办 `onAdd` 改 `open(kind)`；装配窗口
- `apps/web/src/app/workarea/MemoView.tsx`、`TaskView.tsx` — `onAdd` 语义改为"打开窗口"（仅注释/文档）
- `apps/web/src/features/memos/ui/MemoTimeline.tsx`、`MemoFlow.tsx`、`features/tasks/ui/TaskListView.tsx` — 空状态出口
- `apps/web/src/app/theme/app.css` — `.addentry__input` / `.addentry__extras`
- 测试：新增 `apps/web/test/add-entry-dialog.test.tsx`；改 `memos-sidebar` / `tasks-panel` 空状态断言

## 步骤

1. `Composer.tsx`：`export function ModeExtras`（`noteTargetLabel` 变可选）、`export const TASK_ITEM_PATTERN`。
2. 新增 `AddEntryDialog.tsx`：Modal 壳 + 输入区 + `ModeExtras` + 取消/发布；打开时清空并聚焦输入区。
3. `App.tsx`：`const fnbarProps = fnbarWiring(...)` 提出成变量，窗口复用其 `onPublishMemo/onPublishTask`；
   Memo `onAdd={() => setAddEntry("memo")}`、待办 `onAdd={() => setAddEntry("task")}`。
4. 空状态：MemoTimeline →「添加 Memo」、TaskListView →「添加待办」、MemoFlow →「切回时间轴」（不再加文本 Memo）。
5. CSS + 用例。
6. 回写定稿（用户已授权）：`wiki/Menote-功能拆解-v2` M06-10 / M07-01 入口二、`wiki/components.md` §6.2、`DESIGN.md` §6.3。

## 验收点

见设计稿 §五；跑 `pnpm lint` / `pnpm typecheck` / `pnpm test`。

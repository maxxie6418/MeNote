# 设置页与头像状态圈实施计划

> **文档状态：已完成（已归档 2026-10-02）。** Task 1 / Task 2 已于 commit `7d51752` 落地（CHANGELOG v0.5.23 / v0.5.24 记头像状态圈）；其中设置导航的分组结构后经用户 2026-09-29 反馈在 v0.5.25 改回单层顺序排列（"不要做一级分类"），设置导航现状以 v0.5.25 为准。下方任务清单的勾选框未回填，以本行说明为准。

> **For agentic workers:** 按任务逐项执行；每项先写失败测试，再写最小实现。

**目标：** 将设置页改为单层主分类的分组卡片式导航，并把隐私锁状态合并到顶栏头像外圈。

**架构：** 设置页只调整导航展示结构，分组标题是非交互文本，主分类按钮继续由 `SETTINGS_PAGES` 驱动。头像状态圈由顶栏账户组件展示，状态数据从现有 `PrivacyLockState.runtime` 组装传入；不改隐私状态机、数据协议或账户菜单动作。

**技术栈：** React、TypeScript、CSS 令牌、Vitest、React Testing Library。

---

## 文件结构

- 修改 `apps/web/src/features/settings/ui/SettingsPanel.tsx`：将单层主分类按固定分组渲染。
- 修改 `apps/web/src/app/topbar/Topbar.tsx`：接收头像状态圈数据并传入账户菜单。
- 修改 `apps/web/src/app/topbar/AccountQuickMenu.tsx`：在头像触发器外渲染状态圈，倒计时按 ticker 更新。
- 修改 `apps/web/src/app/topbar/wiring.ts`、`apps/web/src/app/App.tsx`：把隐私运行时状态接到顶栏。
- 修改 `apps/web/src/app/theme/app.css`：设置导航分组与头像状态圈样式。
- 修改 `apps/web/test/ui.test.tsx`、新增或修改设置 / 顶栏测试：锁定已确认行为。
- 修改 `apps/web/test/css-cascade.test.ts`：锁定关键 CSS 取值。
- 修改 `CHANGELOG.md`：记录版本优化。

## Task 1：设置页分组导航

- [ ] 为 `SettingsPanel` 增加分组数据结构：常用（general/editor/privacy）、数据（versions）、账户（account）、管理（instance）、关于（about）；owner 过滤继续在渲染前执行。
- [ ] 先补测试：断言组标题为非按钮、主分类按钮仍为单层、member 不出现实例管理、当前页 aria-current 保持。
- [ ] 运行 `pnpm --filter @menote/web test --run test/ui.test.tsx`，确认新增断言在旧结构下失败。
- [ ] 修改 JSX：`nav.settings__nav` 内按分组渲染标题和按钮，不引入子菜单或新路由。
- [ ] 增加 CSS：组间距、弱化组标题、分组边界 / 背景、主分类行高度与 selected 状态全部使用既有令牌。
- [ ] 运行设置相关测试与 `css-cascade.test.ts`，确认通过。

## Task 2：头像状态圈

- [ ] 先补状态映射测试：未启用无圈；锁定绿色实线；minutes 橙色动态环且 `strokeDashoffset` 随剩余时间变化；session 橙色虚线；device 橙色实线。
- [ ] 运行对应测试确认失败。
- [ ] 在 `AccountQuickMenu` 增加 `privacyStatus` props：`lockState`、`tier`、`expiresAt`、可选 `durationMs`；用现有 `useTicker` 让 minutes 每秒刷新。
- [ ] 新增头像触发器包装结构与状态类 / `svg circle`，不改变菜单内容和点击行为；无有效倒计时时退化为橙色实线。
- [ ] 在 `Topbar` 与 `wiring` 中传递数据，在 `App` 组装 `privacy.runtime` 和倒计时总时长（由现有设置分钟数计算）。
- [ ] 删除顶栏独立隐私胶囊的渲染槽位，但保留 `PrivacySlot` 的解锁弹窗与其它调用兼容；不改隐私状态机。
- [ ] 增加 CSS 状态圈线型、颜色和尺寸，使用 `--green` / `--amber` / `--primary` 令牌。
- [ ] 运行顶栏、隐私锁、设置和 CSS 测试，确认通过。

## Task 3：集成验证与交付

- [ ] 运行 `pnpm --filter @menote/web typecheck`。
- [ ] 运行 `pnpm lint`，记录与本次无关的既有 warning。
- [ ] 运行 `pnpm test --run`，记录全部 workspace 结果。
- [ ] 更新 `CHANGELOG.md`，注明设置页分组导航和头像状态圈。
- [ ] 复查变更范围，确认未修改数据库、API、同步和隐私状态机。

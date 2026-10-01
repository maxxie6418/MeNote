# Menote 添加内容窗口 v2 · 实施计划

| 项 | 内容 |
|---|---|
| 文档版本 | v1 |
| 文档状态 | 待执行 |
| 目的和适用范围 | 落地 `docs/modules/Menote-添加内容窗口-设计-v2.md` 的实现步骤与验收 |
| 权威级别 | 临时规则（做完整份移入 `docs/archive/`） |
| 最后更新日期 | 2026-10-01 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.6.4 | 2026-10-01 | 初稿：按设计 v2 的六条决策拆步 | minimax-M3 |

---

## 一、目标（一句话）

Memo / 待办**页头右上角「添加」**弹出的窗口：放宽到 520px、字段行改成三行属性区、
新增记录日期与标签点选、清单 Memo 补上截止与优先级、字段组件由 `ModeExtras` 收为 `AddEntryFields`。
**功能栏快速录入框（`Composer`）一个字不动。**

## 二、硬边界（做之前再看一眼）

- ❌ 不改 `Composer` 的行为与尺寸。它 2026-10-01 刚被压回两行（95px），
  `layout-invariants` 与 `fnbar` 的断言**必须仍全绿**——那是回归网。
- ❌ 不改 `DESIGN.md` / `wiki/`。回写单列在步骤 9，**需用户明确同意后另起一轮**。
- ❌ 不扩协议。`ItemWriteMeta` 已有 `tags` / `memo_at` / `task_due` / `task_priority`，本轮全够用。
- ❌ 不碰 `pinned` / `starred` / `enc_self` / `in_enc_space` / `folder_id` / `task_status`。

## 三、涉及文件

| 文件 | 动作 | 备注 |
|---|---|---|
| `apps/web/src/app/fnbar/AddEntryFields.tsx` | **新增** | 取代 `ModeExtras`：三行属性区，只服务本窗口 |
| `apps/web/src/app/fnbar/AddEntryDialog.tsx` | 改 | 状态扩（`memoDate` / `tags`）、`onPublishMemo` 形状放宽、渲染 `AddEntryFields`、文案与文档注释指向 v2 |
| `apps/web/src/app/fnbar/Composer.tsx` | 改 | 删掉 `ModeExtras` 与只为它存在的注释；**保留** `TASK_ITEM_PATTERN` / `ATTRIBUTE_FOCUS_SELECTOR` 导出 |
| `apps/web/src/features/memos/useMemoWrite.ts` | 改 | `publishMemo` options 收 `memoAt`；`memo_at` 由写死 `now` 改为按入参 |
| `apps/web/src/features/memos/model.ts` | 改 | 新增「日期键 + 时分秒 → 时间戳（按设置时区）」纯函数 |
| `apps/web/src/app/NavPanels.tsx` | 改 | `onPublishMemo` 透传 `memoAt` / `tags`；`onPublishTask` 不动 |
| `apps/web/src/app/theme/app.css` | 改 | `.addentry__extras` → 属性区三行 + 标签菜单 + 日期 chip；`.addentry` 宽 520px |
| `apps/web/test/add-entry-dialog.test.tsx` | 改 | 13 条按新结构重写 + 新增 |
| `apps/web/test/memos-model.test.ts` | 改 | 新增时区换算函数单测 |
| `apps/web/test/memos-timeline.test.tsx` | 不动 | 空状态出口不变，仅回归 |
| `apps/web/test/fnbar.test.tsx`、`layout-invariants.test.ts` | **不动** | 回归网，见第二步边界 |

新增依赖：**无**。不引 UI 库、不引时区库（沿用 `Intl.DateTimeFormat`，与 `memos/model.ts` 现有做法一致）。

## 四、步骤

按顺序做，每步结束可独立验证。**1–4 是一批，5–7 是一批，8 收口。**

### 步骤 1 · 时区换算（纯函数，最先做、最易测）

`features/memos/model.ts` 新增 `dayStartInZone(dayKey: string, timeZone?: string): number`：
给定 `YYYY-MM-DD` 与时区，返回该日 00:00 的毫秒时间戳；再由它派生
`resolveMemoAt(dayKey: string | null, now: number, timeZone: string): number`——
`dayKey` 为空返回 `now`（**默认 = 今天 = 现状行为**），否则取该日 00:00 加上 `now` 在该时区的**时分秒**。

配套 `memos-model.test.ts`：跨月、跨年、闰日 2-29、跨时区（UTC / Asia-Shanghai / America/New_York）、
`dayKey = null` 原样返回 `now`、往返一致性（`dayKeyInZone(resolveMemoAt(k)) === k`）。

**验收**：该批单测绿；`dayKeyInZone` 既有断言不受影响。

### 步骤 2 · 写入路径接受 `memoAt` 与合并后的 `tags`

`useMemoWrite.ts`：

- `publishMemo` options 由 `{ asTask?, due?, priority? }` 扩到 `{ asTask?, due?, priority?, memoAt?, extraTags? }`。
- `memo_at: options?.memoAt ?? now`——**不传就是现在的 `now`，老调用方行为不变**。
- 标签：`const tags = Array.from(new Set([...deriveTags(text), ...(options?.extraTags ?? [])]))`。
  派生在前、点选在后，顺序稳定（便于快照比对）。

`NavPanels.tsx` 的 `onPublishMemo` 同步透传两个新参数；`onPublishTask` **不动**
（待办不做记录日期、不做标签入口以外的额外标签——两档共用同一入口，但只有 Memo 档传 `memoAt`）。

**验收**：`memos-timeline` / `fnbar` / 既有 `publishMemo` 相关用例全绿（证明老路径没变）。

### 步骤 3 · 字段组件 `AddEntryFields`

新建 `apps/web/src/app/fnbar/AddEntryFields.tsx`，从 `AddEntryDialog` 移出去，负责三行渲染：

```
行 1「这条是什么」：日期 chip · 清单 chip          （仅 kind=memo）
行 2「什么时候」  ：截止 date · 优先级 seg        （kind=task 常驻；memo 确认为清单后）
行 3「归到哪」    ：+ 标签 chip · 标签 chips · 行尾(计数 + ⓘ)
```

要点：

- **空组不渲染**（返回 `null`，不返回空壳容器）。
- 清单 chip 三态由 `asTask` / `hasTaskItem` 驱动：占位「清单」不可点 → 「设为清单？」（amber，可点）
  → 「✓ 已设为清单」（primary，再点取消）。**不自动勾**。
- 日期 chip：`<label class="chip chip--sw chip--date">` 内套**铺满但透明**的原生 `<input type="date">`。
  不用 `display:none`（不可聚焦），不用 `showPicker()`（兼容与键盘可达性都更差）。
- 标签短菜单：锚在标签行，**向上展开**（字段区紧贴弹窗底部，下方没空间，按 `DESIGN.md` §6.4-1）。
  行不再有 `overflow`，浮层挂在行内不会被裁。

**验收**：组件单测（可先按纯渲染断言，落进步骤 7 的用例文件）。

### 步骤 4 · 窗口改造

`AddEntryDialog.tsx`：

- 状态增 `memoDate: string`（空 = 今天）、`tags: string[]`、`tagMenuOpen: boolean`。
- `onPublishMemo` 形状放宽为 `(text, options: { asTask: boolean; due?: string | null; priority?: TaskPriority; memoAt?: number; tags?: string[] })`。
- `publish()` 里：`kind === "memo"` 时算出 `memoAt = resolveMemoAt(memoDate, Date.now(), timeZone)`，
  `asTask` 为真时一并带上 `due` / `priority`——**这是本轮修掉的真漏洞**。
- `<AddEntryFields>` 替换 `<ModeExtras>`；`.addentry__extras` 容器换成属性区容器。
- 顶部文档注释指向 `docs/modules/Menote-添加内容窗口-设计-v2.md`。
- 空内容时「发布」禁用的**原因**从 `title` 挪到输入区下方一行可见 micro 提示
  （`DESIGN.md` §6.1「禁用必须说明为何禁用」，属 §5.4-2 允许可见的校验提示）。

`AddEntrySlot.tsx`：仅改文档注释指向 v2。**装配逻辑一行不动**（两个入口已共用，见设计稿 §二）。

`Composer.tsx`：删掉 `ModeExtras` 组件本体与相关导出/注释；`TASK_ITEM_PATTERN`、
`ATTRIBUTE_FOCUS_SELECTOR` 留在原处（窗口继续 import）。**不动** `QuickComposer` 的调用与 `.composer__modes`。

**验收**：`add-entry-dialog` 用例（步骤 7 写完前先跑现有 13 条看炸了几条，炸的记录下来作对照）。

### 步骤 5 · CSS

`app.css`：

- 新增 `--addentry-w: 520px`（具名结构尺寸，写在 `:root`），`.addentry { width: min(var(--addentry-w), 100%) }`。
- `.addentry__input` 的 `min-height` 96 → **112px**。
- `.addentry__extras` → `.addentry__fields`：`flex column` + `gap: var(--sp-1)`；
  `.addentry__fieldrow { min-height: 26px; flex-wrap: wrap; position: relative }`。
  **删掉** `overflow-x: auto` / `nowrap` / 固定 `height: 26px`（那三条是被推翻的约束）。
- 新增 `.addentry__tagmenu`（240px、向上、`--shadow-2`）、`.addentry__datedate input`（铺满 + `opacity: 0`）。
- 顶部注释（`app.css:252`）里「`.addentry__extras`，保留同族的 26px / `nowrap`」那句**要改**——它描述的是已废约束。

**验收**：`layout-invariants.test.ts` 若有针对 `.addentry__*` 的断言，一并更新；
`fnbar.test.ts` **必须仍全绿**。

### 步骤 6 · 动效

浮层出现 160–200ms（`DESIGN.md` §6.8），`prefers-reduced-motion` 下停住。
**这一项原型里没验证过**（评审环境 CSS 动画不推进，浮层会卡在首帧变半透明，原型为此去掉了入场动画），
所以要**在真机上单独看一眼**，别默认它对。

### 步骤 7 · 用例

`apps/web/test/add-entry-dialog.test.tsx` 按新结构重写，并补这些**当前没有**的：

| # | 断言 |
|---|---|
| 1 | Memo 页打开 → `kind=memo`；待办页打开 → `kind=task`；**窗口内没有类型切换控件** |
| 2 | 宽度 520px（结构断言走 CSS 类，不写死像素字面量以外的东西） |
| 3 | Memo 档未写 `- [ ]`：清单 chip 存在但**不可点** |
| 4 | 写出 `- [ ]`：出现「设为清单？」；**未点之前**发布 → `asTask=false` |
| 5 | 点一下 → 「已设为清单」，**截止与优先级控件出现** |
| 6 | 确认为清单后发布 → 回调收到 `asTask=true` **且** `due` / `priority` 透传（**本轮修的漏洞，必须钉住**） |
| 7 | 记录日期留空 → 回调的 `memoAt` 等于「今天的时分秒」，非 00:00 |
| 8 | 记录日期选昨天 → `memoAt` 落在**昨天**（用 `dayKeyInZone` 断言，别写死时间戳） |
| 9 | 标签：点选已有 + 输入新建 + 正文 `#` 三者合并去重后回传 |
| 10 | 发布后正文里**不出现**标签文本（标签只进 `tags`） |
| 11 | 空内容：发布禁用 + **原因在可见文本里**（不在 `title` 里） |
| 12 | 空组不占位：待办档**不出现**「这条是什么」行；Memo 未确认清单时**不出现**「什么时候」行 |
| 13 | `Ctrl+Enter` 发布 / `Esc` 关闭 / 点遮罩关闭 / 关窗清空全部字段（含 `memoDate` 与 `tags`） |
| 14 | 区域单一主操作（只有「发布」是实心主色） |

`memos-model.test.ts` 补步骤 1 的时区用例。

**回归必跑且必须仍绿**：`fnbar.test.tsx`、`layout-invariants.test.ts`、`composer-quick-input.test.tsx`、
`memos-timeline.test.tsx`、`memos-panel.test.tsx`、`memos-sidebar.test.tsx`、`tasks-panel.test.tsx`。

### 步骤 8 · 验证与提交

```
pnpm lint && pnpm typecheck && pnpm test
```

- 代码与文档**分开提交**（`AGENTS.md`「Git」）。
- 提交信息先写进 `.git/COMMIT_MSG.txt` 再 `git commit -F`，**不把信息塞进命令行**。
- 提交后 `git log -1 --format="%s"` **核对首行**与预期一致，不一致且未推送就 `--amend`。
- 分支：**直接在 `main`**（用户 2026-10-01 明确要求，不另开临时分支）。
- `CHANGELOG.md` 在**最上方**当日小标题下追加一条，带 commit hash。

### 步骤 9 · 定稿回写（**需用户明确同意后另起一轮**）

本轮**不碰** `DESIGN.md` / `wiki/`。清单见设计稿 §六，共 6 条：

1. `DESIGN.md` §2.2 — 字段行 26px 不换行 → 属性区三行；新增「添加内容窗口宽 520px」
2. `DESIGN.md` §5.3 — 「窗口字段行」那一行改写为「属性区」，补日期 chip 与标签短菜单的选型
3. `DESIGN.md` §6.3 — 复核结论：**无需改**（已定口径本就覆盖本窗口）
4. `wiki/components.md` §6.8 — `AddEntryDialog` 形态与 props；`ModeExtras` → `AddEntryFields`
5. `wiki/components.md` 另两处 — 现指向已归档的 v1 路径，**当前是断链**，须改指 v2
6. `wiki/Menote-功能拆解-v2.md` — M06-10 / M07-01 入口二补记录日期与标签两条

## 五、验收点

见设计稿 §九（11 条）。另加三条本计划特有的：

- **功能栏录入框零变化**——`fnbar` + `layout-invariants` + `composer-quick-input` 三套用例全绿。
- **老调用方零变化**——不传 `memoAt` / `tags` 时 `publishMemo` 的行为与本轮之前逐字段一致。
- **发布不跳高**——属性区高度在发布前后不变；唯一的高度变化来自主动点「设为清单？」。

## 六、未验证项（做完要在交付说明里如实写）

- 520px 下的真实观感与三行呼吸感
- 标签选到 6~7 个时行内换行的效果
- 记录日期的系统日期选择器在浅 / 深两主题下的观感
- 浮层入场动效（`prefers-reduced-motion` 下的表现一并看）
- **线上观感**：本机没有可用登录态，`wrangler` 未登录，**需用户点验**

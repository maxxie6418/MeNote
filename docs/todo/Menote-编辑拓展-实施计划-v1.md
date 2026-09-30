# Menote 编辑拓展实施计划 v1（文档版本 v2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

| 项 | 内容 |
|---|---|
| 文档版本 | v2 |
| 文档状态 | 生效（用户 2026-09-29 确认按本计划执行） |
| 目的和适用范围 | 将《Menote 编辑拓展设计 v3》拆成可单独验收、可逐步上线的实现计划：先收敛正文模式，再在隔离试验页验证快捷输入即时渲染与命令，最后验证并替换正文即时渲染；表格暂不纳入。 |
| 权威级别 | 临时规则。产品边界以 `docs/modules/Menote-编辑拓展-设计-v3.md` 为准；与 `wiki/` 冲突时以 `wiki/` 为准。 |
| 最后更新日期 | 2026-09-29 |

## 修改记录

| 文档版本 | 应用版本 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.5.30 | 2026-09-29 | 按编辑拓展设计 v3 拆分阶段、文件落点、测试、验收线与提交边界。 | gpt-5.6-terra |
| v2 | v0.6.0 | 2026-09-29 | 按评审清单 1–19（19 条）与用户 2026-09-29 决定修订：文档状态改「生效」、版本策略自 v0.6.0 起、确认「失焦才渲染」口径；登记 wiki 冲突期与回写授权门槛；修 `check:size` 与局部测试的构建前置；两个归一化函数合并为一个 `normalizeEditorModes`；点名会改红的既有用例与类型边界落点；补 B1/B2/B4/B5 示例、C2 可判定红绿、全局守卫与图标口径；重排阶段编号并合并重复的正文即时渲染替换描述；`/图片`、`@tags`、`@target-folder` 记为不做 / 遗留。 | deepseek-v4.1-flash |

**Goal:** 在不损害现有 Markdown 保存与同步可靠性的前提下，先交付“正文 Markdown 编辑 + 预览”的可用基线；再让快捷输入具备轻量即时渲染、基础 `/` 和仅限快捷输入的 `@`；最后验证并谨慎启用正文即时渲染。表格编辑 / 锁定暂不纳入本计划。

**Architecture:** 内容始终保存为 Markdown，快捷输入和正文共享格式语义、命令名称与阅读主题，但允许采用不同编辑器实现。试验页只写 `menote:editor-lab:v1`，先验证再逐个替换生产入口；正文始终保留 Markdown 编辑作为可靠回退，预览/锁定尽量复用阅读呈现。

**Tech Stack:** React 19、TypeScript、CodeMirror 6、markdown-it + DOMPurify、Vitest + Testing Library、现有 Dexie 本地优先保存与同步机制。

---

## 0. 范围、前置确认与交付顺序

### 已确认范围

- 正文最终保留：**Markdown 编辑、即时渲染编辑、预览 / 阅读**；移除双栏。
- 阶段 A **已获用户确认**（用户 2026-09-29「以此执行计划」），可以正式实施；生产先收敛为：**Markdown 编辑 + 预览 / 阅读**。
- **「失焦才渲染」口径已确认**（对应设计 v3 第 51 行）：快捷输入即时渲染 = **聚焦时可靠 textarea、失焦 / 完成当前块后按 Markdown 呈现、点击可继续编辑**。这是产品口径，不留到验收阶段再讨论；任何实现只要破坏「聚焦时能可靠输入（中文输入法、连续列表、撤销与焦点）」或「呈现态可点击回到编辑」，即判不通过。
- 快捷输入默认目标是**轻量即时渲染**，不另设预览页面。
- `/` 两类宿主均可用，但快捷输入只支持基础集合；`@` 第一阶段只用于快捷输入与添加内容窗口。
- 下划线、任意 CSS、任意颜色值、私有第二文档格式均不做。
- **表格编辑 / 锁定暂不纳入本计划**；本计划不修改表格代码、接口、schema 或验收。

### 需要单独确认的高影响点

下列改动会改变已上线行为、用户设置或定稿文档，因此在实施到对应任务前必须单独说明影响并取得确认：

1. **（已确认 2026-09-29，阶段 A）** 将现有正文四档设置收敛为“Markdown 编辑 / 预览”，并移除双栏和即时渲染入口。用户已确认按本计划执行，本条留作影响面记录：它会修改用户可见设置及现有 `editor_modes` 的兼容策略（兼容口径与改法见 A1 Step 4、A2 Step 3）。
2. 快捷输入与添加内容窗口从 `<textarea>` 改为轻量即时渲染宿主（阶段 B）。这会改变输入手感、光标与发布前显示。
3. 正文即时渲染进入生产并成为默认（阶段 C）。这会改变笔记打开时的默认输入形态。
4. 表格编辑 / 锁定暂不纳入本计划；未来若启动，必须另立专项设计并先确认锁定来源，不能在本计划中擅自新增数据库字段。

### 已知冲突：代码与定稿的冲突期（登记在案）

阶段 A 把生产可见模式从四档收敛成两档，**与 `wiki/` 现行定稿冲突**，本计划不假装它不存在：

- `wiki/Menote-设计文档-v7.4.md`（内部版本 v7.5.2 / v7.5.4）§7.1、§13、§17：仍写「双栏 / 仅编辑 / 仅预览 / 即时渲染」四档与「双栏实时预览（默认）」。
- `wiki/Menote-功能拆解-v2.md`：M04-03 与设置分类表仍按四档写。
- `wiki/components.md`：`Editor` 契约仍写「三 / 四种模式：双栏实时预览（默认）、仅编辑、仅预览、即时渲染」。

处理口径：

1. **冲突期是已知状态，不是遗漏**。阶段 A 实施后到定稿回写前，代码与 `wiki/` 不一致是预期状态。执行者在 `docs/todo/Menote-开发计划-v1.md` 的「M4 遗留 → 后续」表后**追加一行登记**（只登记归属与状态，不在该文件补做任何实现），写清：四档 → 两档的生产收敛与 `wiki/` 定稿冲突、回写须单独授权、归属本专项。该文件不在本计划的改动范围内，本计划只描述这个动作。
2. **回写 `wiki/` / `DESIGN.md` 必须单独取得授权**：Task D2 Step 3 的授权门槛不变（见 §6）。没有明确授权就**只改代码与 `docs/`**，不改 `wiki/`、不改 `DESIGN.md`。`docs/` 与 `wiki/` 冲突时以 `wiki/` 为准这条规则继续有效，所以本计划在授权前只声称「按用户 2026-09-29 的决定先执行」，**不声称产品口径已定稿**。
3. 回写时的最低范围：上列三处文件的四档表述改成两档（阶段 A 后）或三档（阶段 C 后），各自更新文档版本、日期、修改记录；同时把上面第 1 条登记的遗留行状态改为「已回写」。

### 每阶段完成定义

- 每个阶段先在试验页或局部入口通过用例与人工操作，再替换生产入口。
- 每一个可验证阶段独立提交并推送；代码与文档分开提交。
- 每次提交前运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`；提交后核对 commit message，再推送。
- 阶段完成后更新本计划状态、`CHANGELOG.md`，并在用户授权时回写 `wiki/` / `DESIGN.md`。

**版本策略（用户 2026-09-29 决定，本次专项从 v0.6.0 起）**

- 根 `package.json` 的 `version` 是**唯一来源**（AGENTS.md「版本号规范」与「版本号只有一处来源」）；前端不复制版本号，由构建期注入 `__APP_VERSION__`。
- 本次专项**从 v0.6.0 开始**；每个可交付阶段的修改 **+0.0.1**，并在 `CHANGELOG.md` 的**同日条目**里带上该版本号（当天的小标题已存在就写在同一个小标题下，不重复写日期）。
- `apps/web/test/version-consistency.test.ts` 会双向校验：CHANGELOG **最新日期小节**里必须有当前 `package.json` 版本号的条目，且条目版本**不得超过**当前版本。所以「改了 `version` 没补 CHANGELOG」和「CHANGELOG 写了下一次要发的版本」都会让它红——两者在同一次提交里一起改。
- 纯文档改动（例如本计划自身的修订）沿用当前版本号，不升位。

**与里程碑的关系（用户 2026-09-29 决定）**

- 本专项**先做**，「下一步 M5（分享 / 导出 / 备份）」**顺延**。M5 的启动不以本专项全部收口为前提，但阶段 A 的代码与文档提交要先落地，避免两摊改动在 `editor_modes`、设置面板与版本号上互相踩。
- 执行者在 `docs/todo/Menote-开发计划-v1.md` 的「M4 遗留 → 后续」表后**追加一行登记**本专项的位置与 M5 顺延（与「已知冲突」那行同一处，可并在一条里）。该文件不在本计划的改动范围内，本计划只描述这个动作。

**局部测试的前置构建（每次局部测试都要）**

`@menote/shared` 与 `@menote/mdcore` 的 `exports` 指向 `packages/*/dist`（`dist/` 在 `.gitignore` 里），干净克隆上直接跑 `pnpm --filter @menote/web test` 会**解析失败**（`Cannot find package '@menote/shared'` 一类）。因此**本文所有 `pnpm --filter @menote/web test …` 都读作**：

```text
pnpm --filter @menote/shared build && pnpm --filter @menote/mdcore build && pnpm --filter @menote/web test -- <文件…>
```

首次开跑前先做一次这两个构建即可；`packages/*` 源码变了要重跑。`packages/shared` 自己的测试（`pnpm --filter @menote/shared test`）从源码跑，不需要这一步。本文写在 ```text 代码块里的局部测试命令都已把这两个构建显式列在首行；单条内联的 `运行：pnpm --filter @menote/web test -- …` 都按上式展开。

## 1. 文件结构与职责

| 文件 | 动作 | 职责 |
|---|---|---|
| `apps/web/src/app/editor/format-commands.ts` | 新建 | Markdown 格式命令的唯一纯函数入口；把选择区 / 当前行转换为标准 Markdown，不触碰 React、CodeMirror 或业务属性。 |
| `apps/web/src/app/editor/format-commands.test.ts` | 新建 | `/` 基础与正文扩展命令的纯函数测试。 |
| `apps/web/src/app/editor/CommandMenu.tsx` | 新建 | 通用 `/` 菜单呈现与键盘选择；不直接持有文本或属性。 |
| `apps/web/src/app/editor/command-menu.test.tsx` | 新建 | 菜单过滤、选择、Esc、组合输入时不打开的 UI 用例。 |
| `apps/web/src/app/editor/Editor.tsx` | 修改 | 保持正文 CodeMirror 生命周期；接收 `/` 命令及即时渲染所需的最小扩展，不负责业务属性。 |
| `apps/web/src/app/editor/live-preview.ts` | 修改 | 只承担正文即时渲染装饰；补稳定性和只读复用验证，不接 `@`。 |
| `apps/web/src/app/editor/MarkdownPreview.tsx` | 修改（如确有必要） | 阅读 / 预览的唯一 Markdown 呈现入口，保持 markdown-it + DOMPurify 安全边界；快捷输入只能经 `React.lazy` + `Suspense` 按需加载它，禁止静态导入到功能栏首屏。 |
| `apps/web/src/app/fnbar/QuickComposer.tsx` | 新建 | 快捷输入的轻量即时渲染宿主；接收文本、模式、属性上下文和发布回调，不访问 Dexie / API。 |
| `apps/web/src/app/fnbar/quick-attributes.ts` | 新建 | 快捷输入 `@` 属性菜单的类型、可用项与宿主回调契约；不把属性序列化进正文。 |
| `apps/web/src/app/fnbar/Composer.tsx` | 修改 | 保留三行功能栏骨架、模式与发布编排；改为使用 `QuickComposer`，不再自行承载文本输入细节。 |
| `apps/web/src/app/fnbar/AddEntryDialog.tsx` | 修改 | 复用 `QuickComposer`，让 Memo / 待办添加窗口与功能栏拥有相同基础格式能力。 |
| `apps/web/src/features/editor-lab/store.ts` | 修改 | 扩展仅属于 `menote:editor-lab:v1` 的试验内容、主题和命令状态；不访问正式数据。 |
| `apps/web/src/features/editor-lab/ui/EditorLabPage.tsx` | 修改 | 验证快捷即时渲染、`@` / `/`、正文两档与候选即时渲染；真实记录实例生命周期，不把试验结果写入生产。 |
| `packages/shared/src/settings.ts` | 修改 | 读兼容照旧（`EditorModeSchema` / `EDITOR_MODES` 保留四值），新增 `PRODUCT_EDITOR_MODES`，让 `DEFAULT_EDITOR_MODES` 指向它，并把 `normalizeEditorModes()` 的语义收成「用户开着 ∩ 生产允许」。 |
| `packages/shared/test/settings.test.ts` | 修改 | 钉住归一化新语义、默认值＝生产允许集、旧四档读兼容；撤掉「默认全开四档」的旧断言。 |
| `apps/web/src/features/notes/editor-mode.ts` | 修改 | 收敛并兼容正文允许模式；坏值或旧 `split` 回退至允许列表的第一档；`writeLastEditorMode()` 参数收窄为 `ProductEditorMode`。 |
| `apps/web/src/features/notes/ui/NoteWorkspace.tsx` | 修改 | 渲染前统一调 `normalizeEditorModes()`（第 165 行）；只渲染产品允许的正文状态，最后一阶段再接候选即时渲染与默认策略。 |
| `apps/web/test/editor-lab-page.test.tsx`、`editor-lab-perf.test.ts` | 修改 | 覆盖隔离、命令、即时渲染试验、实例与监听计数。 |
| `apps/web/test/quick-composer.test.tsx` | 新建 | 快捷输入即时渲染、命令、输入法、发布与多实例用例。 |
| `apps/web/test/quick-attributes.test.ts` | 新建 | `@` 属性命令的宿主过滤用例（`task → due / priority`；`memo` / `note` 为空）。 |
| `apps/web/test/editor-readonly.test.tsx` | 新建 | 即时渲染 + `readOnly` 的可写性判定用例（C2 的唯一判定门）。 |
| `apps/web/test/editor-mode.test.ts` | 修改 | 覆盖阶段 A 的模式迁移和坏值回退。 |
| `apps/web/test/note-workspace-modes.test.tsx` | 新建 | 覆盖正文仅编辑/预览基线、候选即时渲染、锁定阅读与回退。 |
| `docs/modules/Menote-编辑拓展-设计-v3.md` | 修改（仅用户确认产品事实后） | 记录已验证的产品结论，不写入未经验证的引擎结论。 |
| `DESIGN.md`、`wiki/Menote-设计文档-v7.4.md`、`wiki/Menote-功能拆解-v2.md`、`wiki/components.md` | 修改（仅明确授权后） | 将生产模式、设置、组件契约和验收口径回写为定稿。 |
| `CHANGELOG.md` | 修改 | 每个实际交付阶段记录同日条目。 |

## 2. 阶段 A：正文基础基线——Markdown 编辑与预览

### Task A1：冻结并测试正文模式收敛规则

> **执行记录（2026-09-29，已完成，提交 `2a6b85c`）**：Step 1–9 全部落地，与本计划一致。
> 落点：`packages/shared/src/settings.ts`（`PRODUCT_EDITOR_MODES` / `ProductEditorMode` /
> `isProductEditorMode` / `DEFAULT_EDITOR_MODES` 指向产品集 / `normalizeEditorModes` 收紧为
> 「用户开着 ∩ 生产允许，空兜产品全集」；`DEFAULT_USER_SETTINGS.editor_mode` 由 `split` 改 `edit`）、
> `packages/shared/test/settings.test.ts`、`apps/web/src/features/notes/editor-mode.ts`
> （`writeLastEditorMode(mode: ProductEditorMode)`；`readLastEditorMode()` 仍认四值）、
> `apps/web/src/features/notes/ui/NoteWorkspace.tsx`、`apps/web/test/editor-mode.test.ts`、
> `apps/web/test/note-workspace.test.tsx`、新建 `apps/web/test/note-workspace-modes.test.tsx`。
> 偏差两处：①版本动作按用户「版本号从 0.6.0 开始」的口径**一次升到 v0.6.0**（未按每 Step +0.0.1）；
> ②顺带修了 `EditorLabPage.tsx` 的 `event.isComposing` 类型错误（`@types/react` 的合成事件类型没有它，
> 改用 `event.nativeEvent.isComposing`）——它一直让 `pnpm typecheck` 变红，属既有缺陷。
> 实测：`pnpm lint` 0 error、`pnpm typecheck` 0 error、全量 1304 条通过（shared 71 / mdcore 65 / web 958 / worker 210）。

**Files:**
- Modify: `packages/shared/src/settings.ts`
- Modify: `packages/shared/test/settings.test.ts`
- Modify: `apps/web/src/features/notes/editor-mode.ts`
- Modify: `apps/web/test/editor-mode.test.ts`
- Modify: `apps/web/src/features/notes/ui/NoteWorkspace.tsx`
- Modify: `apps/web/test/note-workspace.test.tsx`
- Create: `apps/web/test/note-workspace-modes.test.tsx`

**阶段 A 会改红的既有用例（点名，不许直接删）**

- `apps/web/test/note-workspace.test.tsx` 第 82–112 行「切到仅预览再切回分屏，编辑器拿到的是最新内容而不是打开时的快照」：阶段 A 不再有「分屏」按钮（第 108 行的 `getByRole(… "分屏")` 必然失败），**这条必然红**。它守的是**丢数据回归**——切模式会让编辑器重新挂载，重挂载必须用实时文本 `previewSource` 而不是打开时的 `initialBody`（原因见 `NoteWorkspace.tsx` 第 463–467 行注释，M1-11 QA 实测过「用快照初始化 → 用户再敲一个字就把旧内容写进草稿」）。改法：把「分屏」换成「仅编辑」，**保留同一语义**——切到「仅预览」再切回「仅编辑」，断言 `data-initial` 是「改过的内容」。删掉这条等于把丢数据回归一起丢掉。
- `apps/web/test/editor-mode.test.ts` 第 25–26 行 `writeLastEditorMode("live")` / `expect(readLastEditorMode()).toBe("live")`：`writeLastEditorMode()` 的参数收窄为 `ProductEditorMode` 后**类型报错**。改成 `writeLastEditorMode("preview")` + `expect(readLastEditorMode()).toBe("preview")`；另加一条**读兼容**用例：直接 `localStorage.setItem(LAST_EDITOR_MODE_KEY, "live")`（或 `"split"`）后 `readLastEditorMode()` 仍认得——`readLastEditorMode` 的 `KNOWN_MODES` 不跟着收窄。
- 同文件第 38 / 44 行的四值 `available` 数组**不用改**：入参仍是 `EditorMode[]`（见下面的类型边界）。

**类型边界落点（本阶段只归一化，不换类型）**

入参继续保持 `EditorMode[]`（四值，最稳），**只在渲染前归一化**——`NoteWorkspace` 第 165 行那一处。受影响的调用链与夹具：

| 位置 | 现状 | 本阶段动作 |
|---|---|---|
| `apps/web/src/app/App.tsx` 第 614 行 | `editorModes={userSettings.settings.editor_modes}`（`EditorMode[]`） | 不动 |
| `apps/web/src/app/NotesSlot.tsx` 第 23 行 | `editorModes: EditorMode[]` | 不动 |
| `apps/web/src/app/workarea/NotesPane.tsx` 第 34 行、第 285 行 | `editorModes: EditorMode[]` → `availableModes={editorModes}` | 不动 |
| `apps/web/test/notes-open-feedback.test.tsx` 第 84 行 | 夹具 `editorModes={["split","edit","preview","live"]}` | 不动（正好验证四值输入被归一化成两档） |
| `apps/web/test/vault-tree.test.tsx` 第 60 行 | 同上 | 不动 |
| `apps/web/src/features/notes/ui/NoteWorkspace.tsx` 第 44 行 | `export type DocMode = EditorMode` | 不动（别名保留） |
| 同文件第 46 行起的 `MODE_LABEL` | 四键（双栏 / 仅编辑 / 仅预览 / 即时渲染） | **保留四键**，阶段 C 复用；阶段 A 靠归一化让前两档之外的键取不到 |

结论：本阶段**不改** `EditorMode` 联合类型、不改 props 类型、不把 `ProductEditorMode` 写进组件签名；`ProductEditorMode` 只出现在 `editor-mode.ts` 的写入侧。

- [x] **Step 1: 用户已确认（2026-09-29「以此执行计划」）：阶段 A 可以正式收敛，本计划整体状态为「生效」。**

阶段 A 的生产模式正式收敛为“仅编辑 + 仅预览”；双栏与即时渲染暂不出现在生产设置和切换条中。旧的 `split` / `live` 数据不删除，按兼容规则读入后不再作为阶段 A 的生产可用模式；本机记忆到旧档时回退到 `available` 的第一档（阶段 A 即 `edit`）。

这条确认只覆盖**阶段 A**：阶段 B 仍是「先试验、后替换」，阶段 C / D 各自的门槛（见 §5 / §6）保持不变，不因为本计划改为「生效」而视为一并授权。

- [ ] **Step 2: 写会真正变红的失败用例（不要用现在就已经绿的断言）。**

**先说清为什么原来的断言不构成失败测试**：`initialEditorMode()`（`apps/web/src/features/notes/editor-mode.ts` 第 49–57 行）的实现是「本机记住的且 `available` 里有 → 用它；否则用 seed；否则 `available[0]`」。对 `available = ["edit","preview"]` 来说：

| localStorage | 传入 seed | 现在的返回值 |
|---|---|---|
| `split` | `edit` | `edit`（`split` 不在 `available` → 落到 seed） |
| `live` | `edit` | `edit`（同上） |
| `unknown` | `preview` | `preview`（坏值读成 `null` → 落到 seed） |
| `unknown` | `preview`（`available = ["edit"]`） | `edit`（seed 不在 `available` → `available[0]`） |

四条断言**当前即通过**——现有 `initialEditorMode` 对四值 `available` + 旧档 / 坏值已经全部回落。写上去只会得到一个**假的 TDD 门**（原来写的 Step 3「预期失败」本就不成立）。真正会红的是**归一化语义**（Step 4 要改的那一个函数，落在 shared）与**渲染**（Step 5）：

```ts
// packages/shared/test/settings.test.ts —— 归一化＝「用户开着 ∩ 生产允许」
it("归一化按生产允许集过滤，空则兜成产品全集", () => {
  // split / live 用户开着，但阶段 A 的生产不允许 → 只留 edit / preview
  expect(normalizeEditorModes(["split", "edit", "preview", "live"])).toEqual(["edit", "preview"]);
  // 用户开着的档全被生产过滤掉 → 兜成产品全集，绝不让"一个档都切不了"
  expect(normalizeEditorModes(["split", "live"])).toEqual([...PRODUCT_EDITOR_MODES]);
  expect(normalizeEditorModes([])).toEqual([...PRODUCT_EDITOR_MODES]);
  expect(normalizeEditorModes(undefined)).toEqual([...PRODUCT_EDITOR_MODES]);
  // 单个合法档保留
  expect(normalizeEditorModes(["preview"])).toEqual(["preview"]);
});
```

`editor-mode.test.ts` 这一轮只改两处会被阶段 A 弄红 / 弄成类型错误的既有断言（见上面的「会改红的既有用例」与 Step 4），不新增「本来就绿」的回落断言。

- [ ] **Step 3: 运行测试确认失败。**

运行：

```text
pnpm --filter @menote/shared test -- settings.test.ts
```

预期：失败。当前 `normalizeEditorModes`（`packages/shared/src/settings.ts` 第 46–50 行）把 `split` / `live` 一起留下、空值兜成**四档**，上面第一条与第三条断言都会红。（shared 包自己的测试从源码跑，不需要 `packages/*/dist`，所以这里没有前置构建。）

- [ ] **Step 4: 在 shared 里收口：一个归一化函数、两个常量。**

不要在 Web 包里另造一份与 shared 冲突的 `EditorMode`，也不要新增第二套归一化函数。`packages/shared/src/settings.ts` 改成「读兼容照旧、生产收口一处」：

```ts
// ① 读兼容：schema 仍认四档，旧客户端 / 旧数据照常读
export const EditorModeSchema = v.picklist(["split", "edit", "preview", "live"]);
export type EditorMode = v.InferOutput<typeof EditorModeSchema>;

// ② 规范顺序：仍按四档排，决定显示次序（阶段 A 时 split / live 被下面的生产过滤剔掉）
export const EDITOR_MODES: readonly EditorMode[] = ["split", "edit", "preview", "live"];

// ③ 生产允许集：阶段 A 两档；阶段 C 再扩成 ["edit", "live", "preview"]（见 C3）
export const PRODUCT_EDITOR_MODES = ["edit", "preview"] as const;
export type ProductEditorMode = (typeof PRODUCT_EDITOR_MODES)[number];

// ④ 默认值就是生产允许集——只有一处默认，不另立第二份字面量
export const DEFAULT_EDITOR_MODES: readonly EditorMode[] = PRODUCT_EDITOR_MODES;

// ⑤ 复用已有的那一个归一化函数，语义改成「用户开着 ∩ 生产允许」
export function normalizeEditorModes(value: readonly EditorMode[] | undefined): EditorMode[] {
  const wanted = new Set(value ?? []);
  const allowed = new Set<string>(PRODUCT_EDITOR_MODES);
  const kept = EDITOR_MODES.filter((mode) => wanted.has(mode) && allowed.has(mode));
  return kept.length > 0 ? [...kept] : [...PRODUCT_EDITOR_MODES];
}
```

口径（写死，避免以后再漂移）：

- **只有一个归一化函数**：`normalizeEditorModes()`。**不要**新增 `normalizeProductEditorModes()`，也不要让 `PRODUCT_EDITOR_MODES` 与 `DEFAULT_EDITOR_MODES` 各写一份字面量——三套常量并存就是漂移的来源。
- **集合成员**由 `PRODUCT_EDITOR_MODES` 决定；**显示顺序**由 `EDITOR_MODES` 决定（阶段 A 的结果是 `["edit","preview"]`）。阶段 C 扩集合后若希望 `live` 排在 `preview` 前，改的是 `EDITOR_MODES` 一处，不是再写一个排序函数。
- **空 / 全被过滤** → 兜成 `PRODUCT_EDITOR_MODES` 全集，保住「绝不能一个档都切不了」这条既有不变量。
- **入参类型保持 `readonly EditorMode[]`**（四值）：settings 契约、`App.tsx`、`NotesSlot`、`NotesPane` 都还在传四值数组，归一化只在**渲染前**一处做。
- `NoteWorkspace` 现有的 `normalizeEditorModes(availableModes)`（`apps/web/src/features/notes/ui/NoteWorkspace.tsx` 第 165 行）**自动完成产品过滤**，不需要在 App / Slot / Pane 里再加一层。
- `DEFAULT_USER_SETTINGS.editor_mode`（`packages/shared/src/settings.ts` 第 289 行）从 `"split"` 改成 `"edit"`：留着四档默认值会把旧档渗进阶段 A。`editor_mode` 字段本身**保留**（读兼容 + 首次初始值），`EditorModeSchema` 与 `editor_modes` 存储字段都不删。

`editor-mode.ts` 只负责本机上次模式：`readLastEditorMode()` 继续识别旧 `split` / `live`（安全读旧数据），但 `initialEditorMode()` 只能返回当前 `available` 里的档（阶段 A 的 `available` 已被归一化成两档），不合法或不在 `available` 里就回退到 `available[0]`；`writeLastEditorMode()` 的参数收窄为 `ProductEditorMode`，切换时只写 `edit` / `preview`。不要删除旧 `EditorModeSchema`、`editor_mode` 或存储字段，避免旧客户端和同步设置立即不兼容。

**`packages/shared/test/settings.test.ts` 要同步改（现在整份是按四档写的）**：

- 第 70 行：`parsed.output.editor_modes` 断言 `[...EDITOR_MODES]`（默认全开四档）→ 改成 `[...PRODUCT_EDITOR_MODES]`（阶段 A 两档）。
- 第 76 行：`normalizeEditorModes(["live","split","live"])` 期望 `["split","live"]` → 新语义下 `split` / `live` 被生产过滤掉，按 Step 2 的断言重写（兜底成 `["edit","preview"]`）。
- 第 77 行 `["preview"] → ["preview"]` 保留。
- 第 79–80 行：空 / `undefined` 期望 `[...EDITOR_MODES]` → 改成 `[...PRODUCT_EDITOR_MODES]`。
- 第 92 行 `expect(EDITOR_MODES).toEqual(["split","edit","preview","live"])`：**保留**——`EDITOR_MODES` 仍是读兼容与排序用的规范顺序，四值不变。
- 文件头第 51–57 行的注释按新语义改（「默认全开」→「默认＝生产允许集」）。

- [ ] **Step 5: 写会红的正文呈现测试。**

新建 `apps/web/test/note-workspace-modes.test.tsx`，mock `Editor` 与 `MarkdownPreview`，验证：

```tsx
it("普通笔记只显示编辑和预览，切换不出现双栏", async () => {
  const user = userEvent.setup();
  render(<NoteWorkspace {...noteProps} availableModes={["edit", "preview"]} initialMode="edit" />);

  expect(screen.getByRole("button", { name: "仅编辑" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "仅预览" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "分屏" })).toBeNull();
  expect(screen.queryByRole("button", { name: "即时渲染" })).toBeNull();

  await user.click(screen.getByRole("button", { name: "仅预览" }));
  expect(screen.getByTestId("preview")).toBeTruthy();
  expect(screen.queryByTestId("editor")).toBeNull();
});

it("传四值时也只渲染产品允许的两档（归一化在渲染前生效）", async () => {
  // 与 notes-open-feedback.test.tsx 第 84 行、vault-tree.test.tsx 第 60 行同样的四值夹具
  render(<NoteWorkspace {...noteProps} availableModes={["split", "edit", "preview", "live"]} initialMode="split" />);

  expect(screen.getByRole("button", { name: "仅编辑" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "仅预览" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "分屏" })).toBeNull();
  expect(screen.queryByRole("button", { name: "即时渲染" })).toBeNull();
  // 旧档 initialMode="split" 不在归一化结果里 → 落到第一档
  expect(screen.getByRole("button", { name: "仅编辑" })).toHaveAttribute("aria-pressed", "true");
});
```

- [ ] **Step 6: 运行测试确认失败。**

运行（前置构建见 §0）：

```text
pnpm --filter @menote/shared build && pnpm --filter @menote/mdcore build && pnpm --filter @menote/web test -- note-workspace-modes.test.tsx
```

预期：失败。现有工作区仍会渲染 `split` / `live`（第二条用例直接钉住这点），`availableModes` 还没走「用户开着 ∩ 生产允许」。

- [ ] **Step 7: 在 `NoteWorkspace` 只保留阶段 A 的两种分支。**

将正文分支收敛为：

```tsx
{shownMode === "edit" ? (
  <div className="doc-split__pane">
    <Editor key={item.id} initialValue={previewSource} onChange={handleInput} onReady={onEditorReady}
      onFiles={onFiles} ariaLabel="正文" />
  </div>
) : (
  <div className="doc-split__pane">
    <MarkdownPreview source={previewSource} attachments={attachmentsMeta} />
  </div>
)}
```

`available` 进入渲染前必须调用 shared 的 `normalizeEditorModes()`（就是第 165 行那一处，不改函数名、不在别处再过滤一遍），并保证至少返回 `edit`；不得通过隐藏 CSS 留下双栏 DOM 或仍创建第二个编辑器实例。类型边界按上面的「类型边界落点」表执行：`availableModes` 继续收 `EditorMode[]`，`initialMode` / `mode` 继续是 `DocMode`（`= EditorMode`），**不要**用未经检查的类型断言去掩盖差异，也不需要在这一步换 props 类型。

- [ ] **Step 8: 运行局部测试并人工检查。**

运行（前置构建见 §0）：

```text
pnpm --filter @menote/shared build && pnpm --filter @menote/mdcore build
pnpm --filter @menote/web test -- editor-mode.test.ts note-workspace.test.tsx note-workspace-modes.test.tsx
```

预期：通过；`note-workspace.test.tsx` 里被改口径的「切到仅预览再切回」用例按 Step 7 的语义绿；既有表格测试继续断言表格没有笔记模式切换。

手动检查：打开一篇长文，编辑后切到预览再切回，确认内容未回退、没有双栏、滚动和输入可用。

- [ ] **Step 9: 提交代码阶段。**

暂存仅本任务代码与测试；根 `package.json` 的 `version` 从 `0.5.30` 提到 `0.6.0`（本次专项的起点），并在 `CHANGELOG.md` 的同日小标题下加一条 `- v0.6.0 — …`（见 §0「版本策略」）。将提交信息写入 `.git/COMMIT_MSG.txt`，内容：`feat(editor): 收敛正文基础编辑与预览模式`。提交后运行 `git log -1 --format="%s"` 核对，再推送。

### Task A2：更新用户设置入口与回归测试

> **执行记录（2026-09-29，已完成，提交 `2a6b85c`）**：设置面板的开关组改为按
> `PRODUCT_EDITOR_MODES` 渲染（文案用 `Record<ProductEditorMode, …>` 收口），开关状态与写回都按
> **归一化后的产品档**算——顺手修掉一个怪状态：老行只剩 `live` 时，原实现会让两档都显示为关、
> 点一下却把两档一起打开。计划的偏差一处：断言**没有**留在 `apps/web/test/ui.test.tsx`，
> 而是拆到新建的 `apps/web/test/settings-editor-modes.test.tsx`（5 条）——原文件加这几条会撞
> ESLint `max-lines`（测试目录里非空非注释行数上限 500）；`ui.test.tsx` 只留一条指向新文件的注释。
> `apps/web/test/app-navigation.test.tsx` 不需要动（没有新增 props）。

**阶段 A 已获用户确认（用户 2026-09-29「以此执行计划」），本计划状态已改为「生效」；本任务照此实施。**设置仍保留“编辑模式”开关组，但本阶段只列“仅编辑”和“仅预览”；至少保留一个。旧四档设置值只做读兼容，不再由阶段 A UI 写回 `split` / `live`。

**Files:**
- Modify: `apps/web/src/features/settings/ui/SettingsPanel.tsx`
- Modify: `apps/web/test/ui.test.tsx`（第 512–551 行现有「四档开关组」断言必须按两档重写：第 520–526 行 `getAllByRole("switch")` 的条数从 4 改 2、`["双栏","仅编辑","仅预览","即时渲染"]` 的名字表改掉、第 530 行 `editor_modes: ["split","edit","live"]` 的期望改成两档；第 533–551 行「只剩一档时最后一个开关禁用且原因可见」用例也要按两档重写）
- Modify: `apps/web/test/app-navigation.test.tsx`（若设置夹具需要新增 props）

- [ ] **Step 1: 写失败的设置页面用例。**

增加断言：编辑器设置只出现“仅编辑”和“仅预览”两个可并存开关；不出现“即时渲染”或“双栏”；最后一个开关仍不能关闭且可见原因。

```tsx
expect(screen.getByRole("switch", { name: /仅编辑/ })).toBeTruthy();
expect(screen.getByRole("switch", { name: /仅预览/ })).toBeTruthy();
expect(screen.queryByText("分屏")).toBeNull();
expect(screen.queryByText("即时渲染")).toBeNull();
```

- [ ] **Step 2: 运行用例确认失败。**

运行：`pnpm --filter @menote/web test -- ui.test.tsx`

预期：失败，现有设置仍基于四档 `EDITOR_MODES` 渲染。

- [ ] **Step 3: 将设置列表改为阶段 A 的产品模式。**

设置 UI 使用 shared 的 `PRODUCT_EDITOR_MODES`；共享 `EditorModeSchema` 仍接受旧 `split` / `live`，以保证旧客户端和旧数据可读，但阶段 A 的 `editor_modes` 默认值、设置 UI 和新的写入只使用 `edit` / `preview`。`editor_mode` 旧字段保留为兼容字段，默认值与读侧坏值回退必须明确为 `edit`，不能继续让 shared 的四档默认值把旧档渗入阶段 A。这里需要同步修改 `DEFAULT_EDITOR_MODES`、`DEFAULT_USER_SETTINGS.editor_mode`（`packages/shared/src/settings.ts` 第 289 行，从 `"split"` 改 `"edit"`）、`SettingsPanel` 的选项清单，并补 shared 设置 schema 的回归测试（改法见 A1 Step 4 的清单；A1 已经改过的那几处只做核对）；不要只在 UI 过滤，否则设置回写仍会继续产生旧档。

- [ ] **Step 4: 运行设置与类型检查。**

运行：

```text
pnpm --filter @menote/shared build && pnpm --filter @menote/mdcore build
pnpm --filter @menote/web test -- ui.test.tsx editor-mode.test.ts
pnpm typecheck
```

预期：通过。

- [ ] **Step 5: 提交代码阶段。**

提交信息：`feat(settings): 收敛正文可选模式`。提交前后执行项目 Git 规则。

## 3. 阶段 B：共享 `/` 格式语义与快捷输入试验

阶段 B 不依赖阶段 A 的设置迁移代码；但必须先确认阶段 A 已经把生产切换条收敛为 `edit` / `preview`，否则编辑试验页和生产页会出现两套互相矛盾的模式清单。阶段 B 仍不把候选即时渲染放进生产正文。

### Task B1：以纯函数定义可复用的 Markdown 格式命令

**Files:**
- Create: `apps/web/src/app/editor/format-commands.ts`
- Create: `apps/web/src/app/editor/format-commands.test.ts`

- [ ] **Step 1: 写失败的格式命令用例。**

先只覆盖 v3 确认的基础语义：加粗、斜体、无序列表、有序列表、引用、行内代码、链接。测试以文本与选区为输入，输出新文本和新选区；不依赖 CodeMirror：

```ts
import { applyFormatCommand } from "../src/app/editor/format-commands";

it("加粗包裹选区并把选区留在标记内", () => {
  expect(applyFormatCommand("今天开会", { from: 2, to: 4 }, "bold")).toEqual({
    text: "今天**开会**",
    selection: { from: 4, to: 6 },
  });
});

it("无序列表只给每个非空行加 - 空格", () => {
  // "第一行\n\n第二行" 共 8 个字符（索引 0–7），to 是开区间 → 要覆盖到最后一个「行」必须写 8
  expect(applyFormatCommand("第一行\n\n第二行", { from: 0, to: 8 }, "bullet-list").text)
    .toBe("- 第一行\n\n- 第二行");
});

it("链接为没有选区时插入可继续填写的标准 Markdown", () => {
  expect(applyFormatCommand("", { from: 0, to: 0 }, "link")).toEqual({
    text: "[链接文字](https://)",
    selection: { from: 1, to: 5 },
  });
});
```

口径（在 Step 1 就写死，不留到 Step 4）：**跨行选区按被选区覆盖的整行展开——半行也算整行**。`{ from, to }` 只覆盖某行的一部分时，该行整行参与命令（列表、引用、标题都按整行处理）；加粗 / 斜体 / 行内代码这类**成对标记**才按精确字符区间包裹。这样「从行中间拖到下一行行首」也能得到符合直觉的结果。

- [ ] **Step 2: 运行测试确认失败。**

运行：`pnpm --filter @menote/web test -- format-commands.test.ts`

预期：失败，模块不存在。

- [ ] **Step 3: 实现受限命令注册表和纯函数。**

实现：

```ts
export const FORMAT_COMMANDS = [
  "bold", "italic", "bullet-list", "ordered-list", "quote", "inline-code", "link",
  "heading", "code-block", "task-list",
] as const;
export type FormatCommandId = (typeof FORMAT_COMMANDS)[number];

export type TextSelection = { from: number; to: number };
export type FormatResult = { text: string; selection: TextSelection };
export function applyFormatCommand(text: string, selection: TextSelection, command: FormatCommandId): FormatResult;
```

纯格式命令只能产生标准 Markdown；不得生成下划线、HTML、颜色、字体或 CSS。标题、代码块、任务清单也放同一注册表，但由宿主过滤是否展示。

**本轮不做 `/图片`、`/附件` 命令**（设计 v3 §3.2 把「图片 / 附件插入」列为正文能力，但它是异步内容动作）：正文附件继续走**现有附件按钮**——`Editor` 的 `onFiles`（`NoteWorkspace.tsx` 第 473 行传入），不新增命令入口、不改上传与引用流程。它需要异步上传、占位符替换和现有 `EditorHandle.replace()`，不能伪装成 `{ text, selection }` 的同步命令。这一条同时记入 §9「不做 / 遗留」清单，免得从自检里消失。

- [ ] **Step 4: 扩充边界用例并运行。**

新增：空选区、跨多行、中文文本、已有列表前缀，以及同一语义的重复操作口径。重复操作必须明确为 toggle：选区已被同一成对标记完整包裹时再次执行会去掉标记；列表命令在所选非空行全部已有相同列表前缀时再次执行会去掉前缀，否则只给缺少前缀的行补齐。引用同理按行 toggle。运行：`pnpm --filter @menote/web test -- format-commands.test.ts`，预期全绿。

- [ ] **Step 5: 提交代码阶段。**

提交信息：`feat(editor): 添加共享 Markdown 格式命令`。

### Task B2：实现可过滤的 `/` 菜单，不接生产文本写入

**Files:**
- Create: `apps/web/src/app/editor/CommandMenu.tsx`
- Create: `apps/web/src/app/editor/command-menu.test.tsx`

- [ ] **Step 1: 写失败的菜单交互用例。**

用例要求菜单只根据传入的 command ids 显示，支持键盘上下、Enter 和 Esc：

```tsx
const user = userEvent.setup();
const onChoose = vi.fn();
const onClose = vi.fn();

render(
  <CommandMenu open query="" commands={["bold", "bullet-list"]}
    onChoose={onChoose} onClose={onClose} />,
);
expect(screen.getByRole("option", { name: "加粗" })).toBeTruthy();
expect(screen.getByRole("option", { name: "无序列表" })).toBeTruthy();
expect(screen.queryByRole("option", { name: "标题" })).toBeNull();

// 打开时**默认高亮首项**，所以 ArrowDown 一次落到第二项
await user.keyboard("{ArrowDown}{Enter}");
expect(onChoose).toHaveBeenCalledWith("bullet-list");
```

再加一条「不按方向键直接 Enter」：默认高亮首项 → `onChoose` 收到 `"bold"`。两条一起把「首项默认高亮」钉成契约，而不是让「ArrowDown 后选中第二项」这条隐含依赖它。

- [ ] **Step 2: 运行测试确认失败。**

运行：`pnpm --filter @menote/web test -- command-menu.test.tsx`

预期：失败，组件不存在。

- [ ] **Step 3: 实现无业务依赖的菜单。**

`/` 菜单不是全局快捷键，只由当前宿主在行首或空白后触发；输入法组合期间不触发。

组件契约固定为：

```ts
export interface CommandMenuProps {
  open: boolean;
  query: string;
  commands: readonly FormatCommandId[];
  onChoose: (id: FormatCommandId) => void;
  onClose: () => void;
}
```

行为契约（写死，测试按此判定）：

- **默认高亮首项**：`open` 变 true、或过滤结果变化时，高亮回到第一项；打开后不按方向键直接 `Enter`，选中的是首项。
- **方向键循环**：`ArrowDown` / `ArrowUp` 在候选项之间移动且**首尾循环**（在最后一项按 `ArrowDown` 回到第一项）；移动时高亮项要滚进可视区。
- **`Enter` 选中**：选中的是当前高亮项，回调 `onChoose(id)`；关不关菜单由宿主决定，组件自己不关。
- **`Escape` 关闭**：只调 `onClose()`、只关闭菜单，焦点留给宿主（不抢焦点）。
- **过滤后无匹配**：菜单保持打开、**不渲染任何 `option`**，显示一行「没有匹配的命令」；此时 `Enter` 与方向键**不触发 `onChoose`**。不能静默关掉菜单——用户会以为按键丢了。
- 过滤只按中文命令名或稳定关键词匹配；不要给 document 单独挂全局监听。
- 菜单项**若带图标**：必须先在 `apps/web/src/app/ui/Icon.tsx` 的 `IconName` 联合与 `<symbol id="i-…">` 里各加一份——`layout-invariants.test.ts` 第 151–163 行守「名字与字形一一对应」，缺字形屏幕上就是一片空白且不报错。不带图标就不用动它。

- [ ] **Step 4: 补组合输入保护用例。**

菜单触发层以后必须在 `event.isComposing === true` 时不打开；在本组件测试里至少验证 ESC 和点击外部关闭由宿主显式调用，不模拟不可控的全局事件。

- [ ] **Step 5: 运行用例并提交。**

运行：`pnpm --filter @menote/web test -- command-menu.test.tsx`。

提交信息：`feat(editor): 添加可过滤的样式命令菜单`。

### Task B3：在编辑试验页接入 `/`，验证且不触碰生产数据

**现有测试替身约束：** `apps/web/test/editor-lab-page.test.tsx` 当前把 `Editor` mock 成只读 textarea，不能直接完成“正文输入 `/`”测试；Step 1 必须先扩展替身以暴露 `onChange` / `onCommand`，再写交互断言。

**Files:**
- Modify: `apps/web/src/features/editor-lab/ui/EditorLabPage.tsx`
- Modify: `apps/web/src/features/editor-lab/store.ts`
- Modify: `apps/web/test/editor-lab-page.test.tsx`
- Modify: `apps/web/test/editor-lab-perf.test.ts`

- [ ] **Step 1: 写失败的隔离用例。**

扩展现有试验页用例，确认在正文和三个快捷框输入 `/` 时可以显示对应基础命令；选择命令后只更改 `EDITOR_LAB_STORAGE_KEY`，不改变 `menote:notes`，也不调用发布回调：

```tsx
await user.type(screen.getByLabelText("Memo 快捷录入"), "/加粗");
expect(await screen.findByRole("option", { name: "加粗" })).toBeTruthy();
await user.keyboard("{Enter}");
expect(window.localStorage.getItem("menote:notes")).toBe("正式笔记");
expect(window.localStorage.getItem(EDITOR_LAB_STORAGE_KEY)).toContain("**");
```

- [ ] **Step 2: 运行测试确认失败。**

运行：`pnpm --filter @menote/web test -- editor-lab-page.test.tsx editor-lab-perf.test.ts`

预期：失败，现有试验页明确标记 `@` / `/` 尚未接入。

- [ ] **Step 3: 仅在试验页接线 `/`。**

快捷试验框可先用受控 textarea + `CommandMenu`；正文试验的 `Editor` 通过最小 `onCommand` / `onSlashTrigger` 接口接入。命令执行统一调用 `applyFormatCommand()`；不得在两个宿主重复拼 Markdown。

- [ ] **Step 4: 加入性能与稳定性读数。**

在试验页保留“动作到下一帧”和 Long Task 记录；增加由编辑器宿主显式上报的 `activeEditors` 与 `activeListeners`，不要再用 `querySelectorAll("[data-editor]")` 代替真实生命周期。

测试至少验证“连续 20 次模式 / 样文切换后 activeEditors 与 activeListeners 回到基线”。纯函数计数器可以从 `editor-lab/perf.ts` 导出并单测。

- [ ] **Step 5: 运行局部验证并人工试验。**

运行：

```text
pnpm --filter @menote/shared build && pnpm --filter @menote/mdcore build
pnpm --filter @menote/web test -- editor-lab-page.test.tsx editor-lab-perf.test.ts format-commands.test.ts command-menu.test.tsx
```

人工：中文输入法组合时输入 `/` 不应中断组合；代码块内与非空白前输入 `/` 不打开菜单；列表连续回车不丢焦点。

- [ ] **Step 6: 提交代码阶段。**

提交信息：`feat(editor-lab): 验证共享样式命令与生命周期`。

## 4. 阶段 B（续）：快捷输入轻量即时渲染与 `@` 属性

### Task B4：先定义快捷输入属性契约，不把属性写进 Markdown

**Files:**
- Create: `apps/web/src/app/fnbar/quick-attributes.ts`
- Create: `apps/web/test/quick-attributes.test.ts`

- [ ] **Step 1: 写失败的属性过滤用例。**

```ts
expect(attributeCommandsFor("task").map((item) => item.id)).toEqual(["due", "priority"]);
expect(attributeCommandsFor("memo")).toEqual([]);
expect(attributeCommandsFor("note")).toEqual([]);
```

另测：不返回“正文标签”“正文字体”等项目。

**`note` 这个宿主是什么**（原文「正文类型不在此模块的合法宿主集合中」与类型里的 `"note"` 自相矛盾，按这里理解）：`note` = **笔记快捷录入宿主**（`Composer` 的「笔记」档、添加内容窗口的笔记档），它是本模块的**合法宿主**，只是**当前没有可写的属性命令**（笔记的发布目标 / 文件夹只有展示 chip，没有可写通道），所以返回空数组。**笔记正文**不调用本模块：`@` 不进正文（设计 v3 §3.3），正文的标签、文件夹、日期仍走标题区、属性面板与更多菜单。

- [ ] **Step 2: 运行失败测试。**

运行：`pnpm --filter @menote/web test -- quick-attributes.test.ts`

预期：失败，模块不存在。

- [ ] **Step 3: 定义数据而非业务实现。**

```ts
export type QuickAttributeHost = "memo" | "task" | "note";
export type QuickAttributeId = "due" | "priority";
export interface QuickAttributeCommand {
  id: QuickAttributeId;
  label: string;
  hosts: readonly QuickAttributeHost[];
}
export function attributeCommandsFor(host: QuickAttributeHost): readonly QuickAttributeCommand[];
```

模块只决定菜单能显示什么；日期、优先级、文件夹选择和标签写入仍由 `Composer` / `AddEntryDialog` 的现有字段与其上层发布回调完成。禁止在 Markdown 正文插入 `@xxx` 作为属性持久化格式。

`QuickAttributeHost` **保留 `"note"`**：它是合法宿主（见 Step 1），只是命令表为空；删掉它会逼着以后接笔记属性时再改一次类型与全部调用方。

- [ ] **Step 4: 运行测试并提交。**

运行：`pnpm --filter @menote/web test -- quick-attributes.test.ts`。

提交信息：`feat(composer): 定义快捷输入属性命令`。

### Task B5：新建轻量即时渲染 `QuickComposer`

**Files:**
- Create: `apps/web/src/app/fnbar/QuickComposer.tsx`
- Create: `apps/web/test/quick-composer.test.tsx`
- Modify: `apps/web/src/app/theme/app.css`
- Modify: `apps/web/test/layout-invariants.test.ts`
- Modify: `apps/web/test/focus-visibility.test.ts`
- 只跑不改（新 UI 会撞上的既有全局守卫，必须保持绿）：`apps/web/test/style-coverage.test.ts`（`src` 下每个 `className` 都必须在 `tokens.css` / `app.css` 里有规则）、`apps/web/test/ui-buttons-labelled.test.tsx`、`apps/web/test/copy-and-icons.test.ts`、`apps/web/test/css-colors.test.ts`（禁硬编码颜色，`app.css` 与 `src` 全量）
- Modify（仅当菜单项带图标）：`apps/web/src/app/ui/Icon.tsx`——`IconName` 联合与 `<symbol id="i-…">` sprite 必须成对增删，由 `layout-invariants.test.ts` 第 151–163 行守

- [ ] **Step 1: 写失败的快捷输入行为用例。**

用例覆盖最小承诺，不要求完整富文本编辑器：

```tsx
it("失焦后按 Markdown 语义呈现已完成的短内容，再次点击可继续编辑", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <QuickComposer mode="memo" value="- **买牛奶**" onChange={onChange} attributes={[]}
      ariaLabel="快速录入" />,
  );

  const input = screen.getByRole("textbox", { name: "快速录入" });
  await user.click(input);
  await user.tab();
  expect(screen.getByText("买牛奶", { selector: "strong" })).toBeTruthy();

  await user.click(screen.getByText("买牛奶", { selector: "strong" }));
  expect(screen.getByRole("textbox", { name: "快速录入" })).toBeTruthy();
});

it("组合输入中不打开 / 或 @ 菜单", async () => {
  const onChange = vi.fn();
  render(<QuickComposer mode="memo" value="" onChange={onChange} attributes={[]} ariaLabel="快速录入" />);
  fireEvent.compositionStart(screen.getByRole("textbox", { name: "快速录入" }));
  fireEvent.keyDown(screen.getByRole("textbox", { name: "快速录入" }), { key: "/", isComposing: true });
  expect(screen.queryByRole("listbox")).toBeNull();
});
```

`ariaLabel` 是**必填**（见 Step 3 契约），示例里必须传、也**必须按传入值取元素**：示例统一用 `"快速录入"`——与 `Composer.tsx` 第 229 行的真实值一致；添加窗口那侧传的是 `AddEntryDialog` 现有的 `${TITLE[kind]}的内容`（`AddEntryDialog.tsx` 第 29–32、114 行），用例就按那个名字取，不要写死另一个文案。

- [ ] **Step 2: 运行失败测试。**

运行：`pnpm --filter @menote/web test -- quick-composer.test.tsx`

预期：失败，组件不存在。

- [ ] **Step 3: 实现最小且可退化的即时渲染模型。**

组件固定受控契约：

```ts
export interface QuickComposerProps {
  mode: QuickAttributeHost;
  value: string;
  onChange: (value: string) => void;
  attributes: readonly QuickAttributeCommand[];
  onChooseAttribute?: (id: QuickAttributeId) => void;
  onSubmitShortcut?: () => void;
  ariaLabel: string;
}
```

`attributes` 是 **`readonly QuickAttributeCommand[]`**（只读，组件不改也不排序）；`onChange` 与 `ariaLabel` **必填**——示例里必须给出定义（不要引用未定义的 `onChange`），裸 `<textarea>` 也要带上这个 `ariaLabel`。

实现规则：

- 聚焦时使用一个 `<textarea>`，保证中文输入法、原生撤销与列表连续输入可靠；
- 失焦且内容非空时用 `React.lazy` + `Suspense` 动态导入的 `MarkdownPreview` 只读显示；点击呈现区域重新聚焦 textarea；不得静态 import `MarkdownPreview`；
- `/` 在行首或空白后触发 `CommandMenu`，只给快捷基础命令；
- `@` 同样只在行首或空白后触发属性菜单，且仅显示 `attributes`；
- 代码围栏内、输入法组合中、搜索框和标题框均不触发；
- 不把 MarkdownPreview 设为 `contenteditable`，不解析或改写用户内容；
- 多个实例彼此完全受控，不使用 document 级共享焦点状态。

这是一种“编辑时可靠 textarea，完成后立即按 Markdown 显示”的轻量即时渲染，不冒充正文的逐字符块级富文本。

- [ ] **Step 4: 补 CSS，不另立视觉语言。**

在现有 `app.css` 中新增 `.quick-composer` 局部类：输入态沿用 `.composer__input` 的 40–180px `min-height` / `max-height` 和 `resize: vertical` 约束；快捷输入总高度继续满足 DESIGN.md §2.5 的 136px 结构不变量，附加项保持 26px 且不换行。失焦呈现态使用独立 `.quick-composer__view`，不能让 Markdown 段距把宿主无限撑高：规定固定/最大高度与内部滚动，并保留明确可点击 / 聚焦入口和 44px 触屏命中区，不以 hover 作为唯一编辑入口。使用既有 `--panel`、`--line`、`--radius-lg`、`--sp-*`、`markdown-body` 语义，不写裸色、裸字号或新尺寸体系。

**类名方案说死（不留二选一）**：**输入态的 `<textarea>` 保留 `.composer__input` 类名**，新增的呈现态用 `.quick-composer__view`，外层容器用 `.quick-composer`。这样两条既有守卫继续有效、守的还是同一个东西——`layout-invariants.test.ts` 第 100–102 行按 `.composer__input` 守 40–180px `min-height` / `max-height` 与 `resize: vertical`；`focus-visibility.test.ts` 第 20 行把 `.composer__input` 列进 outline 白名单（补偿方式是 `.composer:focus-within` 的焦点环）。

**另一方案（输入态改名，例如 `.quick-composer__input`）必须同时改三处，缺一处就是假绿**：①`layout-invariants.test.ts` 第 100–102 行的三处选择器；②`focus-visibility.test.ts` 第 19–21 行白名单的键（并写清补偿样式）；③`app.css` 里 `.composer__input` 规则本身（改名还是删除要一次说清）。只改白名单不改断言，等于把守卫删了还留着绿。

- [ ] **Step 5: 加入多实例、发布快捷键与布局守卫用例。**

扩展 `layout-invariants.test.ts`：检查 `.composer__input` 仍有 40–180px、`.composer__extras` 仍为 26px / nowrap、`.composer__modes` 仍为 flex，并新增 `.quick-composer__view` 的最大高度 / 内部滚动规则。`focus-visibility.test.ts` 按 Step 4 说死的方案**不需要改白名单**（输入态保留 `.composer__input`）——只需确认 `.quick-composer` 外层没有新写 `outline: none`：新规则一旦抹掉 outline 又没有补偿，这条守卫会红，这正是它该做的事。

验证两个 `QuickComposer` 互不串值；`Ctrl/Cmd+Enter` 调 `onSubmitShortcut`；选择 `/` 命令只修改当前实例；选择 `@` 只调当前宿主的 `onChooseAttribute`，不把属性写入 text。

- [ ] **Step 6: 运行测试并手动验证。**

运行：

```text
pnpm --filter @menote/shared build && pnpm --filter @menote/mdcore build
pnpm --filter @menote/web test -- quick-composer.test.tsx quick-attributes.test.ts format-commands.test.ts layout-invariants.test.ts focus-visibility.test.ts style-coverage.test.ts ui-buttons-labelled.test.tsx copy-and-icons.test.ts css-colors.test.ts
pnpm --filter @menote/web build
pnpm check:size
```

`pnpm check:size`（`scripts/check-bundle-size.mjs`）读的是 `apps/web/dist/client/index.html`——**不先构建就是读旧产物或直接报错**，所以它前面必须紧跟 `pnpm --filter @menote/web build`；单独跑 `check:size` 没有意义。

人工：分别测试中文、英文、粘贴多行列表、快速在三框之间切换、点渲染内容重新编辑、Esc 关闭菜单。确认 `MarkdownPreview` 通过 `React.lazy` + `Suspense` 动态加载，不把 `markdown-it` / `DOMPurify` 静态拖入首屏入口包。

- [ ] **Step 7: 提交代码阶段。**

提交信息：`feat(composer): 添加轻量即时渲染输入宿主`。

### Task B6：替换功能栏与添加窗口的文本框，并分别接入 `@` 行为

**Files:**
- Modify: `apps/web/src/app/fnbar/Composer.tsx`
- Modify: `apps/web/src/app/fnbar/AddEntryDialog.tsx`
- Modify: `apps/web/src/app/AddEntrySlot.tsx`（仅在需要传入已有属性选择器时）
- Modify: `apps/web/test/quick-composer.test.tsx`
- Modify: `apps/web/test/add-entry-dialog.test.tsx`
- Modify: `apps/web/test/fnbar.test.tsx`

- [ ] **Step 1: 写失败的功能栏接线用例。**

验证功能栏三个模式均使用 `QuickComposer`；快捷输入首期只有真正有写入落点的待办 `@due` / `@priority`，Memo 标签和笔记目录命令暂不出现（或明确禁用并注明原因）；`/标题` 在快捷输入不出现。

- [ ] **Step 2: 写失败的添加窗口接线用例。**

验证 Memo / 待办添加窗口也使用相同宿主，且 Ctrl/Cmd+Enter、取消、发布、已有 `ModeExtras` 保持原语义。

- [ ] **Step 3: 运行失败测试。**

运行：

```text
pnpm --filter @menote/shared build && pnpm --filter @menote/mdcore build
pnpm --filter @menote/web test -- quick-composer.test.tsx add-entry-dialog.test.tsx fnbar.test.tsx
```

预期：失败，两个入口仍各自直接渲染 textarea。

- [ ] **Step 4: 用 `QuickComposer` 替换两个 textarea。**

`Composer` 继续持有 `text`、三档模式、任务字段、发布函数和固定三行布局；只将输入 DOM 替换为：

```tsx
<QuickComposer
  mode={mode}
  value={text}
  onChange={setText}
  attributes={attributeCommandsFor(mode)}
  onChooseAttribute={(id) => openQuickAttribute(id)}
  onSubmitShortcut={publish}
  ariaLabel="快速录入"
/>
```

`openQuickAttribute()` 在本阶段只映射到已有受控字段：`due` 聚焦截止日期、`priority` 聚焦优先级。不得为 `tags` 或 `target-folder` 创建临时字符串协议、假选择器或仅改变展示 chip 的伪实现；这两项不进入本阶段生产命令集。

`AddEntryDialog` 复用同一组件，但只传 `memo` 或 `task` 宿主类型，笔记不进该窗口。

**现有领域能力限制：** 当前 `publishMemo` 的实际签名只接受 `{ asTask, due, priority }`，Memo 标签来自正文 `#标签` / YAML 派生；当前 `Composer` 没有标签选择器。当前笔记目标只是 `ModeExtras` 的展示 chip，也没有可写目录选择通道。因此 B6 不得声称这两项“复用既有写入路径”：若本轮不另立标签 / 目录产品设计，则 `@tags` 与 `@target-folder` 只保留为未接入遗留，不进入可通过的生产命令集；B4 测试只保证有真实落点的 `task -> due / priority`（`attributeCommandsFor("memo")` / `("note")` 返回空数组），没有落点的命令**不做成 disabled 的假入口**，直接不出现在菜单里。

**本轮 `@` 的交付范围与遗留（登记在案）**：

- 交付：**待办**的 `@due` / `@priority`。
- 未接入遗留：`@tags`（Memo 标签）、`@target-folder`（笔记目标文件夹）、整个笔记快捷录入的 `@` 属性。
- 登记位置：`docs/todo/Menote-开发计划-v1.md` 的「遗留 → 后续」表（动作由执行者做；该文件不在本计划的改动范围内）。

- [ ] **Step 5: 逐项补齐真实属性入口，再替换生产。**

这一步按三种属性分别独立提交，不能将未设计的数据修改混进输入组件：

1. Memo 标签：当前没有独立标签写入通道，Memo 标签由正文 `#标签` / YAML 派生；本阶段不做 `@tags`，登记为后续产品设计项。
2. 待办日期 / 优先级：复用 `ModeExtras` 的现有受控字段；命令只聚焦或打开现有控件。
3. 笔记文件夹：当前只有展示 chip，没有可写目录选择通道；本阶段不做 `@target-folder`，登记为后续产品设计项。

每项均先写“命令选择 → 正确草稿字段 / 发布参数”的失败用例，再实现最小接线。

- [ ] **Step 6: 运行局部与全量验证。**

运行：

```text
pnpm --filter @menote/shared build && pnpm --filter @menote/mdcore build
pnpm --filter @menote/web test -- quick-composer.test.tsx add-entry-dialog.test.tsx
pnpm lint
pnpm typecheck
pnpm test
```

人工：功能栏三个模式、Memo/待办添加窗口、键盘发布、Esc、离线发布禁用与既有 toast 逐项验证。

- [ ] **Step 7: 提交代码阶段。**

按“基础替换”和每项真实属性接线拆提交；提交信息分别使用 `feat(composer): 接入快捷即时渲染`、`feat(composer): 接入 Memo 标签属性` 等明确范围。

## 5. 阶段 C：正文即时渲染的试验、验收与替换

阶段 C 是后续可选阶段，不得与阶段 A 合并提交或默认上线；这里的“后续可选”指重新评估和补验收，不代表当前代码不存在。只有阶段 B 的快捷输入经验、正文试验数据和人工输入法验收均通过，且用户再次确认后，才允许从 `edit` / `preview` 扩展为 `edit` / `live` / `preview`。

### 既有事实与回滚点

- 即时渲染已在 v0.5.5 首期落地，当前代码与 `docs/modules/Menote-即时渲染-设计-v1.md`（生效）已有实现和 19 条纯函数测试；本阶段不是从零发明即时渲染，而是重新评估它是否继续作为生产可见模式。
- 阶段 A 暂时从设置和正文切换条移除 `live` 是有意的产品收敛，不等于删除实现。回滚点是恢复生产模式清单中的 `live`、恢复设置选项和工作区分支；不得删除 `live-preview.ts` 或已有覆盖测试。
- C1/C2 必须直接继承 `docs/modules/Menote-即时渲染-设计-v1.md` §七 的未做 / 待办清单，至少逐项记录：真实中文输入法、800KB 长文深滚动、图片内联、代码块语言高亮、任务清单可勾选、front matter、`#标签` 展示、`DESIGN.md` 视觉回写与移动端；表格仍按本计划暂缓。
- 未完成上述清单中被选入本次生产范围的人工验收前，不能重新把 `live` 放回阶段 A 的生产清单。

### Task C1：先让试验页测到真实的正文生命周期

**Files:**
- Modify: `apps/web/src/app/editor/Editor.tsx`
- Modify: `apps/web/src/features/editor-lab/ui/EditorLabPage.tsx`
- Modify: `apps/web/src/features/editor-lab/perf.ts`
- Modify: `apps/web/test/editor-lab-perf.test.ts`
- Modify: `apps/web/test/editor-lab-page.test.tsx`

- [ ] **Step 1: 写失败的生命周期计数测试。**

测试真实编辑器宿主回调，而不是 DOM 节点数：

```ts
it("20 次 edit/live 切换后活动实例和监听数回到基线", () => {
  const meter = createEditorLabMeter();
  meter.created();
  meter.listenerAdded();
  for (let index = 0; index < 20; index += 1) meter.modeReconfigured();
  expect(meter.snapshot()).toMatchObject({ activeEditors: 1, activeListeners: 1 });
});

it("销毁编辑器会同时回收活动实例与监听", () => {
  const meter = createEditorLabMeter();
  meter.created();
  meter.listenerAdded();
  meter.destroyed();
  meter.listenerRemoved();
  expect(meter.snapshot()).toMatchObject({ activeEditors: 0, activeListeners: 0 });
});
```

- [ ] **Step 2: 运行失败测试。**

运行：`pnpm --filter @menote/web test -- editor-lab-perf.test.ts`

预期：失败，原因是 `createEditorLabMeter` 尚不存在；当前 DOM 查询 `[data-editor]` 位于 `EditorLabPage.tsx`，不是 `perf.ts` 的计量实现。

- [ ] **Step 3: 增加仅开发/试验使用的生命周期回调。**

为 `Editor` 增加可选 `onLifecycle`，仅报告：`created`、`destroyed`、`listenerAdded`、`listenerRemoved`；不要在应用层统计 `document` 监听，也不要改变生产保存逻辑。`EditorLabPage` 用它维护读数。

- [ ] **Step 4: 保持 edit / live 的单实例重配置。**

保留 `Editor` 现有 `Compartment` 机制：`live` 切换只能 `reconfigure`，不得改变 `key`、重建 `EditorView`、重置撤销历史或光标。文章切换可以重挂载，但每次旧实例必须 destroy。

- [ ] **Step 5: 运行测试和人工 20 次循环。**

运行：`pnpm --filter @menote/web test -- editor-lab-perf.test.ts editor-lab-page.test.tsx`。

人工：编辑 / 即时渲染切 20 次、三篇样文轮换 20 次；记录下一帧时间、Long Task、活动实例和监听数；未达到 v3 的“不会越来越慢”要求则停在试验页，不进入生产。

- [ ] **Step 6: 提交代码阶段。**

提交信息：`feat(editor-lab): 记录正文编辑器真实生命周期`。

### Task C2：在试验页验证正文即时渲染与只读复用

**既有实现边界：** 不重新发明 `live-preview` 装饰算法。先按 `docs/modules/Menote-即时渲染-设计-v1.md` §七 的未做 / 待办逐项核对，只有明确要修的条目才修改；C2 的目标是验证和补缺，不是把已有实现重写一遍。

**Files:**
- Create: `apps/web/test/editor-readonly.test.tsx`
- Modify: `apps/web/src/features/editor-lab/ui/EditorLabPage.tsx`
- Modify: `apps/web/src/app/editor/Editor.tsx`
- Modify: `apps/web/src/app/editor/live-preview.ts`
- Modify: `apps/web/test/live-preview.test.ts`
- Modify: `apps/web/test/layout-invariants.test.ts`
- Modify: `apps/web/test/focus-visibility.test.ts`

- [ ] **Step 1: 写可判定红绿的用例（不要写成注释占位，也不要写成条件句）。**

用例落点（选一个，不并列）：**新建 `apps/web/test/editor-readonly.test.tsx`**——`live` + `readOnly` 的行为要渲染 `Editor`，与 `live-preview.test.ts` 的纯函数风格不同；纯装饰算法的新用例仍加在 `apps/web/test/live-preview.test.ts`（该文件现有 19 条纯函数用例，同风格）。

```tsx
// editor-readonly.test.tsx
it("即时渲染打开时仍将正文变更交给 onChange", () => {
  const onChange = vi.fn();
  render(<Editor initialValue="- **重点**" live onChange={onChange} ariaLabel="正文" />);
  // 通过编辑器测试替身派发一次 docChanged
  expect(onChange).toHaveBeenCalledWith(expect.stringContaining("重点"));
});

it("即时渲染只读时不接受文本变更", () => {
  const onChange = vi.fn();
  render(<Editor initialValue="正文" live readOnly onChange={onChange} ariaLabel="正文" />);
  // 用同一替身派发一次 docChanged / 试一次输入
  expect(onChange).not.toHaveBeenCalled();
});
```

两条用例的判定，写死：

- 第一条**预期一开始就绿**（当前实现会把变更交给 `onChange`），它的作用是**防回归**，**不作为 TDD 的红**。
- 第二条是本任务唯一的判定门：
  - **红**（`onChange` 被调用）→ 缺口存在，按 Step 3 修 `Editor` / `live-preview.ts`，修到绿再往下。
  - **直接绿** → 说明这个缺口**不存在**（`readOnlyCompartment` 已经挡住）。此时本任务**转为记录**：把「`live` + `readOnly` 下不触发 `onChange`」写进 C2 的验证记录，并作为核对结论补进 `docs/modules/Menote-即时渲染-设计-v1.md` §七 的逐项记录里；**不改代码、不为凑一条红测试编造断言**。

- [ ] **Step 2: 运行并按上一步的判定处理。**

运行（前置构建见 §0）：

```text
pnpm --filter @menote/shared build && pnpm --filter @menote/mdcore build && pnpm --filter @menote/web test -- editor-readonly.test.tsx live-preview.test.ts
```

预期：第一条绿；第二条按上面两种结果之一处理。**不允许**用「若测试暴露……即视为失败」这类条件句当结论——要么修到绿，要么留下「缺口不存在」的记录，两者都写进本任务的提交说明。

- [ ] **Step 3: 最小修复即时渲染扩展。**

遵循现有 `live-preview.ts`：只基于 CodeMirror 文档和语法树生成装饰，不解析或保存第二份 HTML 文档；对输入法组合、代码块、列表和当前编辑位置使用可编辑的源码回退。`readOnly` 继续走 `readOnlyCompartment`，不得通过 CSS `pointer-events:none` 伪造锁定。

- [ ] **Step 4: 在产品口径确认后确定只读复用方式。**

先请用户确认“预览 / 阅读”与“即时渲染只读”是否合并为同一阅读态。确认前不要冻结独立的 `readOnly` 产品入口或试验页开关；技术上可以继续让 `Editor` 的 `readOnly` prop 作为内部能力，但不把它命名为新的用户模式。若合并，试验只需验证预览承担稳定只读；若不合并，再另写只读即时渲染的交互与验收。

- [ ] **Step 5: 运行局部测试并进行人工验收。**

运行：

```text
pnpm --filter @menote/shared build && pnpm --filter @menote/mdcore build
pnpm --filter @menote/web test -- live-preview.test.ts editor-readonly.test.tsx editor-lab-page.test.tsx editor-lab-perf.test.ts
pnpm --filter @menote/web build
pnpm check:size
```

`pnpm check:size` 读 `apps/web/dist/client/index.html`，必须先有同一次 `pnpm --filter @menote/web build`（见 B5 Step 6 同一口径）。

人工样文必须包含：中文长段落、嵌套列表、引用、代码块、链接、任务清单、附件引用。逐项验证中文输入、撤销/重做、选择、代码块内输入、模式切换、锁定后不可编辑。

- [ ] **Step 6: 提交代码阶段。**

提交信息：`feat(editor-lab): 验证正文即时渲染与锁定`。

### Task C3：用户验收后才将正文即时渲染放入生产

**Files:**
- Modify: `packages/shared/src/settings.ts`（**原来漏了它**：`PRODUCT_EDITOR_MODES` 扩成三档，`editor_modes` 的默认值才跟着扩；不改它，C3 完成后默认仍是两档，与「新用户可默认即时渲染」不相容）
- Modify: `packages/shared/test/settings.test.ts`（默认值与归一化的断言跟着扩成三档）
- Modify: `apps/web/src/features/notes/editor-mode.ts`
- Modify: `apps/web/src/features/notes/ui/NoteWorkspace.tsx`
- Modify: `apps/web/src/features/settings/ui/SettingsPanel.tsx`
- Modify: `apps/web/test/note-workspace-modes.test.tsx`
- Modify: `apps/web/test/editor-mode.test.ts`
- Modify: `apps/web/test/ui.test.tsx`（设置页开关组从两档回三档，第 512–551 行那组断言第二次改口径）

- [ ] **Step 1: 汇总试验结果，请用户确认是否允许生产启用。**

必须提供记录：试验浏览器、样文规模、每类动作的最近 / 最大下一帧耗时、Long Task、20 次循环后的活动实例与监听计数、输入法和撤销人工结果。任一稳定性项不通过则不进行本任务。

- [ ] **Step 2: 写失败的生产模式用例。**

```tsx
it("即时渲染通过后可进入生产切换条并成为当前档，但 Markdown 编辑始终仍可选", async () => {
  render(<NoteWorkspace {...noteProps} availableModes={["edit", "live", "preview"]} initialMode="live" />);
  expect(screen.getByRole("button", { name: "即时渲染" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "仅编辑" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "仅预览" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "分屏" })).toBeNull();
});
```

`initialMode` 在这里是**首次初始值**（`editor_mode` 的语义），不是「默认档」：用户本机记住过上次用的那一档时，打开笔记仍用他记的那一档（`editor-mode.ts` 的优先级，见 C3 Step 4）。

另测锁定正文不渲染可输入编辑器、预览可读且不触发 `onInput`。

- [ ] **Step 3: 运行失败测试。**

运行：`pnpm --filter @menote/web test -- note-workspace-modes.test.tsx editor-mode.test.ts`

预期：失败，阶段 A 的产品过滤只允许 edit / preview。

- [ ] **Step 4: 扩展生产允许模式为 edit / live / preview。**

仅在用户再次确认、并在“允许的生产模式”与 shared 设置契约中同时更新后，将 `PRODUCT_EDITOR_MODES` 调整为：

```ts
export const PRODUCT_EDITOR_MODES = ["edit", "live", "preview"] as const;
```

`NoteWorkspace` 的 `live` 使用同一个 `Editor` 位置和 `live` Compartment；禁止恢复 `split` 分支。

**这一步只改「允许哪些档」，不改「打开笔记用哪一档」**：

- `PRODUCT_EDITOR_MODES` 扩成 `["edit","live","preview"]`；`DEFAULT_EDITOR_MODES` 跟着它走（它只是 `PRODUCT_EDITOR_MODES` 的别名，不另写一份字面量），于是 `editor_modes` 的默认值对新用户就是三档——这才是「新用户可默认即时渲染」要说的事。
- **「默认档」这个概念不存在**：打开笔记用哪一档仍由**本机记住的「上次用的那一档」**决定（`wiki/Menote-设计文档-v7.4.md` 内部版本 v7.5.2，第 26 行与 §7.1；实现是 `editor-mode.ts` 的 `readLastEditorMode()`）。本步骤**不改** `DEFAULT_USER_SETTINGS.editor_mode` 的语义（它仍是「首次初始值」，`packages/shared/src/settings.ts` 第 244 行的字段说明不变），已有用户本机记着 `edit` / `preview` 就继续用他记的那一档。
- 若有人把「默认 live」理解成「打开就是 live」，那是改错了地方——要动的是本机记忆的优先级或 `editor_mode` 初始值，属独立变更，必须先跟用户确认，不在 C3 内顺手做。
- 忘了改 `packages/shared/src/settings.ts` 的后果是具体的：归一化仍按两档过滤，`live` 传进来会被剔除，正文切换条不会出现「即时渲染」，Step 2 的用例红且看起来像 UI 问题。

- [ ] **Step 5: 运行全量验证与手动回归。**

运行：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @menote/web build
```

手动：长文、附件、普通笔记、损坏表格降级、单篇加密锁定、预览、Markdown 编辑、即时渲染各走一遍；确认即时渲染失败时可切回“仅编辑”。

- [ ] **Step 6: 提交代码与文档阶段。**

先提交代码：`feat(editor): 在正文启用即时渲染模式`。用户明确授权后，单独提交定稿回写：更新 `DESIGN.md`、相关 `wiki/`、`docs/modules/Menote-编辑拓展-设计-v3.md` 与 `CHANGELOG.md`；不混入代码提交。

## 6. 阶段 D：生产替换、文档定稿与最终验收

### Task D1：按低风险顺序推广已验证能力

**Files:** 由各前置任务实际改动决定；不得为了“统一”进行无关重构。

- [ ] **Step 1: 先替换功能栏快捷录入。**

前置：Task B6 的快捷输入基础能力、`/`、至少一个 `@` 属性路径、键盘发布均通过。人工检查 Memo / 待办 / 笔记三档、多实例切换、离线与发布 toast。

- [ ] **Step 2: 再替换 Memo / 待办添加窗口。**

前置：添加窗口复用 QuickComposer 的全部用例通过。人工检查打开自动聚焦、Esc、取消、Ctrl/Cmd+Enter、字段清空、发布后列表刷新。

**正文即时渲染的替换只描述一次**：条件与动作见 §5 Task C3（用户确认 + 全量验证 + `Markdown 编辑` 保留为可见回退入口）。本任务不再重复这一步，避免同一处改动出现两轮描述、出现「改两遍」的可能。

- [ ] **Step 3: 每替换一个入口立即提交并推送。**

提交范围只含该入口、相应测试和 `CHANGELOG.md`（该入口交付时版本号 +0.0.1，见 §0「版本策略」）；不要把等待中的 `wiki/` 回写或其它 UI 改动混进来。

### Task D2：完成用户验收与文档回写

**Files:**
- Modify: `docs/todo/Menote-编辑拓展-实施计划-v1.md`
- Modify: `docs/modules/Menote-编辑拓展-设计-v3.md`
- Modify: `CHANGELOG.md`
- Modify: `DESIGN.md`、`wiki/*`（仅明确授权后）

- [ ] **Step 1: 汇总验收记录。**

记录每个宿主的浏览器与设备、中文输入法、列表、撤销/重做、`@` / `/`、发布、长文切换、20 次循环的结果；将“未验证”与“未达到”分开写，不得把试验页结果描述成全部线上通过。

- [ ] **Step 2: 请用户确认最终产品模式和设置文案。**

特别确认：即时渲染是否默认打开、预览与锁定即时渲染是否合并为同一阅读态、Markdown 编辑入口在 UI 中的名称和位置。

（口径别搞混：「默认打开」指**新用户的 `editor_modes` 默认包含它**；「打开笔记看见哪一档」由本机记住的「上次用的那一档」决定，不是设置里的默认档——见 C3 Step 4 与 `wiki/Menote-设计文档-v7.4.md` v7.5.2。）

- [ ] **Step 3: 在明确授权后更新定稿文档。**

只有用户明确授权时，更新 `DESIGN.md` 的编辑模式、`wiki/Menote-设计文档-v7.4.md` 的产品能力（§7.1 / §13 / §17）、`wiki/Menote-功能拆解-v2.md` 的验收（M04-03 与设置分类表）和 `wiki/components.md` 的 `Editor` 组件契约。每份文档更新版本、日期、修改记录；与代码提交分开。回写完成后，把 §0「已知冲突」第 1 条在 `docs/todo/Menote-开发计划-v1.md` 登记的那一行状态改成「已回写」，冲突期才算结束。

- [ ] **Step 4: 将本计划标为已执行或部分完成。**

只有全部阶段都完成并经过用户验收时，更新状态为“已执行”，然后移入 `docs/archive/`。若正文即时渲染仍在试验，保留在 `docs/todo/` 并注明已完成阶段与下一阻塞条件。

## 7. 验收矩阵

| 场景 | 自动化验收 | 人工验收 | 通过条件 |
|---|---|---|---|
| 正文基础 | shared 模式归一化、编辑/预览切换、保存内容不回退 | 长文编辑后多次切换 | 仅编辑/预览；无双栏；内容一致 |
| 快捷即时渲染 | 多实例、失焦呈现、点击重编、组合输入、发布快捷键 | 中文、粘贴、列表连续回车 | 不串值、不丢字、不抢焦点 |
| `/` 命令 | 命令过滤、标准 Markdown 输出、菜单键盘操作 | 行首/空白触发、代码块内不触发 | 两处同名命令产出同义 Markdown |
| `@` 属性 | 仅快捷宿主、按类型过滤、选择更新正确草稿字段（`task → due / priority`） | **只验待办的截止日期与优先级**；Memo 标签、笔记目标文件夹本轮没有写入通道，不作为验收项 | 不写入 Markdown；正文不出现菜单。`@tags`、`@target-folder`、笔记快捷录入的 `@` 标为**未接入遗留**，登记在 `docs/todo/Menote-开发计划-v1.md` 的「遗留 → 后续」表 |
| 正文即时渲染 | 生命周期、readOnly（判定门见 C2 Step 1）、保存回调、模式回退 | 中文、撤销、代码块、长文、20 次循环 | 不丢内容，不持续变慢；可回退编辑 |
| 隔离性 | 试验页只写 `menote:editor-lab:v1` | 刷新、恢复样文 | 不进笔记库、同步、搜索、版本历史 |

## 8. 计划自检

- **v3 覆盖**：正文双栏移除（A1）；编辑+预览先交付（A1/A2）；快捷输入轻量即时渲染（B5/B6）；`/` 分级（B1-B3/B5）；`@` 仅快捷输入（B4-B6）；下划线排除（B1/B5）；正文即时渲染与只读验证（C1-C3）；隔离试验与逐步替换（B3、C、D）。表格暂缓，不属于本计划覆盖范围。
- **未做项控制**：不添加私有 Markdown 格式、HTML 下划线、用户 CSS、任意颜色、正文 `@`、表格 Markdown 命令、正文 `/图片` 与 `/附件` 命令；表格锁定未来另立设计。不做项与遗留的完整清单见 §9。
- **兼容性**：shared 继续读取旧四档值（`EditorModeSchema` / `EDITOR_MODES` 四值不动），但阶段 A 的默认值、UI 和新写入只产生 `edit` / `preview`；`normalizeEditorModes()` 是唯一的归一化入口；Markdown 编辑永久保留；生产即时渲染必须在试验结果和用户确认后才启用。
- **版本与里程碑**：本专项自 v0.6.0 起，每个可交付阶段 +0.0.1 并同步 `CHANGELOG.md`；M5 顺延，登记动作见 §0「与里程碑的关系」。
- **冲突登记**：生产两档与 `wiki/` 四档的冲突期是已知状态，回写须单独授权（§0「已知冲突」）。
- **风险门槛**：任何阶段的输入法、内容保存、撤销或循环稳定性不通过时，停止生产替换并留在试验页修复。

## 9. 范围外 / 不做

### 表格的编辑 / 锁定浏览（原「阶段 D：暂缓项目」，只登记不做）

表格的编辑 / 锁定浏览暂不纳入本计划。当前不修改：

- `apps/web/src/features/tables/**`；
- 表格组件的只读 prop、锁定入口或浏览态；
- 表格相关 schema、同步接口、迁移和领域状态；
- 表格相关测试与 `wiki/` 定稿。

以后启动表格锁定时，另建模块设计与实施计划，先确定锁定来源，再决定是否需要数据模型或接口变更；不得直接沿用本计划的笔记模式任务。

### 正文 `/` 的图片 / 附件插入（设计 v3 §3.2 列为正文能力，本轮不做）

- **不做 `/图片`、`/附件` 命令**；正文附件继续走**现有附件按钮**（`Editor` 的 `onFiles`，`NoteWorkspace.tsx` 第 473 行传入），不新增命令入口、不改上传与引用流程。
- 原因：它是异步内容动作（上传 → 占位 → 替换 → 失败处理），不是 `{ text, selection }` 的同步 Markdown 命令（见 B1 Step 3）。

### `@` 的遗留项（登记在案）

- 交付：**待办**的 `@due` / `@priority`。
- 未接入遗留：`@tags`（Memo 标签）、`@target-folder`（笔记目标文件夹）、整个笔记快捷录入的 `@` 属性——都没有可写通道（`publishMemo` 只接受 `{ asTask, due, priority }`；笔记目标只是 `ModeExtras` 的展示 chip）。
- 登记位置：`docs/todo/Menote-开发计划-v1.md` 的「遗留 → 后续」表（动作由执行者做；该文件不在本计划的改动范围内）。

### 其它明确不做

- 下划线、任意 CSS、任意颜色值、用户字体字号、私有第二文档格式。
- 正文首期的 `@` 属性菜单；搜索框、笔记标题、表格单元格的 `@` / `/`。
- 把表格改造成 Markdown 即时渲染编辑器。

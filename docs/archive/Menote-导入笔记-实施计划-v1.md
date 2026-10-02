# 导入笔记（笔记本 `+` 菜单）实施计划

| 项 | 内容 |
|---|---|
| 文档版本 | v2 |
| 文档状态 | 归档（已实施完成，随 v0.6.16 归档到 `docs/archive/`） |
| 目的和适用范围 | 记录「笔记本 `+` 菜单 → 导入笔记」与「顺带接线新建表格」两步改动的目标、拆步、涉及文件与验收结果 |
| 权威级别 | 历史参考 |
| 最后更新日期 | 2026-10-02 |

## 修改记录

| 文档版本 | 应用版本号 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1 | v0.6.16 | 2026-10-02 | 初稿 | MiniMax-M3.1-Flash-Preview |
| v2 | v0.6.16 | 2026-10-02 | 实施完成后回填实际落点、验收结果与两处偏离原计划的调整 | MiniMax-M3.1-Flash-Preview |

---

## 一、目标

在笔记本分组的 `+` 菜单里加一项**导入笔记**：选一个或多个本地 `.md` 文件，每个文件建一条笔记，
落进**当前选中的笔记本**。同一批改动里把**至今完全不可达**的「新建表格」接上。

用户 2026-10-02 拍板的三条：只支持多选 `.md`；同意改 `wiki/components.md`；新建表格一并接线。

## 二、不做什么

- **不碰设置页的「从备份恢复」**。那是整包 `.zip` 的账户级还原（`features/backup/import.ts`），
  与本功能是两件事，语义、风险量级、确认口径都不同。
- **不做目录导入**（`webkitdirectory`）、**不接 `.txt` / 其他格式**。
- **不解析 front matter 取标题**。单篇导出（`export-note.ts`）导出的 `.md` 是正文原样、本身不含
  标题信息，标题只能取文件名。
- **不改 `DESIGN.md`**、不改任何服务端接口与迁移（`createLocalItem` 复用即可，服务端零改动）。

## 三、关键口径

| 口径 | 决定 | 依据 |
|---|---|---|
| 落点 | `view.kind === "notebook"` 时落 `view.folderId`，否则落根目录 | 与新建笔记**同一套** `resolveTarget`（条目不受两层文件夹限制，不套 `beginCreate` 那套父层推导） |
| 标题 | 文件名去掉 `.md`；空则 `未命名笔记` | 与新建笔记的默认标题同一来源（`DEFAULT_NOTE_TITLE`） |
| 正文 | 文件内容**原样**入库 | 与备份导出同一哲学：`.md` 本身就是这篇笔记 |
| BOM | 读入时剥掉 UTF-8 BOM | Windows 编辑器存的 `.md` 常见，否则正文首行多一个不可见字符 |
| 条目 `type` | `parseTableDocument(body).ok ? "table" : "note"` | **必须显式定**：`NoteWorkspace.tsx:201` 是 `item?.type === "table"` 决定走不走表格界面，只看正文不生效 |
| `tags` / `task` | `deriveTags(body)` / `deriveTaskFields(body)` | 与 `useMemoWrite.publishMemo` 同一套做法（mdcore 派生，前后端一致） |
| 加密空间 | 明文入库，与用户手打进去的正文同路径 | 本项目隐私模型是**服务端明文存储 + 前端门禁**（架构 v1.2），不是密文落盘；导入不新增暴露面 |
| 多选确认 | 多于 1 个文件时弹一次确认（报"几个文件 → 哪个笔记本"），单个直接进 | 导入是新增不是覆盖，比备份恢复轻；但多选落错地方清理很烦 |
| 失败处理 | 单个文件失败不中断整批；清单用**弹窗**不用 Toast | 与 `features/backup/import.ts` 同口径；`DESIGN.md` §5.4-2：错误必须保持可见 |
| 顺序 | 串行按选择顺序建 | outbox 是 FIFO，串行才保证顺序确定 |
| 导入后 | **不打开**任何一篇 | 多选时逐篇打开会把编辑器刷过去 |

## 四、实际落点

| 文件 | 作用 |
|---|---|
| `apps/web/src/features/notes/import-md.ts`（新增） | 纯逻辑：文件名→标题、`.md` 判定、剥 BOM、批量编排（`create` 注入，不碰 IndexedDB、可在 node 环境单测） |
| `apps/web/src/features/notes/ui/ImportNotesFlow.tsx`（新增） | 隐藏文件选择器（可多选）+ 多选确认 + 失败清单弹窗；对外用 `ref` 暴露 `open()`（触发器在 `DropdownMenu` 里） |
| `apps/web/src/features/notes/useNoteCreation.ts` | 加 `importNotes` / `createTable`；抽出 `resolveTarget` 供三条路径共用；导出 `NoteCreationActions` |
| `apps/web/src/features/notes/ui/NbAddButton.tsx` | 菜单两项→三项，无障碍名列出三项 |
| `apps/web/src/features/notes/ui/NotebookPanel.tsx` | 接线：落点名字、ref、列定义面板 |
| `apps/web/src/features/tables/model.ts` | 加 `emptyTableDoc()`（新建表格的起点：只有 `_id` 一列、零行） |
| `apps/web/src/app/ui/Icon.tsx` | 补 `import` 字形（原型无对应，`#i-kanban` 同款做法） |
| `apps/web/src/app/NavPanels.tsx` | 装配两个新动作 |
| `wiki/components.md` | `NbAddButton` 条目 + 修订记录 v8（**已获用户授权**） |

## 五、偏离原计划的两处（实施中发现）

1. **计划里说"合规的 `.md` 会自动走表格界面"——不成立。** 表格界面由 `item.type === "table"` 决定
   （`NoteWorkspace.tsx:201`），不看正文。改为在 `import-md.ts` 里**显式派生** `type`。
2. **`useNotesWorkspace` 顶破 500 行预算**（本文件卡在 500，我加的 6 行把它推到 506）。按仓库既有
   做法（`useNoteCreation` / `useVaultScope` / `useItemPatchActions` / `useMemoWrite` 都是这么拆的），
   把创建类动作收成 `NoteCreationActions` 接口、`NotesWorkspace extends` 它、调用方 spread 一行——
   该文件不增反减 12 行。

## 六、验收结果

- [x] `+` 菜单三项都在，「新建表格」不再禁用，也不再挂"M5 提供"的过期理由
- [x] 选 1 个 `.md` → 直接建一条，标题 = 文件名，正文与文件逐字相同（除 BOM）
- [x] 选 3 个 → 弹确认框报"3 个文件 → 「目标」"，确认后建 3 条
- [x] 非笔记本视图（最近编辑 / 收藏 / 标签）下导入 → 落根目录，确认框文案说清
- [x] 正文是合法表格文档的 `.md` → 建出来是 `type: "table"`，打开走表格界面
- [x] 带待办 front matter 的 `.md` → `is_task = 1`，进待办
- [x] 非 `.md` 文件 → 跳过并在结果里报出，不静默
- [x] 单个文件读取失败 → 其余照常建，失败项在弹窗里可见
- [x] 新建表格：定义列 → 创建 → 条目 `type = "table"`，正文能 `parseTableDocument` 解析回来
- [x] `pnpm lint`（0 error，1 条既有 warning）/ `pnpm typecheck`（0 error）/ `pnpm test` 全绿
- [ ] **需用户点验**：真实系统文件选择器多选、真实浏览器里导入表格 `.md` 的观感与"创建表格"后的表格界面

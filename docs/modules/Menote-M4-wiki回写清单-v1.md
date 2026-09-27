# Menote M4 → wiki 回写清单 v1

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 文档状态 | 评审中（**待用户点头后才动 `wiki/`**） |
| 目的和适用范围 | M4 收口时要把成果回写到 `wiki/`（`components.md` / 功能拆解 / 项目架构）。本文件是**回写前的核对清单**：逐条比对"界面稿约定"与"代码实际"，标出差异与建议口径，供拍板后一次性回写 |
| 权威级别 | 临时规则（回写完成后本文件的结论并入 `wiki/`，本文件转历史参考） |
| 最后更新日期 | 2026-09-27 |

## 修改记录

| 文档版本 | 应用版本号 | 日期 | 修改摘要 | 修改模型ID |
|---|---|---|---|---|
| v1.0 | v0.4.25 | 2026-09-27 | 首版：11 个组件逐条核对、功能拆解 20 条回写项状态、`packages/shared` 与架构两处、3 处需要用户先定的口径 | deepseek-v4.1-flash |

---

## 一、`wiki/components.md` 要登记的 11 个组件（逐条核对）

口径说明：**✅ 一致** = 按稿实现；**🟡 命名/形状有差** = 职责一致、props 名或形态不同（建议按代码回写，理由写在备注）；**❌ 未独立成组件** = 职责已实现但**写在别的组件里**（建议按"未独立"回写，不硬凑一个空壳组件）。

| # | 界面稿约定 | 代码实际 | 判定 | 建议回写口径 |
|---|---|---|---|---|
| 1 | `TableToolbar`：`mode` / `onModeChange` / `galleryDisabled?` / `galleryDisabledReason?` / `onAddRow` / `filterOpen` / `onToggleFilter` / `filteredCount` / `totalCount` | `view: "table" \| "gallery"` / `onViewChange` / `galleryAvailable` / `onRequestImageColumn` / `onAddRow` / `showAddRow?` / `filterOpen` / `onToggleFilter` / `activeFilterCount` / `filteredCount` / `totalCount` | 🟡 | **按代码回写**：①`mode`→`view`（与表格模型里 `TableViewState.view` 同名，少一层翻译）；②`galleryDisabled`+原因 → 合成 `galleryAvailable` + `onRequestImageColumn`（不可用时点它去加图片列，**不是**只置灰——比原稿更"给出口"） |
| 2 | `TableColumnManager`：`open` / `mode` / `columns` / `rowIdVisible` / `onSubmit` / `onCancel` / `parseFailCount?` | `open` / `mode` / `doc: TableDoc` / `onConfirm` / `onCancel` | 🟡 | **按代码回写**：传的是整份 `doc`（面板要改的不只 columns，还有 `_id` 列显示与列顺序）；`onSubmit`→`onConfirm`；`parseFailCount` 由 `doc` 内部算（`unparsableCount`） |
| 3 | `FieldTypePicker`：`value` / `onChange` / `disabledTypes?` | **不存在独立组件**；十种类型在 `TableColumnManager` 里以 `TYPE_OPTIONS` + 原生 `radio` 实现 | ❌ | **按"未独立"回写**：类型选择是列面板的**内部一块**（第 4 块），拆出去反而要把 `TYPE_OPTIONS`、禁用规则、说明文案来回传。若将来别处也要选类型再抽 |
| 4 | `TableFilterBar`：`columns` / `rules` / `onRulesChange` / `onClear` / `sort` / `onSortChange` | `columns` / `filters` / `onChange` / `onClearAll` / `sort` | 🟡 | **按代码回写并采纳"合并 FilterBar/SortBar"的建议**（已合并）；`rules`→`filters`、`onClear`→`onClearAll`；**`onSortChange` 不在此组件**（排序从列头菜单进，筛选条只显示当前排序） |
| 5 | `CellEditor`：`column` / `value` / `onCommit` / `onCancel` | **不存在独立组件**；行内编辑在 `TableGrid` 里（`editing` / `onEditingChange` / `onCellChange`） | ❌ | **按"未独立"回写**：编辑态是**表格级状态**（同一时刻只有一个格子进入编辑），拆成组件就要把"谁是编辑中"提升成共享状态，得不偿失 |
| 6 | `ImageCell`：`filename` / `attachmentId?` / `onPick` / `onRemoveRef` | **不存在独立组件**；图片列在表格里按文件名渲染，图册卡片由 `GalleryView` 画 | ❌ | **按"未独立"回写**，并**明确记一条未做**：`onRemoveRef`（移除引用）在 M4 未提供入口（见收口复核 §五-10 与界面稿 §7.6 的待拍板第 9 条） |
| 7 | `RowDragHandle`：`onMove(delta)` / `label` | **不存在**；行移动是 `TableGrid` 的 `onMoveRow(rowId, offset)` + 行菜单（上移/下移/插入/删除） | ❌ | **按"未独立"回写**：拖动柄未做（M4-9 已登记退化），**但键盘/菜单等价入口已满足**（界面稿 §12-4 的底线） |
| 8 | `TableDowngradeNotice`：`tone` / `sealedVersionHint` / `onViewSource` | **不存在独立组件**；降级入口在 `TableEditor` 的「更多」菜单（`onRequestDegrade`），确认框由外层 `TableEditor` 的宿主负责 | ❌ | **按"未独立"回写**；并记一条差异：**"自动降级提示条"未做**（M4 只做了"解析失败时就地提示 + 手动降级入口"） |
| 9 | `VersionRestoreConfirm`：`version` / `currentTitle` / `onConfirm` / `onCancel` | **不存在独立组件**；恢复确认框在 `VersionHistoryPanel` 内部用 `Modal` + `restoreConfirmText(row)`（三段文案集中在 model 里） | ❌ | **按"未独立"回写**：文案是**纯函数**（`model.ts` 的 `restoreConfirmText`，另有单测钉住三段），比"组件里写死文案"更好测。若 M5 别处也要恢复确认再抽 |
| 10 | `TrashRow`：`item` / `locked` / `selected` / `onSelect` / `onRestore` / `onPurge` | **不存在独立组件**；`TrashPage` 接收 `rows: TrashRowModel[]` 与选择/操作回调，行在页面内渲染 | ❌ | **按"未独立"回写**：`TrashRowModel` 已把"行要显示什么"抽成模型（含剩余天数、锁定占位），组件层只剩排版 |
| 11 | `AttachmentOutboxRow`：`name` / `state` / `progress?` / `onRetry` | **不存在独立组件**；上传中/失败落在**既有状态栏** `DocStatusBar` 的 `attachments` 行（`label` / `tone` / `onRetry?`） | ❌ | **按"未独立"回写**，并采纳界面稿 §7.2 的硬要求：**不新增第二条状态栏**——所以它本来就该是状态栏的一块 |

**小结**：11 个里 **4 个按代码回写（🟡）**、**7 个按"未独立成组件"回写（❌）**。这不是"少做了 7 个"，而是**7 处的职责都落在既有组件里、且当时判断拆出去会引入共享状态或空壳**——建议在 `components.md` 里如实写"未独立"，而不是登记 7 个不存在的组件（**登记一份不存在的组件清单，比不登记更糟**）。

## 二、同批要回写的三处（界面稿 §十一-1 的"同时请回写三处"）

| # | 回写项 | 现状 | 建议 |
|---|---|---|---|
| 1 | `AttachmentUploader` 职责里"缩略图在 `media.worker`"→ **浏览器端生成** | 代码即浏览器端（`features/attachments/thumbnail.ts`，Canvas/OffscreenCanvas） | 按事实改；并在架构 §2.3.2 对照表里删掉 `workers/media.worker.ts` 的落点（设计 §3.3 已否决） |
| 2 | `ConfirmDialog` / `InfoHint` 标为 **M4 实做** | **两者都没有实做**：确认框一律用 `Modal` + danger `Button`；说明文字用可见的 `hint-line` | **建议不标"实做"**，改标"M4 未做，用既有件替代"（收口复核 §五 已登记）。要不要真做这两个公共件，请一并拍板 |
| 3 | `TableColumnManager` / `FieldTypePicker` / `CellEditor` / `ImageCell` 从"形状待原型补上后再定"改为按下表 props 定稿 | 前者的 props 已定稿（且与稿不同，见 §一-2）；后三者未独立 | 只对实际存在的那一个回写定稿，另三个标"未独立" |

## 三、功能拆解（`wiki/Menote-功能拆解-v2.md`）20 条回写项状态

| 编号 | 回写项 | 实现状态 | 依据 |
|---|---|---|---|
| M05-01 | 列面板是弹窗、默认一列「名称」、新建时不可关遮罩 | ✅ | `TableColumnManager` + `Modal dismissable` |
| M05-02 | 列头菜单三个入口；增删改走面板；拖拽调序要有等价入口 | 🟡 | 菜单与面板 ✅；**拖动柄未做**，等价入口（行/列箭头）✅ |
| M05-03 | 十种类型的界面承载控件逐个登记 | ✅ | `TYPE_OPTIONS` 十项（含每项一行说明） |
| M05-04 | `_id` 列固定行 + 只有显示开关；列头菜单对它禁用 | ✅ | `ROW_ID_COLUMN` + 列头菜单禁用 |
| M05-05 | 行操作与"拖动即清排序指示"的冲突规则 | 🟡 | 行操作 ✅；**拖动**未做，规则按"无拖动"简化（箭头移动不冲突） |
| M05-07 | 筛选排序条形态 + "筛选后 N / M 行" + 清除禁用说明 | ✅ | `TableFilterBar` + `TableToolbar` 的 `filteredCount/totalCount` |
| M05-08 | 图册无图片列的出口；点卡片走 `Drawer` 且侧栏可编辑；空态 | 🟡 | 出口 ✅（`onRequestImageColumn`）；**`Drawer` 用 `Modal` 替代**（组件不存在，已登记） |
| M05-10 | 自动降级提示条 + 主动降级确认框三段 | 🟡 | 主动降级 ✅；**自动降级提示条未做**（解析失败时就地提示 + 手动入口） |
| M05-新 | 加密表格锁定时整个表格区不渲染 | ✅ | `LockedDocPanel` |
| M11-03 | 版本列表的保留标记列 + "已保留 N 个"；diff 用 +/- 文字 + 颜色 | 🟡 | 保留标记 ✅、diff 前缀 ✅；**列表页脚"已保留 N 个"未做**（保留标记在行上可见） |
| M11-04 | 恢复确认框四段文案，其中"当前稿会先自动封存"必须可见 | ✅ | `restoreConfirmText` 三段（影响对象 / 先封存 / 可恢复性）+ 面板底部提示 |
| M11-05 | 「标记为保留」入口＝版本行菜单；可否取消待拍板 | ✅ | 行菜单双向；**可否取消仍在待拍板清单（§七-7）** |
| M11-新 | 加密未解密时版本入口整体不可用（置灰 + 原因） | ✅ | `onOpenVersions` + `versionsDisabledReason`，有单测 |
| M12-01 | 四处删除入口 + "已移入回收站 + 撤销"反馈 | ✅ | 列表行 / 编辑器更多 / 文件夹 / Memo + 可撤销面板提示 |
| M12-02 | 回收站四列 + 剩余天数（≤3 天变色 + 文字）+ 批量多选 + 空态三段 + 锁定占位 | ✅ | `trash/model.ts`（`URGENT_REMAINING_DAYS`）+ `TrashPage` |
| M12-新 | 文件夹删除确认框的实时计数 + 原路径保留说明 | ✅ | `NotebookPanel` + 单测（5 条内容 / 1 个子文件夹） |
| M10-01 | 非图片附件走链接 + 文件图标 + 大小；进度落既有状态栏 | ✅ | `markdown.ts` 注入 `.size-tag`；`DocStatusBar.attachments` |
| M10-新 | 删除附件引用入口取舍 + "移除引用≠删文件"语义 | ❌ | **M4 未做入口**（只留语义位）；待拍板第 9 条后与 M6 管理页一起做 |
| M18-02 | 「版本与回收站」分类行清单按 §5.1 补齐 | ✅ | `VersionsTrashPage` 六块 |
| —— | 版本 `reason` → 中文映射集中 `packages/shared` | ✅ | `VERSION_REASON_LABELS` + `versionReasonLabel()`（未知值中性化，**不回落英文**） |

**完成度**：✅ 11 条、🟡 7 条、❌ 1 条（M10-新，等拍板）。所有 🟡/❌ 都已在《M4 收口验收复核》的偏离或未验证清单里对应登记。

## 四、结论与回写顺序建议

1. **先拍板**（本次要你点的是《M4 收口验收复核》§七 的 9 条 + 首页统计口径 1 条）；
2. 再按本清单回写 `wiki/components.md`（11 条 + 三处）、`wiki/Menote-功能拆解-v2.md`（20 条）、
   `wiki/Menote-项目架构-v1.md`（§2.3.2 对照表删 `media.worker`、补附件与版本的落点）；
3. 回写后再出 **v0.5.0**，`CHANGELOG` 里注明"wiki 三文件已同步"。

**本文件不改 `wiki/`**：上面的"建议回写口径"要等你点头后才落到 `wiki/`。

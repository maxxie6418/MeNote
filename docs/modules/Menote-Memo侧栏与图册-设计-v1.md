# Menote Memo 屏：页内侧栏与瀑布流图册设计 v1

| 项 | 值 |
|---|---|
| 文档版本 | v1 |
| 文档状态 | 评审中（**待用户确认后开工**；用户 2026-09-28 已定"全做"，本文定结构与配置形状） |
| 目的和适用范围 | Memo 屏从「页头 + 时间轴」扩成「页头 + **页内二级侧栏** + 内容区」，内容区支持**时间轴 / 瀑布流图册**两种视图。本文定：侧栏的**可插拔模块结构**、六个模块各自的取数与交互、图册的取数与布局、用户自定义配置的**契约形状与本轮边界**，以及取值来源（令牌 / 断点）的取舍 |
| 权威级别 | 模块规则（实施后并入 `DESIGN.md` 的对应小节；`DESIGN.md` 的修改需用户点头） |
| 最后更新日期 | 2026-09-28 |

原型：`deliverables/pages-redesign-2026-09-27/index.html`（行号即该文件行号）；逐项证据见 `docs/todo/Menote-原型差异与设置页-待办-v1.md` §二。

## 一、目标形态

```
.page--memo
 ├─ .memo-head        标题 · 说明 ⓘ · 计数 · 视图切换（时间轴 / 瀑布流）· 添加 Memo
 └─ .page-body（行向 flex）
     ├─ aside.subbar        ← 页内二级侧栏：**模块化的可插拔列表**（本轮六块）
     └─ .page__scroll       ← 唯一滚动容器
         ├─ 时间轴（现有 MemoTimeline）
         └─ 瀑布流图册（新 MemoFlow）
```

与原型的差异：原型的视图切换在页头**最右**、筛选条在侧栏里——照搬。原型的 `.memo-head` 之后直接是 `.page-body`，我们**删掉**现在页头下那条 `.memopanel__filters`。

## 二、侧栏做成"可插拔模块"（用户明确要求）

用户口径：**将来要能用户自己配置——调位置、隐藏；添加新模块只做代码级扩展，不做用户级新增/删除**（"复杂了就只做隐藏显示和位置调整，不做删除添加新的"）。据此定三层：

### 2.1 模块清单（唯一真源）

```ts
export const MEMO_SIDEBAR_MODULES = ["stats", "heatmap", "random", "onThisDay", "date", "tags"] as const;
export type MemoSidebarModuleId = (typeof MEMO_SIDEBAR_MODULES)[number];
```

与 `QUICK_MENU_FEATURES` / `TASK_FILTER_FORMS` 同一个做法：**清单只写一份**，`v.picklist`（契约）与渲染层都从它推导——漏写一处会编译不过。

### 2.2 注册表（模块自己声明，面板不认识具体模块）

```ts
// features/memos/sidebar/registry.ts
export interface MemoSidebarContext {
  memos: readonly LocalMemo[];        // 已过隐私门禁
  now: number;
  timeZone: string;
  filter: MemoFilter;
  onFilterChange: (next: MemoFilter) => void;
  onLocate: (itemId: string) => void; // 定位并高亮一条（随机漫步 / 那年今日用）
}
export interface MemoSidebarModule {
  id: MemoSidebarModuleId;
  title: string;
  /** 该模块当前有没有内容可显示（空则不渲染；例如没有任何带图 Memo 时图册入口不出现） */
  visible?: (ctx: MemoSidebarContext) => boolean;
  render: (ctx: MemoSidebarContext) => ReactNode;
}
export const MEMO_SIDEBAR: RecordMemoSidebarModule; // id → module
```

`MemoPanel` 只做三件事：**按顺序取模块 → 过滤隐藏项 → 逐个渲染**；它不认识"热力图"这三个字。将来加一块只要在注册表里加一项并补进 `MEMO_SIDEBAR_MODULES`。

### 2.3 用户配置（契约 + 本轮边界）

```ts
// packages/shared/src/settings.ts（新增字段，optional + 默认值，与 task_view 同一做法）
export interface MemoSidebarSettings {
  /** 顺序：只写想调整的那几个；没出现的模块按清单默认顺序补在后面 */
  order?: MemoSidebarModuleId[];
  /** 隐藏：出现在这里的模块不渲染 */
  hidden?: MemoSidebarModuleId[];
}
```

三条**可演进纪律**（这是"只隐藏/排序、不增删"能长期成立的关键）：
1. **未知 id 原样保留**：解析设置时把不认识的 id 留在数组里，不静默丢弃——否则旧客户端保存一次就会把新模块的配置抹掉；
2. **只在用户改动时写**：默认（没配置）走清单顺序，不做"把默认值也写进契约"；
3. **渲染层容错**：`hidden` 里有未知 id、`order` 里有已下线的 id 都不报错、忽略即可。

**本轮边界**：**落地注册表 + 顺序/隐藏的渲染支持 + 契约字段**（默认值与清单一致，所以界面观感不变）；**设置页的配置控件留到设置页重构那一批**（避免两处同时动设置契约与设置页）。这样下一轮只需加 UI，不动渲染层。

## 三、六个模块（结构与取数）

| id | 标题 | 内容 | 取数 | 交互 |
|---|---|---|---|---|
| `stats` | 概述 | `.stat3`：总条数 / 本月新增 / 记录天数（原型 L1121-1128） | `memo_at` 本地算（复用 `dayKeyInZone`） | 无 |
| `heatmap` | 热力图 | 近 12 周 × 7 天，5 档 + 「近 12 周 · 共 N 条」+ 图例（L1131-1149） | 同上；分档按当天条数（0/1/2-3/4-5/6+，具体阈值照原型 5 档） | 悬停给当天条数（`title`），不靠颜色单独表意 |
| `random` | 随机漫步 | 单按钮（L1152-1158） | 无 | 从**当前筛选后**的 Memo 里随机挑一条 → `onLocate` |
| `onThisDay` | 那年今日 | 历史上「月-日」离今天最近的一天 + 条数 + 摘要（L1161-1170） | `memo_at` 本地算；两个口径按原型（L2049-2051）：**排除今年**、前后等距时**取更早** | 点 → 切回时间轴并 `onLocate` 到那一条（高亮 2s，原型 `.is-walked`） |
| `date` | 日期 | 全部 / 今天 / 本周 / 本月（L1172-1180） | 现有 `MemoRange`；口径按原型改成"本周（本周一至今）/ 本月（本月 1 日至今）"，与现有"近 7 / 近 30 天"**不一致——见 §六 待确认** | 改 `filter.range` |
| `tags` | 标签 | 纵向列表：全部 + `# 标签` + 计数，选中主色浅底 + 左侧 2.5px 主色刻线（L317-326） | 现有 `collectMemoTags`（已带计数） | 改 `filter.tag` |

**纯函数**（新增到 `features/memos/model.ts`，便于单测）：`summarizeMemos(memos, now, tz)`、`heatmap12w(memos, now, tz)`、`onThisDay(memos, now, tz)`、`pickRandom(memos, seed?)`。

## 四、瀑布流图册（新 `MemoFlow`）

- **布局**：CSS 多列（原型 `.flow{column-count:4;column-gap:var(--sp-3)}`，断点 1240/980/700 → 3/2/1）；卡片 `.wf`：`break-inside:avoid`、1px 描边、`--radius-lg`、悬停细边框 + `shadow-1`；图片按宽高比四档（`2/3`、`4/5`、`1/1`、`16/10`）；信息条贴底（日期 + 摘要两行截断），**默认下沉、悬停/聚焦滑入，`@media (hover:none)` 常驻**。
- **取数**：图片引用从正文抽（现有 `extractAttachmentRefs`）+ 附件元数据（`LocalAttachment{mime,width,height,has_thumb}`）。
  - 新增 `listImageAttachments()`：**一次 `attachmentsMeta.toArray()` + 内存过滤 `mime.startsWith("image/")`**，返回 `Map<itemId, {sha, width, height}[]>`。**本轮不加 Dexie 索引、不升 db 版本**（附件量级不大；真要加索引再单独一步）。
  - 宽高缺失时取哪一档：**默认 `1/1`**（原型是硬编码类名，我们按数据算，缺数据给最稳的方档）。
- **空态**：没有带图 Memo 时给「还没有带图的 Memo」+「切到录入框」出口（原型 L1528-1533）。
- **图片地址**：`attachmentUrl(sha, { thumb: true })`（R2 同源、带会话 Cookie，无需额外鉴权处理）；`loading="lazy"`。
- **与时间轴的关系**：瀑布流只**展示**，编辑仍在时间轴（点卡片 → 切回时间轴并 `onLocate`）——本轮不做卡内编辑。

## 五、定位与高亮（`onLocate`）

`随机漫步` / `那年今日` / 图册点卡片都要"跳到那一条"。做法：
1. 若当前是瀑布流 → 先切回时间轴；
2. 目标天若不在当前筛选范围内 → 松开筛选（`range = all`、`tag = null`）后再定位；
3. `document.querySelector('[data-memo-id="…"]')?.scrollIntoView({block:"center"})` + 加 `.is-walked` 高亮类，2s 后移除。
   **`data-memo-id` 已经在 `MemoItem` 上**（既有属性，可直接用）。

## 六、取值来源（**需要你拍板的一条**）

原型自己把三个值标成【临时值·待确认】，且与 `DESIGN.md` 对不上：

| 值 | 原型 | DESIGN.md | 建议 |
|---|---|---|---|
| 侧栏宽 `--subbar-w` | 232px | 结构尺寸表没有这一档 | **新增令牌 `--subbar-w: 232px`**，并在 `DESIGN.md` §2.2 结构尺寸表加一行（属"改 DESIGN"，需你点头） |
| 视图切换宽 `--viewseg-w` | 176px | 无 | 不加令牌，写成该组件内的局部值（比照待办 `--task-cap` 的先例） |
| 概览数字 `--fs-stat` | 30px | 字号只有 6 档（20/17/14/13/12/11） | **用 `--fs-display`（20px）**，不新增字号档——30px 会打破"6 档刻度"这条定稿 |
| 瀑布流基准列数 / 内容上限 | 4 列 / 840px | §2.4 断点表写"≤1240px 瀑布流 3→2 列"；§2.3 上限只有 740/790/920 | **照 DESIGN**：3 列基线、≤1240 → 2 列、≤700 → 1 列；内容上限用 **920px**（与待办一致），不新增 840 |

**若你要完全照原型**（232/176/30/4 列/840），我就同步改 `DESIGN.md`（§2.2 加一行、§2.3 加 840、§2.4 断点表改成 4→3→2→1、§3.3 加 `--fs-stat`）——**这四处都属改视觉源，需要你明确同意**。

## 七、实施步（确认后开工）

| 步 | 内容 | 落点 |
|---|---|---|
| 1 | 模块清单 + 注册表 + 面板改"按注册表渲染"（**行为与观感暂时不变**） | `features/memos/sidebar/`、`MemoPanel.tsx` |
| 2 | 契约加 `memo_view.sidebar`（optional + 默认值）+ 顺序/隐藏解析（含"未知 id 保留"） | `packages/shared/src/settings.ts` |
| 3 | 三个纯函数（概述 / 热力图 / 那年今日）+ 单测 | `features/memos/model.ts`、`test/memos-model.test.ts` |
| 4 | 六块 UI + 页头视图切换 + 删旧筛选带 + 令牌与断点 | `features/memos/sidebar/*`、`MemoPanel.tsx`、`app.css`、`tokens.css` |
| 5 | 图册：取数口子 + `MemoFlow` + 空态 | `data/db/attachments.ts`、`features/memos/ui/MemoFlow.tsx` |
| 6 | `onLocate`（切视图 / 松筛选 / 滚动 + 高亮） | `MemoPanel.tsx`、`MemoTimeline.tsx` |
| 7 | 图标 `list` / `grid` / `image` / `bolt`（含"字形↔联合类型"守卫） | `app/ui/Icon.tsx` |
| 8 | 窄屏照原型 `@media (max-width:1080px)`（侧栏转横排等，L380-406） | `app.css` |

验收：六块逐块与原型对值；视图切换与图册可用；随机/那年今日能定位并高亮；隐藏/顺序配置改契约值后立即生效（GUI 下一批）；窄屏不破；`layout-invariants` / `css-cascade` / `style-coverage` / `focus-visibility` 全绿。

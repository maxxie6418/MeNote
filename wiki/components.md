# Menote 组件规划（components）

| 项 | 内容 |
|---|---|
| 文档性质 | 前端组件规划：**组件名、所属 feature / 落点、职责、props 约定、复用关系**，以及与界面原型的对应。是架构文档 §2.3.2「功能 → 代码落点对照表」在**组件层**的展开 |
| 基准 | 需求文档 `wiki/Menote-设计文档-v7.4.md`（下称“需求文档”）；功能点编号与验收看 `wiki/Menote-功能拆解-v2.md`（下称“功能拆解”）；落点、分层与依赖方向看 `wiki/Menote-项目架构-v1.md`（下称“架构”）§2.3、§3.1；视觉与令牌看根目录 `DESIGN.md`（下称“视觉源”） |
| 主要来源 | 界面原型 `prototype/menote-prototype.html`（高保真）与 `prototype/menote-framework.html`（线框评审页）。引用原型**只写元素名或选择器**（如 `#topAccount`、`.composer`、`.nav-seg`），不写行号——行号随原型改动会失效 |
| 版本 | v1（文件名 `components.md` 不变，版本在修订记录内演进） |
| 日期 | 2026-09-26 |
| 状态 | 首稿。**代码尚未初始化**：组件名与 props 均为**约定名**，实现时如无充分理由不要改名；若实现中发现更合适的拆法，先回报本文再改 |
| 不包含 | 颜色 / 字号 / 间距 / 圆角 / 阴影的具体数值（归 `DESIGN.md`，本文只写“走令牌”，不复制令牌值）；接口、表结构、同步算法（归架构文档）；功能规则与验收口径（归需求文档与功能拆解） |

### 标注约定

| 标注 | 含义 |
|---|---|
| 【已落地】 | 原型中已存在、结构与状态可见的组件，可直接对照原型开工 |
| 【预留】 | 界面已规划但原型尚未实现；只约定职责与大致拆法，形状待原型补上后再定（第十二章统一列出） |
| 【待定】 | 形态未定或形态开放，实现前需用户确认 |
| `Mxx-yy` | 功能点编号，出自功能拆解；组件与功能点的完整对应见第十章 |
| `§x.y` | 需求文档小节号；`架构 §x.y` 指架构文档 |

### 修订记录

| 版本 | 日期 | 内容 |
|---|---|---|
| v1 | 2026-09-26 | 首稿。以原型已落地的组件为主体（第四至九章），附通用控件库与映射矩阵，并单列预留组件（第十二章） |

---

## 一、这份文档管什么

**一句话**：本文回答「前端有哪些组件、各自归谁、负责什么、对外契约是什么、能怎么复用」。它不回答「长什么样」（那是 `DESIGN.md`），也不回答「功能对不对」（那是需求文档与功能拆解）。

三份文档的边界：

| 问题 | 看哪里 |
|---|---|
| 这个功能该不该有、规则是什么 | 需求文档 `wiki/Menote-设计文档-v7.4.md` + 功能拆解 `wiki/Menote-功能拆解-v2.md` |
| 界面长什么样（颜色、字号、间距、圆角、组件用法、禁止项） | `DESIGN.md`（唯一视觉源）+ 原型 |
| 有哪些组件、放哪个目录、props 怎么定、能怎么复用 | **本文** |
| 数据存哪、接口怎么调、同步怎么走 | 架构文档 |

冲突时的优先级（与架构 §2.3.4 一致）：功能与规则看需求文档，长什么样看 `DESIGN.md` 与原型，某一屏的结构看 `docs/modules/`，**组件的落点与契约看本文**。本文与架构 §2.3.2 冲突时以架构为准并回报本文。

**本文的更新时机**：原型新增 / 删除区块、组件改名、新增可复用控件、落点从 `app/` 与 `features/*` 之间迁移时，本文与 `DESIGN.md` 同步更新。纯样式微调（改颜色、改间距）不进本文。

---

## 二、读法与命名约定

### 2.1 组件命名

- 组件名用 **PascalCase**，语义取自**功能拆解里的功能点用词**，不自造近义词。例：功能拆解说「快速录入框」，组件就叫 `Composer`，不叫 `QuickInput`。
- 原型里的 class / id 是**样式与原型标识**，不做组件名（`.nav-seg` 对应的组件叫 `NavSegmented`，不叫 `NavSeg`，避免和 CSS 类撞概念）。
- 一个组件对应原型里一处**稳定的界面元素**；原型中重复出现 3 次以上的同类结构，抽成通用控件进第八章。

### 2.2 落点规则

| 落点 | 放什么 | 判定标准 |
|---|---|---|
| `apps/web/src/app/` | 布局骨架、顶栏、功能栏、导航、主题、**跨 feature 的公共组件**（`app/ui/`） | 被 2 个以上 feature 使用，或属于「应用外壳」 |
| `apps/web/src/features/<x>/ui/` | 该 feature 私有组件 | 只服务本 feature |
| `apps/web/src/features/<x>/model.ts` | 该 feature 的状态与动作 | 与 `ui/` 两件套，见架构 §2.3.2 |
| `apps/web/src/data/` | Dexie 模式、仓储、outbox、同步引擎 | **不是组件**，但组件的数据来源全在这里 |
| `apps/web/src/crypto/` | 隐私门禁与备份导出加密 | 同上，不是组件 |

**硬规则**（架构 §2.3.2 / §2.3.3）：feature 之间**禁止互相 import**；跨 feature 复用只能走 `app/ui/` 或 `data/`。组件层不得直接访问 Dexie 或网络，必须经应用服务层（架构 §3.1）。

### 2.3 props 约定通则

1. **状态归属**：数据的唯一真相是本地 IndexedDB（Dexie `liveQuery` 订阅）；`Zustand` 只放**纯界面状态**（当前视图、面板开合、选中项），不放业务数据（架构 §3.1）。
2. **受控优先**：输入类一律受控（`value` + `onChange`），不接受非受控 `defaultValue`，避免自动保存与同步状态判断失真。
3. **事件命名**：`on<动作>`（`onPublish`、`onUnlock`、`onPickMode`），动作名用功能点的动词，不用 `onClick` 这类泛名。
4. **不做隐式请求**：组件不自己发请求、不自己开解锁框；需要副作用时由 `model.ts` 的动作函数完成，组件只发意图。
5. **枚举不用裸字符串**：模式类取值（`composerMode`、`tableMode`、`memoView`、`taskView`、`editorMode`、`theme`）统一走 `packages/shared` 的常量与 Valibot schema，组件内不写字面量。

### 2.4 组件状态三分

原型用一个内存 `state` 对象承载全部状态。实现时必须拆成三类，**不要照搬一个 store**：

| 类别 | 例子 | 归属 |
|---|---|---|
| 数据真相 | 条目、文件夹、Memo、待办、版本、回收站 | Dexie + `liveQuery` |
| 纯界面状态 | `fn`（当前视图）、`folder`、`tag`、`activeId`、`setPage`、`memoView`、`taskView`、`tableMode`、`editorMode`、`drawerId` | Zustand |
| 全局门禁状态 | `locked`、`timeoutMin`、`privacyBrowse`、`remaining` | `features/privacy/` + `crypto/keystore.ts`；**全局唯一一份**（需求 M06-08 / Q5） |
| 持久化偏好 | `theme`、`startView`、`quickMenu` | 设置项，落本地库后同步（§7.5） |

---

## 三、组件地图（总览）

```
AppShell                                    app/
├─ Topbar                                   app/topbar/            —— 6 块，死约束，见第五章
│  ├─ BrandLogo / Breadcrumb                app/topbar/
│  ├─ SearchBox                             app/topbar/            → features/search/ 提供结果面板
│  ├─ SyncPill                              app/topbar/
│  ├─ PrivacyCapsule                        app/topbar/            → features/privacy/ 提供档位菜单
│  └─ AccountEntry → AccountQuickMenu       app/topbar/            —— 第 6 块，点击弹菜单
├─ FnBar                                    app/fnbar/             —— 见第六章
│  ├─ NewNoteButton
│  ├─ Composer (+ ModeTabs / Extras / PublishButton)
│  ├─ NavSegmented                          —— 浏览三段
│  ├─ NavList (NavItem ×2)
│  ├─ NotebookGroup (+ FolderTree / NbAddButton)
│  ├─ TagGroup (TagChip ×n)
│  └─ VaultNode                             —— 贴底固定
└─ WorkArea                                 app/
   ├─ ListPane  → ItemRow ×n                features/<x>/ui/
   ├─ DocPane   → DocHead / DocBody / DocStatusBar
   └─ Drawer                                app/ui/                —— 能力保留，不由列表触发

视图（进 DocPane / ListPane）
├─ HomePanel          features/home/
├─ MemoPanel          features/memos/       —— 时间轴 / 瀑布流
├─ TaskPanel          features/tasks/       —— 列表 / 看板
├─ TablePanel         features/tables/      —— 表格 / 图册
├─ SearchPanel        features/search/
├─ VaultPanel         features/privacy/     —— 锁定 / 解锁两态
├─ TrashPanel         features/settings/    —— 设置子页面
└─ SettingsPanel      features/settings/    —— 两栏分页，10 分类
```

---

## 四、布局骨架层 `app/` 【已落地】

| 组件 | 落点 | 原型 | 职责 | 关键 props |
|---|---|---|---|---|
| `AppShell` | `app/AppShell.tsx` | `.shell` / `.body-row` | 全宽顶栏 + 左右两栏的骨架；高度 100vh、不整页滚动 | `children` |
| `Topbar` | `app/topbar/Topbar.tsx` | `.topbar` | 顶栏容器，**固定 6 块**，左右顺序不可调 | `crumbs`、`syncState`、`lockState`、`account` |
| `WorkArea` | `app/WorkArea.tsx` | `.work` | 主操作区容器，承载列表 / 正文 / 侧滑三层 | `view`、`list`、`doc`、`drawer` |
| `ListPane` | `app/ListPane.tsx` | `.pane-list` | 左列（宽走 `--list-w`）；`wide` 变体占满（搜索结果用）、`hidden` 变体整块隐藏 | `width?: 'default' \| 'wide'`、`hidden?` |
| `DocPane` | `app/DocPane.tsx` | `.pane-doc` | 右列容器；`center` 变体用于空 / 锁定占位的居中布局 | `center?`、`children` |
| `PaneHead` | `app/ui/PaneHead.tsx` | `.pane-head` | 视图头：`h1` + `sub` + 右侧 `actions`。**说明性文案收进 `InfoHint`（ⓘ）**，见 `DESIGN.md` | `title`、`subtitle`、`actions` |
| `PanePad` | `app/ui/PanePad.tsx` | `.pane-pad` | 内容区统一内边距容器 | `children` |

**不变量（改动前必读）**：

- 顶栏 6 块是**死约束**，原型验证脚本对此有断言。顺序：品牌 · 面包屑 · 搜索框 · 同步胶囊 · 隐私锁胶囊 · 账户与设置。
- 层级关系：`AppShell` → (`Topbar` + `WorkArea`)；`WorkArea` → (`ListPane` + `DocPane` + `Drawer`)。`Drawer` 是 `WorkArea` 的绝对定位子层，不是 `DocPane` 的子层。

---

## 五、顶栏 `app/topbar/` 【已落地】

顶栏 6 块，从左到右不可增减、不可重排。

### 5.1 `BrandLogo`
| 项 | 内容 |
|---|---|
| 原型 | `.brand` / `.logo` |
| 职责 | 品牌标记（方块 logo + 文字），纯展示不可点 |
| 约束 | logo 底色是**渐变**（`linear-gradient`），其中的颜色**不会**被 `DESIGN.md` 的禁蓝正则扫到，换主题时要手工核对 |

### 5.2 `Breadcrumb`
| 项 | 内容 |
|---|---|
| 原型 | `.crumb`（`#crumb`） |
| 职责 | 当前视图路径。`笔记本 / <文件夹名>` 时文件夹名加粗；标签视图显示 `# 标签名`；搜索时显示「搜索结果」 |
| props | `parts: Array<{ text: string; bold?: boolean }>` |
| 复用 | 由 `app/` 的视图路由层统一计算，不在各视图内自己拼 |

### 5.3 `SearchBox`
| 项 | 内容 |
|---|---|
| 原型 | `.search-wrap`（`#searchInput`，内含 `kbd` 提示） |
| 职责 | 顶栏搜索输入；聚焦即进搜索视图，清空则**回到进入搜索前的视图**（原型 `searchedFrom`） |
| props | `value`、`onChange`、`onFocus`、`placeholder` |
| 快捷键 | Ctrl+K / Cmd+K（macOS）。快捷键在 `app/` 层全局注册，**不在 `SearchBox` 内**——原型放在 document 级 `keydown` |
| 落点提示 | 组件在 `app/topbar/`，但结果面板 `SearchPanel` 在 `features/search/` |

### 5.4 `SyncPill`（同步状态胶囊）
| 项 | 内容 |
|---|---|
| 原型 | `.pill`（`#syncPill` / `#syncText`），变体 `.pill.ok` / `.pill.busy` |
| 职责 | 顶栏级同步状态：`已同步` / `上传中 N` / 离线提示 |
| props | `state: 'ok' \| 'busy' \| 'err'`、`queueLength?: number` |
| 需求 | M02-06（§1.4、§15.3）。队列为空时不显示计数 |
| 数据来源 | `data/sync/` 的 outbox 长度（架构 §6.3） |

### 5.5 `PrivacyCapsule`（全局隐私状态胶囊）
| 项 | 内容 |
|---|---|
| 原型 | `.capsule`（`#lockCapsule` / `#lockTimer`），变体 `.locked` / `.unlocked` / `.danger` / `.blink` |
| 职责 | 全局唯一的锁状态显示。点已锁定时直接开解锁框；点已解锁时弹**解锁档位菜单**（`tierMenuHtml`） |
| props | `locked`、`timeoutMin`、`remaining`、`onUnlock`、`onPickTier`、`onLockNow` |
| 状态映射 | `locked` → `已锁定`（灰）；`timeoutMin === -2` → `本设备始终解锁`（**红，danger**，属降低安全性的状态）；其余 → `已解锁` + 倒计时；`仅本次查看` / `本次会话` 用文字替代倒计时 |
| 需求 | M02-05、M08-12（§6.9）。未启用隐私锁时**整个胶囊不显示** |
| 关联 | 剩余 30 秒时加 `.blink` 并提示即将自动锁定（原型 `startTimer`） |

### 5.6 `AccountEntry` + `AccountQuickMenu`
| 项 | 内容 |
|---|---|
| 原型 | `#topAccount`（圆形头像）→ 复用 `.menu` 组件；菜单内容由 `quickMenuHtml()` 按 `quickMenu` 生成 |
| 职责 | 全站**唯一账户入口**，紧邻隐私胶囊右侧；**只显示头像、不显示用户名**（顶栏是紧凑条），`title` 里给提示 |
| **交互（易错点）** | 点击头像**弹出快捷菜单**，**不直达设置页**。菜单里「设置」是一项。此前一度定为“点击直接进设置、不弹菜单”，该写法**已作废**（功能拆解 M02-01 / M18-03） |
| 菜单结构（自上而下，固定） | 账户头（头像 + `owner` + 实例）→ 分隔线 → **可配置功能项**（按 `quickMenu` 顺序）→ 分隔线 → `设置` / `退出登录`（固定底部，不在配置清单内） |
| 可配置功能项 | 5 项候选：`主题切换`（菜单内一排三档，**切完不收起菜单**）/ `立即锁定`（带状态：`解锁中` \| `已锁定`）/ `搜索` / `回收站` / `立即备份`。默认只开前两项 |
| props（Entry） | `user`、`onOpenMenu` |
| props（Menu） | `items: string[]`（`quickMenu`）、`theme`、`locked`、`onPick(id)`、`onThemeChange(theme)` |
| 需求 | M02-01、M18-03；配置入口在 设置 › 通用 › 快捷菜单 |
| 【待定】 | Q26：菜单里要不要放「新建」类动作 |
| 验证提示 | 断言账户入口必须**走菜单**：先点头像，再点菜单里的 `[data-qm="settings"]`；直接点 `#topAccount` 只是开/收菜单 |

---

## 六、功能栏 `app/fnbar/` 【已落地】

由上到下：**新建按钮 → 快速录入框 → 导航区（可滚动）→ 加密空间（贴底不滚动）**（M02-02）。

### 6.1 `NewNoteButton`
| 项 | 内容 |
|---|---|
| 原型 | `.btn-new`（`#btnNew`） |
| 职责 | **一次点击**直达新建笔记并打开编辑器，**不弹类型菜单** |
| 落点 | 新笔记放**根目录**（即使当前正在某个文件夹中），默认标题「未命名笔记」，标题可在编辑器顶部标题栏直接改 |
| props | `onCreate()` |
| 需求 | M04-01（§7.4；落点为【暂定·用户确认 2026-09-26】Q24 部分） |
| 禁止 | 不提供加密选项（M04-02） |

### 6.2 `Composer` · 快速录入框
| 项 | 内容 |
|---|---|
| 原型 | `.composer`（`#composerInput` / `#composerExtra` / `#composerModes` / `#composerPublish`） |
| 职责 | 添加内容的**主入口**，三行结构，见下 |
| props | `mode`、`onModeChange`、`value`、`onChange`、`onPublish`、`taskMeta`、`onTaskMetaChange` |
| 复用 | Memo 视图与待办视图的「添加」按钮**不另做输入框**，而是把本组件的 `mode` 切到对应档并聚焦（原型 `addViaComposer`）。因此本组件必须支持**外部驱动 mode** |
| 需求 | M06-01、M07-01、M04-01（§7.4、§8.7） |

三行结构（**顺序固定**）：

| 行 | 组件 | 原型 | 说明 |
|---|---|---|---|
| ① 输入区 | `ComposerInput` | `.composer textarea` | 多行，`min-height` 40px、`max-height` 180px |
| ② 模式附加项 | `ComposerExtras` | `.composer-extra`（内含 `.sw`） | 在模式行**之上**；**高 26px 固定、`nowrap`**；三档内容见下 |
| ③ 模式行 | `ComposerModeRow` = `ComposerModeTabs` + `PublishButton` | `.mode-row` > `.mode-tabs` + `#composerPublish` | 左模式切换、右发布按钮，**同一行**；原独立发布行 `.composer-foot` 已取消 |

三档的附加项内容：

| 模式 | 附加项（`.sw` 胶囊） | 发布按钮 `title` |
|---|---|---|
| `memo`（默认） | **空容器占位，不隐藏** | `Ctrl+Enter 发布到时间轴` |
| `task` | `截止 <日期>`（可切）+ 优先级 `高` / `中` / `低` | `Ctrl+Enter 发布为清单条目` |
| `note` | `首行作标题` + `根目录`（**无「加密」胶囊**，M04-02） | `Ctrl+Enter 新建并打开编辑器` |

**不变量（改动必查，原型验证脚本有断言）**：

1. `Composer` 总高 **136px**、`.nav` 顶部 **y = 252** 不变。切换模式**只换内容不换高度**，绝不推挤下方导航。附加项容器用「固定高度 + 不换行（超出横向滚动）」实现，**不得**用 `hidden` 让容器塌陷。
2. `ComposerModeTabs` 是**盒式分段控件**（外框 + 灰实底选中），与下方 `NavSegmented`（下划线页签）**必须保持明显区分**——两者上下相邻，改任一方都要重新确认这个区分还在。详见 6.3。
3. 发布按钮是 `type="button"`；Ctrl+Enter / Cmd+Enter 发布，快捷键提示写在按钮 `title` 上，**不占单独一行**。

### 6.3 `NavSegmented` · 浏览三段
| 项 | 内容 |
|---|---|
| 原型 | `.nav-seg`（`#navSeg`）> `.seg-item` ×3（`#navHome`、`data-fn="memo"`、`data-fn="task"`） |
| 职责 | 首页 / Memo / 待办三项视图跳转，合成一行 |
| 造型 | **下划线页签**：无外框、无底色；选中态 = 主色文字 + `::after` 主色下划线 |
| props | `items: Array<{ key, label, icon }>`、`activeKey`、`onSelect` |
| 需求 | M02-02（Q1 已确认）。三项**保留原名**、**不显示条目计数**（纵向占用从约 104px 降到 30px） |
| 显隐 | `首页` 项受启动视图控制：未选首页时该项**不显示**，其余两项弹性等分（原型 `syncStartView`） |

### 6.4 `NavList` / `NavItem`
| 项 | 内容 |
|---|---|
| 原型 | `.nav`（`#fnNav`）> `.nav-item`（`recent`、`starred`） |
| 职责 | 普通导航项：最近编辑、收藏 |
| props（Item） | `icon`、`label`、`count?`、`active`、`onClick` |
| 造型 | 盒式选中（`--primary-soft` 底 + 主色文字），与 `.seg-item` 的下划线造型不同 |

### 6.5 `NotebookGroup`（笔记本 + 文件夹树）
| 项 | 内容 |
|---|---|
| 原型 | `.group` > `.nb-head`（`.nav-item[data-fn=notebook]` + `#nbAdd`）+ `.tree`（`#folderTree`） |
| 职责 | 笔记本节点 + 其下的文件夹树；节点**保留计数**（`.count`） |
| `NbAddButton` | 原型 `#nbAdd`。笔记本节点右侧 `+`，弹菜单：**新建文件夹 / 新建表格**。表格与文件夹的新建入口**只在这里**（表格不进快速录入框） |
| `FolderTree` / `FolderNode` | 最多两层嵌套；`data-toggle` 行控制子级展开（`.chev.open` 旋转 90°）；第二层**不提供**「新建子文件夹」入口 |
| props（Node） | `name`、`depth`、`expanded`、`active`、`children?`、`onToggle`、`onSelect` |
| 需求 | M03-01、M03-02、M05-01（§4.5、§7.4） |

### 6.6 `TagGroup` / `TagChip`
| 项 | 内容 |
|---|---|
| 原型 | `.group` > `.group-title` + `.tags` > `.chip.tag` |
| 职责 | 功能栏里的标签列表，点击进标签视图 |
| 注意 | `标签` 的 `.group-title` **保留**（只有「加密空间」不设分组小标题） |
| 已知后果 | 标签视图**只含笔记与表格，不含 Memo**（Q8 已确认）。点 Memo 上的标签胶囊时【建议】在时间轴内按标签筛选，而不是跳标签视图 |

### 6.7 `VaultNode` · 加密空间
| 项 | 内容 |
|---|---|
| 原型 | `.fn-vault` > `.nav-item.vault-node`（`#vaultNode`，含 `.lock-ic` 与 `.tagline`） |
| 职责 | 加密空间入口，两态：`locked`（虚线边框 → 实线 + 灰字）/ `unlocked`（锁图标转主色/琥珀） |
| **位置约束** | 在独立 `.fn-vault` 里，`flex:none` + 上分隔线，是 `.fnbar` 的最后一段，**贴底固定、不随 `.fn-scroll` 滚动**；**不设分组小标题** |
| props | `locked`、`onEnter` |
| 交互 | 锁定时点击 → 打开解锁框（不直接进空间） |
| 需求 | M08-07（§6.3） |

---

## 七、主操作区与视图 `features/*` 【已落地】

### 7.1 `TwoPane` 与 `ItemRow`

| 组件 | 落点 | 原型 | 职责 |
|---|---|---|---|
| `TwoPane` | `app/ui/TwoPane.tsx` | `TWO_PANE` 常量 | 记录类视图统一布局：左列条目列表 + 右列阅读编辑，**点条目在右列直接打开** |
| `ItemListHead` | 各 feature `ui/` | `vaultListHead()` | 列表头上的文件夹 chip 等（加密空间用，明文） |
| `ItemRow` | `app/ui/ItemRow.tsx` | `.item-row`（`.item-lead` / `.item-body` / `.item-title` / `.item-snippet` / `.item-foot`） | 条目行：类型图标、置顶标记、标题、摘要、标签胶囊、同步状态、加密标识 |
| `EmptyDocPanel` | `app/ui/` | `emptyDocPanel()` | 右列未选中时的占位 |
| `ListGuide` | `app/ui/` | `.guide`（`#guideBar`） | 原型演示用引导条，**正式实现删除**（第十二章登记） |

**适用范围**：`笔记本` / `加密空间` / `最近编辑` / `收藏` / `标签` 五个视图**同构**。active 判定 = 当前 `fn` 在 `TWO_PANE` 集合内（`item-row.active` 带左侧 2.5px 主色竖条）。

**需求**：M03-06、M03-07（§7.4；双栏形态为 Q8 / 用户确认 2026-09-26）

### 7.2 `DocPanel` 与子组件

| 组件 | 原型 | 职责 |
|---|---|---|
| `DocHead` | `.doc-head`（`.doc-title` + `.actions`） | 标题（可直接编辑）+ 右侧操作区。**正文头只有模式切换 + 「更多」菜单**（`#docMoreBtn`），其余操作全部收进更多菜单 |
| `DocModeSwitch` | `#docMode`（`.seg`） | 编辑 / 分屏 / 预览三档，`ed-body` 上挂 `mode-edit` / `mode-split` / `mode-preview` |
| `DocMoreMenu` | `.menu`（`#docMoreBtn` 触发） | 菜单项按类型区分：`加密此笔记`/`加密此表格`、`移动到…`、`版本历史`、`分享`、`收藏`、`删除`；**表格**多一项`降级为普通笔记` |
| `Editor`（CodeMirror 6 封装） | `.ed-body` / `.ed-pane` / `#edSource` / `#edPreview` | 公共编辑器组件，**落 `app/editor/`**（架构 §2.3.2）。三 / 四种模式：双栏实时预览（默认）、仅编辑、仅预览、即时渲染 |
| `MarkdownPreview` | `.md` | 预览渲染。渲染与安全按架构 §3.4（需 sanitize，禁裸 `innerHTML`） |
| `DocStatusBar` | `.doc-status` | 底部状态栏：同步状态（`sync-tag`）、**加密状态 + 倒计时 + 立即锁定**、字数、大小（`size-tag`）。**加密状态条与尺寸提示条已并入此栏**，不再各占一条 |
| `LockedDocPanel` | `lockedDocPanel()` / `docHeadOnly()` | 单篇加密 + 已锁定：标题保持明文可读，正文与附件不渲染，给解锁按钮 |
| `VaultLockedPanel` | `vaultLockedPanel()` | 加密空间锁定：整块占位，列表区 `hidden`，不显示条目 |

**需求**：M04-03、M04-04、M04-05、M04-08、M08-12（§7.1、§12.1、§10.10、§6.9）

**不变量**：
- 正文区只有**正文头 + 底部状态栏**；加密用标题旁**锁形标识**（`.enc-mark`），加密状态/倒计时/立即锁定在状态栏。
- 硬上限 1,900,000 字节时阻止保存；软上限 1 MB 时仅变色提示。颜色走令牌（`--amber` / `--red`）。
- 即时渲染（`live`）的语法覆盖与交互细则【后续定】（§后续清单 8）。

### 7.3 内容类视图

| 视图 | 落点 | 原型 | 关键子组件 |
|---|---|---|---|
| `HomePanel` | `features/home/` | `homePanel()` | `StatCards`（`.home-stats` / `.home-stat`）、`TodayTasks`（`.home-list` / `.home-locked`）、`RecentActivity`、`ShortcutGrid`（`.home-acts` / `.home-act`）、`QuickNav`（`.home-nav`） |
| `MemoPanel` | `features/memos/` | `memoPanel()` | `MemoTimeline`（`.day-group` / `.day-head` / `.memo-item`）、`MemoWaterfall`（`.waterfall` / `.wf-card`）、`MemoItem`（`memoItemHtml`，含 `.memo-imgs`、`.memo-foot` 胶囊）、`MemoLockedPlaceholder` |
| `TaskPanel` | `features/tasks/` | `taskPanel()` / `tasksInner()` | `TaskListView`（`.task-list` / `.task-row` / `.checkbox`）、`TaskKanban`（`.kanban` / `.kb-col` / `.kb-card`）、`TaskFilterBar`（`.task-filters`）、`TaskLockedPlaceholder` |
| `TablePanel` | `features/tables/` | `tablePanel()` | `TableView`（`.tbl-wrap` / `table.data` / `.rowid` / `.cover-mini`）、`GalleryView`（`.gallery` / `.gal-card` / `.gal-cover`）、`FieldChip` |

**要点**：

- **Memo 与待办是两个独立视图**（Q1 已确认）。Memo → 时间轴 / 瀑布流，**无清单 tab**；待办 → 列表 / 看板。两者顶部各有「添加」按钮，点击切功能栏录入框模式并聚焦。
- 首页数据**全由本地元数据计算，不发请求**；**统计始终计入**加密空间与单篇加密条目，不区分锁定（用户确认 2026-09-26）；来自 Memo 的部分在门禁锁定时显示「已锁定」（M02-03）。
- `MemoPanel` 与 `TaskPanel` 各有一个锁定占位（`.placeholder.boxed`），可抽成公共 `LockedPlaceholder`（当前原型是两份文案，形状相同）。
- 表格**第一列 `_id`** 是稳定行 ID（6–8 位 base36），编辑器默认隐藏。
- 图册与表格是**同一张 md 的两种渲染**（§10.8），视图是派生的，新增视图不改数据模型。
- 待办看板与列表是**纯视图**，不动数据模型；清单不是独立类型，是加在 Memo 上的标记（§9.1 / §9.4）。

**需求**：M02-03、M05-05~M05-08、M06-03、M06-04、M06-10、M07-05

### 7.4 隐私、搜索、回收站

| 组件 | 落点 | 原型 | 职责 |
|---|---|---|---|
| `UnlockModal` | `features/privacy/ui/` | `#unlockOverlay`（`.modal` / `.field` / `.field-err` / `.link`） | 隐私密码解锁框。文案须说明「隐私密码与登录密码是两个独立密码」。演示原型任意非空即可解锁 |
| `ResetPrivacyModal` | `features/privacy/ui/` | `#resetPwOverlay` | 重置隐私密码。**恢复码已废弃**（2026-09-26 模型修订）；文案如实说明「内容是明文存储的，重置不丢内容，只有已导出的旧备份需要旧密码」 |
| `TierMenu` | `features/privacy/ui/` | `tierMenuHtml()` | 解锁档位菜单（隐私胶囊触发）：4 档 + 立即锁定 |
| `VaultDocEmpty` | `features/privacy/ui/` | `vaultEmptyDoc()` | 加密空间解锁后未选中条目时的占位，含「保护边界」说明 |
| `SearchPanel` | `features/search/` | `searchPanel()` / `.sr-item` | 搜索结果列表；高亮用 `<em>`。**门禁过滤**：锁定时加密条目与 Memo 不参与搜索 |
| `TrashPanel` | `features/settings/ui/` | `trashPanel()` / `.trash-row` | 回收站是**设置子页面**，带「← 返回设置」按钮（返回时落回「版本与回收站」分类），不是功能栏独立入口 |

**需求**：M06-08、M08-03、M08-04、M08-05、M08-14、M09-01、M09-02、M12-02

### 7.5 `SettingsPanel` · 设置（两栏分页）

| 项 | 内容 |
|---|---|
| 原型 | `.set-wrap` > `.set-nav`（`#setNav`）+ `.set-pages`（`.set-page` / `.set-grid`） |
| 结构 | **左列分类导航 + 右侧当前分类内容**；**一次只渲染一个分类**（§7.5，功能拆解 M18-01） |
| 子组件 | `SetNav`（`.set-nav-item[data-set]`，含 `owner` 徽标）、`SetCard`（`.set-card` / `.set-head` / `.set-body`）、`SetRow`（`.set-row`）、`Toggle`、`RadioSet`（`.radio-opt` / `.radio-dot`）、`Field`、`KeyCap`、`WarnBox`、`BackupTargetCard`（`.bk-card`） |
| 分类（10 个） | 通用（**默认落地页**）/ 账户与安全 / 编辑器 / 隐私锁 / 版本与回收站 / 备份 / 分享 / MCP / 数据管理 / 实例管理（带 `owner` 徽标）。除「通用」提到首位外，顺序同 §7.5 表 |
| 卡片装配 | 按分类拆成 `cardGeneral` / `cardAccount` / `cardQuickMenu` / `cardEditor` / `cardPrivacy` / `cardMemoPrivacy` / `cardMcp` / `cardBackup` / `cardShare` / `cardVersion` / `cardData` / `cardInstance`，由 `setPageBody(id)` 装配 |
| 页头 | 显示「分类名 · 简述 · 分类总数」 |
| 通用页 | **两张卡**：启动视图 / 时区 / 主题 ＋ 快捷菜单配置 |
| 状态 | 当前分类记在 `state.setPage`（界面状态，Zustand） |
| 验证提示 | 设置相关断言一律**先切分类再断言**（原型脚本用 `openSetPage(id)`）；不先切分类会拿上一分类的残留 DOM 蒙混过关 |

**需求**：M18-01、M18-02、M18-03、M02-04（§7.5）

### 7.6 `Drawer` · 侧滑详情
| 项 | 内容 |
|---|---|
| 原型 | `.drawer`（`#drawer`，`openDrawer()` / `closeDrawer()`） |
| 状态 | **容器、样式、`openDrawer()`、`bindList(drawerMode)` 形参都在，但列表不再传 `true`** —— 能力保留、**不由条目列表触发** |
| 规划用途 | 「主操作区正在使用时临时查看条目属性」；未来可接的场景是表格图册的行详情（M05-08）与清单看板卡片（M07-05） |
| props | `open`、`item`、`onClose`、`onOpenInNotebook` |
| 落点 | `app/ui/Drawer.tsx`（跨 feature 复用） |
| 接入时机 | **等用户明确提出再接**，不要顺手打开 |

---

## 八、通用控件库 `app/ui/` 【已落地】

判定为通用的标准：原型中被 3 处以上复用，且不含业务语义。

| 控件 | 原型 | 变体 | 关键 props |
|---|---|---|---|
| `Icon` | `.ic` / `.sprite`（`<symbol>`） | `.sm` `.lg` | `name`（symbol id 去掉 `i-` 前缀）、`size?` |
| `Button` | `.btn` | `.primary` `.danger` `.ghost` `.sm`、`[disabled]` | `variant`、`size`、`icon?`、`onClick` |
| `IconButton` | `.icon-btn` | — | `icon`、`label`（`title` + `aria-label`）、`onClick` |
| `SegmentedControl` | `.seg` > `button.on`；`.mode-tabs` 同族 | — | `options`、`value`、`onChange`。**盒式**（外框 + `--panel-3` 灰实底选中）。第六章的 `ComposerModeTabs`（`.mode-tabs`）与第七章的 `DocModeSwitch`（`#docMode`）、`TableMode`（`#tableMode`）、`MemoMode`（`#memoMode`）、`TaskView`（`#taskView`）**都是它的用法，不是各自独立的控件**——差异只在尺寸（`.mode-tabs` 更矮更紧凑） |
| `UnderlineTabs`（下划线页签） | `.nav-seg` / `.seg-item.active::after` | — | `options`、`value`、`onChange`。**与 `SegmentedControl` 刻意不同**，见 6.2 不变量 2 |
| `Chip` | `.chip` | `.blue` `.amber` `.green` `.red` `.purple` `.tag` `.clickable` | `tone`、`icon?`、`onClick?` |
| `Pill` | `.pill` | `.ok` `.busy` | `tone`、`icon`、`text` |
| `Capsule` | `.capsule` | `.locked` `.unlocked` `.danger` `.blink` | `tone`、`icon`、`label`、`timer?`、`onClick` |
| `Avatar` | `.avatar` | 顶栏 30px / 菜单头 26px | `name`（取首字）、`size` |
| `Toggle` | `.toggle` | `.on` | `checked`、`onChange`、`disabled?` |
| `Checkbox` | `.checkbox` | `.on` | `checked`、`onChange` |
| `RadioSet` / `RadioOption` | `.radio-set` / `.radio-opt` / `.radio-dot` | `.on` | `options`、`value`、`onChange` |
| `Field` | `.field`（+ `.hint` / `.field-err`） | 错误态 `.field-err.show` | `label`、`hint?`、`error?`、`children` |
| `Menu` | `.menu` / `.menu-item` / `.menu-sep` / `.menu-label` / `.menu-head` / `.menu-seg` | 锚点定位**自动上翻** | `anchor`、`items`、`align: 'left' \| 'right'`、`onPick` |
| `Modal` / `Overlay` | `.overlay` / `.modal` / `.modal-head` / `.modal-body` / `.modal-foot` | `.mi`（`.blue`） | `open`、`title`、`desc`、`icon`、`footer`、`onClose`（点遮罩关闭） |
| `Toast` / `ToastHost` | `.toast-wrap` / `.toast` | `.ok` `.warn` `.info`、`.fade` | `message`、`tone`、`duration`（默认 2800ms） |
| `Placeholder` | `.placeholder`（+ `.boxed`） | 盒子态 / 纯居中态 | `icon`、`title`、`desc`、`action?` |
| `WarnBox` | `.warn-box` | 危险态（默认）/ `.info` | `tone`、`icon?`、`children` |
| `HintLine` | `.hint-line` | — | `children`（可含 `<code>`） |
| `InfoHint`（ⓘ + 悬停） | 【预留】原型未实现 | — | `text`。**规范见 `DESIGN.md` 与 AGENTS.md：界面辅助文案一律收进 `InfoHint`，不得平铺；但警告、破坏性后果、错误/校验、实时计数必须保持可见** |
| `KeyCap` | `.keycap` | — | `text`（如 `Asia/Shanghai`、`30 天`） |
| `SizeTag` | `.size-tag` | `.soft` `.hard` | `bytes`、`limit` |
| `SyncTag` | `.sync-tag` | `.ok` `.busy` `.err` `.enc` | `state`、`text` |
| `Badge` | `.badge` | — | `text`（如 `owner`） |
| `Stars` | `.stars` | — | `value`、`max` |
| `CoverPlaceholder` | `.cover-mini` / `.wf-img` / `.gal-cover` | 竖版 / 横版 / 大图 | `pattern`（条纹走 `--ph-stripe` 令牌） |
| `EmptyState` | `.home-empty` / `.placeholder.boxed` | — | 见 `Placeholder` |
| `Tooltip` | `title` 属性 | 【待定】是否做真 tooltip 组件 | — |

**通用控件铁律**：

1. **任何颜色都走令牌**，含条纹（`--ph-stripe`）、遮罩（`--scrim`）、阴影（`--shadow-1..3`）、`--on-primary`。完整规则见 `DESIGN.md` §3.2。注意 `linear-gradient()` 里的硬编码色**不会**被回归脚本的正则扫到，须手工核对（原型现有 14 处硬编码渐变、仅 3 处走令牌）。
2. **不在通用控件内写业务语义**。`Chip tone="amber"` 而不是 `Chip kind="encrypted"`。
3. **不引第二套 UI 库**（AGENTS.md「界面怎么做」）。
4. 图标一律走 `<symbol>` sprite，不内联 path、不引外部图标库。

---

## 九、图标与设计令牌

### 9.1 图标

原型内联 SVG sprite，**37 个 symbol**，`<use href="#i-xxx">` 引用。实现时做一个 `Icon` 组件 + sprite（或等价的图标模块），**id 保持原名**便于与原型对照。

| 分组 | symbol id（去掉 `i-` 前缀即 `Icon` 的 `name`） |
|---|---|
| 内容类型 | `note` `table` `clock` `check-sq` `tag` `folder` `image` |
| 动作 | `plus` `pencil` `trash` `share` `download` `refresh` `x` `more` `external` `search` `key` |
| 状态 | `lock` `unlock` `eye` `star` `pin` `check` `alert` `info` `cloud-ok` `cloud-up` `bolt` |
| 布局 | `chev-r` `chev-d` `columns` `list` `kanban` `home` `settings` `user` |

规格：默认 16px、`.sm` 13px、`.lg` 20px；`stroke-width: 1.6`，`fill: none`，`stroke: currentColor`。

### 9.2 设计令牌

- **令牌的唯一定义处是 `DESIGN.md`**（从原型 `:root` / `[data-theme="dark"]` 两套落稿）。本文**不复制令牌值**，只约定「走令牌」。注意：`DESIGN.md` 的第三章「视觉语言」现为**【待定】**（配色、字体、字号刻度、圆角刻度、阴影尚未定型），因此**色值表暂缺**；但第三章的**机制**（必须令牌化、双主题、禁硬编码含渐变、语义色不靠颜色单独表意）**已经生效**。
- 原型令牌全集：底色（`--bg` `--bg-soft` `--panel` `--panel-2` `--panel-3`）、线（`--line` `--line-2`）、文字（`--text` `--text-2` `--muted`）、主色（`--primary` `--primary-2` `--primary-soft` `--primary-line` `--on-primary`）、语义（`--amber` `--green` `--red` `--purple` 各自的 `-soft` / `-line`）、结构（`--hairline` `--ph-stripe` `--topbar-bg` `--lock-veil` `--scrim` `--shadow-1..3`）、尺寸（`--radius` `--radius-lg` `--fnbar-w` `--list-w` `--topbar-h`）、字体（`--mono` `--sans`）。
- **双主题**：浅色为默认，深色是**暖黑**（不是冷灰）。**主色浅深两套相同**；语义色在深色下提亮。切换走 `data-theme` 属性。

### 9.3 主题切换

| 项 | 内容 |
|---|---|
| 状态 | `theme: 'light' \| 'dark' \| 'auto'`，默认 `light` |
| 入口 | ① 设置 › 通用 › 界面偏好（`#themeSet`）② 账户快捷菜单里的一排三档（**切完不收起菜单**）。**不放顶栏**（顶栏 6 块是死约束） |
| 实现 | `applyTheme()`：`auto` 用 `matchMedia('(prefers-color-scheme: dark)')`，**jsdom 下回退 light**（做特性判断，不要在 jsdom 里崩） |
| 硬约束 | **切换不整页重渲染**（保滚动位置），只改 `data-theme` 并就地改高亮；同时要响应系统主题变化（监听 `matchMedia` 的 `change`） |

---

## 十、组件 ↔ 功能点 ↔ 需求 映射矩阵

| 组件 | 落点 | 功能点 | 需求 |
|---|---|---|---|
| `AppShell` / `Topbar` / `WorkArea` | `app/` | M02-01 | §7.4 |
| `BrandLogo` / `Breadcrumb` | `app/topbar/` | M02-01 | §7.4 |
| `SearchBox` / `SearchPanel` | `app/topbar/` + `features/search/` | M02-01、M09-01、M09-02 | §7.4、§13.1、§6.10、§8.9 |
| `SyncPill` | `app/topbar/` | M02-06、M13-02 | §1.4、§15.3 |
| `PrivacyCapsule` / `TierMenu` | `app/topbar/` + `features/privacy/` | M02-05、M08-04、M08-06、M08-12 | §6.9、§6.8 |
| `AccountEntry` / `AccountQuickMenu` | `app/topbar/` | M02-01、M18-03 | §7.5（补充） |
| `NewNoteButton` | `app/fnbar/` | M04-01 | §7.4 |
| `Composer` + 3 子件 | `app/fnbar/` | M02-02、M04-01、M06-01、M07-01、M07-02 | §7.4、§8.7、§9.2 |
| `NavSegmented` | `app/fnbar/` | M02-02、M02-04、M06-10、M07-05 | §7.4 |
| `NavList` / `NavItem` | `app/fnbar/` | M02-02、M03-07 | §7.4 |
| `NotebookGroup` / `FolderTree` / `NbAddButton` | `app/fnbar/` | M03-01、M03-02、M03-03、M03-04、M05-01 | §4.5、§7.4 |
| `TagGroup` / `TagChip` | `app/fnbar/` | M03-07、M04-06 | §7.4、§7.1 |
| `VaultNode` | `app/fnbar/` | M08-07 | §6.3 |
| `TwoPane` / `ItemRow` / `ItemListHead` | `app/ui/` | M03-06、M03-07、M08-07、M08-12 | §7.4 |
| `DocHead` / `DocModeSwitch` / `DocMoreMenu` | `app/` + features | M04-03、M04-08、M04-02、M05-10、M08-08 | §7.1、§6.2、§8.8、§10.11 |
| `Editor`（CodeMirror 封装） | `app/editor/` | M04-03、M04-04、M04-05 | §7.1、§12.1、§15.7、§10.10 |
| `DocStatusBar` | `app/` | M02-06、M04-04、M04-05、M08-12 | §6.9、§12.1、§10.10 |
| `LockedDocPanel` / `VaultLockedPanel` | `features/privacy/ui/` | M08-07、M08-12 | §6.9 |
| `UnlockModal` / `ResetPrivacyModal` | `features/privacy/ui/` | M08-03、M08-04、M08-14 | §6.8、§6.12 |
| `HomePanel` 系列 | `features/home/` | M02-03、M02-04 | §7.4、§7.5 |
| `MemoPanel` 系列 | `features/memos/` | M06-01、M06-02、M06-03、M06-04、M06-05、M06-08、M06-10 | §8 |
| `TaskPanel` 系列 | `features/tasks/` | M07-01、M07-03、M07-04、M07-05 | §9 |
| `TablePanel` / `GalleryView` | `features/tables/` | M05-01、M05-03、M05-05、M05-07、M05-08 | §10 |
| `TrashPanel` | `features/settings/ui/` | M12-01、M12-02、M12-03、M12-04 | §7.1、§16.1、§14.4 |
| `SettingsPanel` / `SetNav` / `SetCard` / `SetRow` | `features/settings/` | M18-01、M18-02、M18-03、M02-04、M19-01 | §7.5 |
| `Drawer` | `app/ui/` | M03-07、M05-08、M07-05 | §7.4【推荐】 |
| 通用控件库 | `app/ui/` | 跨模块 | — |

---

## 十一、复用关系与已知重叠

### 11.1 复用规则

- **向上复用**：`app/ui/` 的控件只能被 `app/` 与 `features/*` 引用，不能反向依赖 `features/*`。
- **不横向复用**：feature 之间零互相依赖。要在两个 feature 里用同一块东西，就把它提升到 `app/ui/`，**不要** `import` 另一个 feature（架构 §2.3.3）。
- **数据不进组件**：组件不 import `data/db`，只 import `features/<x>/model.ts` 的动作。

### 11.2 已知重叠与待收敛（记录下来，实现时统一，不要各写一套）

| 现象 | 说明 | 建议 |
|---|---|---|
| `.sw` 与 `.chip` 形状相近 | `.sw` 是录入框附加项（可点选，20px 高），`.chip` 是展示型胶囊（21px 高）。原型里两者样式独立 | 保留为两个控件（语义不同：可选 vs 展示），但底层共用一份「胶囊」样式基类 |
| `.nav-item` / `.seg-item` / `.tree-row` / `.set-nav-item` / `.mini-row` 都是「可点行」 | 五套相似样式，选中态 3 种写法（盒式 / 下划线 / 左侧竖条） | 抽一个 `ClickableRow` 基类承载 hover / focus / 键盘可达；**选中态的视觉留给各自的 `tone`，不要强行统一**（`.seg-item` 的下划线是刻意设计） |
| `.nav-seg`（下划线页签）与 `.seg`（盒式分段） | **刻意区分**，不是重复 | **不要合并**。见 6.2 不变量 2 |
| `.placeholder` 两种形态 | 纯居中（`.placeholder`）与盒子态（`.placeholder.boxed`）；Memo / 待办 / 加密空间 / 搜索各写了一份文案 | 文案作为 props 传入，控件本体只做两份 |
| 6 处 `@media` 断点 | `.waterfall` 3→2 列（≤1240px）；`.kanban` 3→1 列、`.drawer` 390→330px（≤1080px） | 断点值统一收进 `DESIGN.md`；组件内不写裸数值 |
| 硬编码渐变色 | `.logo`、`.btn-new`、`.avatar`、`.memo-imgs .thumb`、`.wf-img`、`.gal-cover`、`.sw` 的选中态有硬编码渐变 | 统一抽成令牌（如 `--brand-grad`、`--ph-cover`），否则换主题会漏改 |
| `.mini-tree` / `.mini-row` 未被任何渲染函数使用 | 原型遗留 | 实现时**不要照搬** |

### 11.3 原型专用、不进生产

| 元素 | 原型 | 处理 |
|---|---|---|
| `ListGuide`（`.guide` / `#guideBar`） | 演示引导条「原型演示：① …② …③ …」 | **删除**，不是产品功能 |
| 演示假数据 | `NOTES` / `MEMOS` / `TASKS` / `BOOKS` / `TRASH` / `VAULT_TREE` | 换成真实仓储；**样本数据只用小型、脱敏、可公开的示例**（AGENTS.md） |
| 原型简版 Markdown 渲染 | `mdToHtml()` | 不照搬。实现按架构 §3.4（GFM + sanitize） |
| 简化提示文案 | 大量 `toast('…（原型不实现）')` | 换成真实行为 |

---

## 十二、预留组件（尚未进原型）

以下界面已在需求文档 / 功能拆解中定义，但原型未实现。**形状待原型补上后再定**，此处只约定职责与大致拆法，避免实现时临时发明。

| 组件 | 落点 | 职责 | 功能点 / 需求 |
|---|---|---|---|
| `LoginPage` / `RegisterPage` | `app/auth/` 或 `features/auth/` | 登录（用户名 + 登录密码）；首位注册即 `owner`；注册开关关闭时登录页不显示注册入口 | M01-01、M01-02、M01-03（§5.2–§5.4） |
| `AuthGate` | `app/` | 未登录 / 会话过期的路由拦截；登录必须联网，不进离线模式 | M01-03、M01-04（§5.4） |
| `SessionList` | `features/settings/ui/` | 登录设备与会话管理（**占位**） | M01-06（§后续清单 2、4） |
| `ChangePasswordForm` | `features/settings/ui/` | 修改登录密码（当前密码 + 新密码两次） | M01-05（§7.5） |
| `ShareViewer` | `features/share-viewer/` | 分享查看器，**独立入口加载**（`share.html`），不挂主应用外壳 | M14-05（§16.1） |
| `ShareCreateDialog` / `ShareManageList` | `features/` | 创建分享（密码、过期）、管理我的分享、撤销 | M14-01、M14-03、M14-04（§16.1、§7.5） |
| `MemoCollectionShare` | `features/` | Memo 固定合集分享（条目在创建时固定） | M14-02（§16.1） |
| `VersionHistoryPanel` / `VersionDiff` | `features/versions/` | 版本列表、查看与对比、恢复、标记为「保留」 | M11-01~M11-05（§12.2–§12.4、§7.1） |
| `RetentionPolicyForm` | `features/settings/ui/` | 版本保留策略设置（原型只有静态文案 + 「调整」按钮） | M11-06（§12.3） |
| `BackupRestoreFlow` | `features/backup/` | 从备份恢复的流程（选择目标 → 预检 → 执行 → 报告） | M16-04（§16.3） |
| `BackupTargetForm` | `features/backup/` | 备份目标的新增 / 编辑（原型只有已配置好的卡片） | M16-01、M16-02、M16-03（§16.3） |
| `EnvelopeDecryptGuide` | `features/backup/` | 备份导出信封的外部解密工具说明 | 架构 §7.3 |
| `McpTokenCreateDialog` / `McpTokenDetail` / `McpAuditLog` | `features/settings/ui/` | 令牌创建（完整值**只显示一次**）、范围与权限、审计日志 | M17-01、M17-02、M17-03（§17.2、§17.3） |
| `AttachmentUploader` / `AttachmentPreview` / `AttachmentGrid` | `features/attachments/` | 上传（哈希去重、缩略图在 `media.worker`）、预览、附件管理 | M10-01、M10-02、M10-03（§14） |
| `OrphanScanResult` | `features/settings/ui/` | 孤儿附件扫描结果清单与清理确认 | M10-03（§14.3） |
| `ConflictBadge` / `ConflictCopyNotice` | `data/sync/` 的展示层 | 「冲突」状态的标记与冲突副本提示 | M13-04（§15.5） |
| `OfflineBanner` | `app/topbar/` | 离线横幅「离线，改动会在联网后上传」 | M02-06（§15.3） |
| `UpdateNotice` | `app/` | 「有新版本」提示，下次打开生效；只推送给 `owner` | M19-04（§21.1 第 11 条、§15.6） |
| `TableColumnManager` / `FieldTypePicker` / `FilterBar` / `SortBar` | `features/tables/ui/` | 列管理（新建列、十种字段类型选择）、筛选与排序 UI | M05-02、M05-03、M05-07（§10.2、§10.4、§10.7） |
| `ImageCell` / `CellEditor` | `features/tables/ui/` | 图片附件单元格、各字段类型的行内编辑器 | M05-05、M05-06、M05-09（§10.5、§10.7） |
| `TagManager` | `features/settings/ui/` | 标签重命名 / 合并 / 删除 | M04-06（§7.1） |
| `MoveToFolderDialog` | `app/ui/` | 「移动到…」对话框（含移入加密空间；超三层置灰） | M03-04、M08-09、M08-10（§4.5、§6.11） |
| `ConfirmDialog` | `app/ui/` | 通用确认框（删除文件夹写明「N 条内容、M 个子文件夹将移入回收站」；破坏性操作必须可见说明） | M03-05、M12-01（AGENTS.md「警告必须保持可见」） |
| `BatchMarkBar` | `app/ui/` | 批量标记操作条（元数据操作，锁定时可执行） | M08-11（§6.4 修订） |
| `ExportDialog` | `features/` | 单篇导出 / 按条件导出 / 全量 ZIP（含隐私规则提示） | M15-01~M15-03（§16.2、§6.10） |
| `TimeZonePicker` | `features/settings/ui/` | 时区选择（原型只有 `KeyCap` + 「修改」按钮） | M02-04（§7.5、§8.4） |
| `MemberManager` | `features/settings/ui/` | 成员账户管理（停用 / 删除 / 数据清理）——**仅 `owner`** | M19-03（§后续清单 3） |

---

## 十三、维护规则

1. **改动触发**：原型增删区块、组件改名、新增可复用控件、落点在 `app/` 与 `features/*` 之间迁移 → 更新本文；纯样式微调（颜色、间距、圆角）→ **不进本文**，直接改 `DESIGN.md`（若涉及令牌）。
2. **与 `DESIGN.md` 的分工不重叠**：本文只写「有哪些组件、放哪、契约是什么」，不写「长什么样」。任何一个组件，在本文里读职责与 props，在 `DESIGN.md` 里读视觉。
3. **与架构的一致性**：本文的落点必须能对上架构 §2.3.2 的「功能 → 代码落点对照表」。新增 feature 或新目录先改架构 §2.3.2，再改本文（架构 §2.3.3 第 3 条）。
4. **拆分阈值**：本文超过约 800 行，或某个 feature 的组件超过 15 个，按 `wiki/components/<功能>.md` 拆分，本文保留总览与通用控件库。
5. **不写行号**：引用原型一律写元素名 / 选择器（沿用功能拆解 v2.1 的约定）。
6. **组件名是实现契约**：实现阶段如认为某个组件应改名或合并，先回报本文再改，避免文档与代码长期漂移。
7. **验证脚本对应**：`prototype/verify-prototype.js` 与 `prototype/verify-framework.js` 里的断言，多半可平移为组件级单测的验收点（尤其顶栏 6 块、录入框高度与导航位移、两条导航造型的区分、设置两栏分页）。新增组件时同步登记需要哪一条断言。

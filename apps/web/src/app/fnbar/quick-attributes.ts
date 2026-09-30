/**
 * 快捷输入 `@` 属性菜单的**数据契约**（编辑拓展阶段 B / Task B4）。
 *
 * 这里只回答一个问题：**某个宿主能写哪些属性**。菜单显示什么、点了以后聚焦哪个控件，
 * 由 `Composer` / `AddEntryDialog` 决定；真正的落库仍走它们既有的受控字段与发布回调。
 *
 * 三条边界（写死，别在实现里漂移）：
 * 1. **没有可写落点的命令不进菜单**。不做 disabled 的假入口——一个点了没反应的项比没有更糟。
 *    当前只有待办的「截止日期 / 优先级」有受控字段；Memo 的标签来自正文 `#标签` 派生（没有选择器），
 *    笔记的目标目录在 `ModeExtras` 里只是展示 chip（没有写入通道），所以这两个宿主返回空数组。
 * 2. **`@` 不是正文格式**。属性绝不写进 Markdown 正文（设计 v3 §3.3）；正文的标签、文件夹、日期
 *    仍走标题区、属性面板与「更多」菜单。
 * 3. **`"note"` 是合法宿主**，只是当前命令表为空。它是笔记快捷录入宿主（功能栏「笔记」档、
 *    添加窗口的笔记档）——保留这个取值，以后接笔记属性时不用再改一次类型与全部调用方。
 */

export type QuickAttributeHost = "memo" | "task" | "note";

export type QuickAttributeId = "due" | "priority";

export interface QuickAttributeCommand {
  id: QuickAttributeId;
  /** 与既有受控字段的叫法一致（`Composer` 的 `aria-label="截止日期"` / `ariaLabel="优先级"`） */
  label: string;
  /** 声明式宿主过滤：命令自己说清"我能写进哪些宿主"，宿主侧不写 if/else */
  hosts: readonly QuickAttributeHost[];
}

/**
 * 命令表。加命令时只在这里加一条并声明宿主——`attributeCommandsFor()` 不用改。
 */
export const QUICK_ATTRIBUTE_COMMANDS: readonly QuickAttributeCommand[] = Object.freeze([
  Object.freeze({ id: "due", label: "截止日期", hosts: Object.freeze(["task"] as const) }),
  Object.freeze({ id: "priority", label: "优先级", hosts: Object.freeze(["task"] as const) }),
]);

/** 某宿主可用的属性命令（顺序即菜单顺序；每次返回新数组，调用方改不到命令表）。 */
export function attributeCommandsFor(host: QuickAttributeHost): readonly QuickAttributeCommand[] {
  return QUICK_ATTRIBUTE_COMMANDS.filter((command) => command.hosts.includes(host));
}

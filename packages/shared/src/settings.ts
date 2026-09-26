/**
 * 用户设置（需求 §7.5；功能拆解 M18-01/M18-02/M18-03）。
 *
 * 只有**跟随账号同步**的设置进这里：启动视图、时区、默认编辑模式、账户快捷菜单的配置。
 * 「主题」是**设备级**偏好（同一账号在手机与桌面可以不同），M1 起就存在 `localStorage`，
 * 不进这份契约——设置页里的主题行直接调主题 hook。
 *
 * 并发口径：设置是"整份覆盖"的，**以后写为准**（不做冲突副本——它不是用户内容）。
 */
import * as v from "valibot";

const IntSchema = v.pipe(v.number(), v.integer());

/** 启动视图（需求 §7.5：首页 / 最近编辑 / 收藏，默认首页） */
export const StartViewSchema = v.picklist(["home", "recent", "starred"]);
export type StartView = v.InferOutput<typeof StartViewSchema>;

/**
 * 默认编辑模式（M04-03）。第四档「即时渲染」细则【后续定】，M2 只落前三档，
 * 第四档在界面上置灰并说明——所以这里也不进契约。
 */
export const EditorModeSchema = v.picklist(["split", "edit", "preview"]);
export type EditorMode = v.InferOutput<typeof EditorModeSchema>;

/** 账户快捷菜单的可配置功能项（M18-03：第一版 5 个候选） */
export const QuickMenuFeatureSchema = v.picklist(["theme", "lock", "search", "trash", "backup"]);
export type QuickMenuFeature = v.InferOutput<typeof QuickMenuFeatureSchema>;

/** 5 个候选的清单——菜单与设置页**同一份数据驱动**（功能拆解 M18-03 的要求） */
export const QUICK_MENU_FEATURES: ReadonlyArray<{
  id: QuickMenuFeature;
  label: string;
  /** 默认是否开启（M18-03：主题切换与立即锁定默认开，其余默认关，让菜单保持短小） */
  defaultOn: boolean;
  /** 未实现时的说明（M2 里搜索可用；回收站与立即备份随各自里程碑） */
  pendingStep: string | null;
}> = [
  { id: "theme", label: "主题切换", defaultOn: true, pendingStep: null },
  { id: "lock", label: "立即锁定", defaultOn: true, pendingStep: "M3" },
  { id: "search", label: "搜索", defaultOn: false, pendingStep: null },
  { id: "trash", label: "回收站", defaultOn: false, pendingStep: "M4" },
  { id: "backup", label: "立即备份", defaultOn: false, pendingStep: "M5" },
];

export const UserSettingsSchema = v.object({
  start_view: StartViewSchema,
  timezone: v.string(),
  editor_mode: EditorModeSchema,
  /** 选中的功能项；**数组顺序即菜单里的显示顺序** */
  quick_menu: v.array(QuickMenuFeatureSchema),
});
export type UserSettings = v.InferOutput<typeof UserSettingsSchema>;

export const DEFAULT_USER_SETTINGS: UserSettings = {
  start_view: "home",
  timezone: "Asia/Shanghai",
  editor_mode: "split",
  quick_menu: QUICK_MENU_FEATURES.filter((feature) => feature.defaultOn).map(
    (feature) => feature.id,
  ),
};

/** `GET /api/settings` 与同步响应里的设置载荷 */
export const UserSettingsPayloadSchema = v.object({
  settings: UserSettingsSchema,
  rev: IntSchema,
  updated_at: IntSchema,
});
export type UserSettingsPayload = v.InferOutput<typeof UserSettingsPayloadSchema>;

/** `PUT /api/settings`：整份覆盖，`base_rev` 仅用于诊断（后写为准，不拒绝旧基线） */
export const UserSettingsWriteSchema = v.object({
  settings: UserSettingsSchema,
  base_rev: IntSchema,
});
export type UserSettingsWrite = v.InferOutput<typeof UserSettingsWriteSchema>;

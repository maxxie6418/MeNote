/**
 * 用户设置契约的用例（`packages/shared/src/settings.ts`）。
 *
 * 这个文件的职责很窄但很关键：**钉住"给设置加字段不许打破部署窗口内的旧客户端"**。
 * M3 加 `privacy`、M4 加 `version_trash`、v0.5.2 加 `task_view` 都用的是同一条做法
 * （`v.optional(schema, 默认值)`）——服务端读旧 JSON 由 schema 补默认值，
 * 旧客户端 PUT 不带该字段也不会 422。做法一旦被改写，"旧客户端整份覆盖设置"就会静默丢字段。
 */
import { describe, expect, it } from "vitest";
import * as v from "valibot";
import {
  DEFAULT_EDITOR_MODES,
  DEFAULT_TASK_VIEW_SETTINGS,
  DEFAULT_USER_SETTINGS,
  EDITOR_MODES,
  PRODUCT_EDITOR_MODES,
  TASK_FILTER_FORMS,
  TaskViewSettingsSchema,
  UserSettingsSchema,
  isProductEditorMode,
  normalizeEditorModes,
} from "../src/settings";

describe("用户设置：加字段向后兼容（optional + 默认值）", () => {
  it("旧客户端那份不带 task_view 的设置能通过校验，且输出里补齐了默认值", () => {
    const legacy = {
      start_view: "home",
      timezone: "Asia/Shanghai",
      editor_mode: "split",
      quick_menu: [],
    };

    const parsed = v.safeParse(UserSettingsSchema, legacy);
    expect(parsed.success).toBe(true);
    // 输出类型里它**必有**（默认值补齐），所以界面可以放心 `settings.task_view.filter_form`
    expect(parsed.success && parsed.output.task_view).toEqual(DEFAULT_TASK_VIEW_SETTINGS);
  });
});

describe("待办筛选条形态（v0.5.2；定稿：两种都留，用户自选）", () => {
  it("默认是基线「胶囊横排」", () => {
    expect(DEFAULT_TASK_VIEW_SETTINGS.filter_form).toBe("capsules");
  });

  it("只有契约里那两种取值合法，别的一律拒绝", () => {
    for (const form of TASK_FILTER_FORMS) {
      expect(v.safeParse(TaskViewSettingsSchema, { filter_form: form }).success).toBe(true);
    }
    expect(TASK_FILTER_FORMS).toEqual(["capsules", "floating"]);
    // 第三种形态不存在（定稿只留两种），写错要在契约层就拦住，而不是界面上静默不生效
    expect(v.safeParse(TaskViewSettingsSchema, { filter_form: "cards" }).success).toBe(false);
  });
});

/**
 * 编辑模式改成"开关组"（用户 2026-09-29 拍板：设置里改成可开关显示的，至少留一个）。
 *
 * 契约这一侧要钉住四件事：
 * ①老行/旧客户端不带 `editor_modes` 时补成**生产清单**（编辑拓展阶段 C 起是"仅编辑 / 即时渲染 /
 *   仅预览"；双栏**读得进来、出不去**）；
 * ②`editor_mode` 仍在、且被解读为"首次初始值"（老用户升级后第一次打开不换档）；
 * ③归一化把非法/重复/空一次收口——空数组兜成产品清单全集，绝不让"一个档都没有"流到界面上，
 *   也绝不让已退出产品的 `split` 漏到渲染层；
 * ④**只留一份产品清单**：`DEFAULT_EDITOR_MODES` 就是 `PRODUCT_EDITOR_MODES`（改一处不再漏两处）。
 */
describe("编辑模式：显示哪几档（v0.5.19；v0.6.0 收敛，v0.6.2 加回即时渲染）", () => {
  const base = {
    start_view: "home",
    timezone: "Asia/Shanghai",
    editor_mode: "split",
    quick_menu: [],
  };

  it("老行（没有 editor_modes）通过校验，输出补成**生产清单**，且老的 editor_mode 原样保留", () => {
    const parsed = v.safeParse(UserSettingsSchema, { ...base, editor_mode: "live" });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.output.editor_modes).toEqual([...PRODUCT_EDITOR_MODES]);
    // 它现在只是"首次初始值"：老用户升级后第一次打开笔记仍读得回这一档（是否可用由产品清单决定）
    expect(parsed.success && parsed.output.editor_mode).toBe("live");
  });

  it("归一化：用户开着的档 ∩ 生产清单，按规范顺序排（不依赖存储里的顺序）", () => {
    // 老行里存着四档 → 界面上只剩产品允许的三档（双栏静默退出）
    expect(normalizeEditorModes(["live", "split", "edit", "preview", "live"])).toEqual([
      "edit",
      "preview",
      "live",
    ]);
    // 老行只开了「仅预览」→ 就只给它一档，不擅自把它没开的档塞回来
    expect(normalizeEditorModes(["preview"])).toEqual(["preview"]);
    // 用户开着的档全被产品滤掉（例如老行只开了双栏）→ 空 → 兜成产品全集，不能让正文没得用
    expect(normalizeEditorModes(["split"])).toEqual([...PRODUCT_EDITOR_MODES]);
    expect(normalizeEditorModes([])).toEqual([...PRODUCT_EDITOR_MODES]);
    expect(normalizeEditorModes(undefined)).toEqual([...PRODUCT_EDITOR_MODES]);
  });

  it("未知档位在 schema 层就被拒（归一化不负责纠错）", () => {
    const parsed = v.safeParse(UserSettingsSchema, {
      ...base,
      editor_modes: ["live", "typo"],
    });
    expect(parsed.success).toBe(false);
  });

  it("规范顺序稳定：设置页开关与正文区切换条都照它排（四值仍读兼容）", () => {
    expect(EDITOR_MODES).toEqual(["split", "edit", "preview", "live"]);
  });

  it("产品清单只有一份来源，且阶段 C 起就是「仅编辑 / 仅预览 / 即时渲染」", () => {
    // 顺序跟 `EDITOR_MODES` 的规范顺序（edit → preview → live）：界面先后只此一处来源
    expect(PRODUCT_EDITOR_MODES).toEqual(["edit", "preview", "live"]);
    expect(DEFAULT_EDITOR_MODES).toEqual(PRODUCT_EDITOR_MODES);
    // 默认值也不再是双栏：新用户的第一次打开不再落到"双栏"
    expect(DEFAULT_USER_SETTINGS.editor_mode).toBe("edit");
    expect(DEFAULT_USER_SETTINGS.editor_modes).toEqual([...PRODUCT_EDITOR_MODES]);
  });

  it("`isProductEditorMode` 是写「上次用的那一档」前的唯一收口", () => {
    expect(isProductEditorMode("edit")).toBe(true);
    expect(isProductEditorMode("live")).toBe(true);
    expect(isProductEditorMode("preview")).toBe(true);
    // 双栏仍留在产品外：读得进来，写不出去，界面上也不会出现
    expect(isProductEditorMode("split")).toBe(false);
  });
});

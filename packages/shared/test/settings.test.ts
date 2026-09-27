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
  DEFAULT_TASK_VIEW_SETTINGS,
  TASK_FILTER_FORMS,
  TaskViewSettingsSchema,
  UserSettingsSchema,
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

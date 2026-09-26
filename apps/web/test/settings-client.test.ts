import "fake-indexeddb/auto";
/**
 * 客户端设置的本地语义（M2-7）：
 * - 没写过 → 默认值、rev 0、无待上传；
 * - 保存 → 立即落盘 + 入队一条 `put_settings`（连点几次只排一条）；
 * - 同步落库 → **本地有待上传改动就不覆盖**；服务端 rev 不比本地新也不覆盖；
 * - 上传成功 → 记回 rev 并清掉待上传。
 */
import { DEFAULT_USER_SETTINGS } from "@menote/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applySyncSettings,
  db,
  getLocalSettings,
  markSettingsSynced,
  saveLocalSettings,
} from "../src/data/db";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("本地设置的读写", () => {
  it("从没写过时返回默认值", async () => {
    const local = await getLocalSettings();
    expect(local.settings).toEqual(DEFAULT_USER_SETTINGS);
    expect(local.rev).toBe(0);
    expect(local.pending).toBe(false);
  });

  it("保存后立即生效并入队上传；连点多次只排一条", async () => {
    await saveLocalSettings({ ...DEFAULT_USER_SETTINGS, timezone: "UTC" }, 100);
    await saveLocalSettings({ ...DEFAULT_USER_SETTINGS, timezone: "Asia/Tokyo" }, 200);

    const local = await getLocalSettings();
    expect(local.settings.timezone).toBe("Asia/Tokyo");
    expect(local.pending).toBe(true);

    const rows = await db.outbox.where("[entity+entity_id]").equals(["setting", "user"]).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.op).toBe("put_settings");
  });
});

describe("同步落库的取舍", () => {
  it("服务端 rev 更新时覆盖本地", async () => {
    await db.settings.put({
      key: "user",
      json: { ...DEFAULT_USER_SETTINGS, timezone: "UTC" },
      rev: 1,
      updated_at: 1,
      pending: null,
    });

    const applied = await applySyncSettings({
      settings: { ...DEFAULT_USER_SETTINGS, timezone: "Asia/Tokyo" },
      rev: 2,
      updated_at: 2,
    });

    expect(applied).toBe(true);
    expect((await getLocalSettings()).settings.timezone).toBe("Asia/Tokyo");
  });

  it("本地还有未上传改动时不覆盖（别把用户刚改的顶掉）", async () => {
    await saveLocalSettings({ ...DEFAULT_USER_SETTINGS, timezone: "Europe/London" }, 100);

    const applied = await applySyncSettings({
      settings: { ...DEFAULT_USER_SETTINGS, timezone: "Asia/Tokyo" },
      rev: 9,
      updated_at: 9,
    });

    expect(applied).toBe(false);
    expect((await getLocalSettings()).settings.timezone).toBe("Europe/London");
  });

  it("服务端 rev 不比本地新时不覆盖（旧响应不能盖回新值）", async () => {
    await db.settings.put({
      key: "user",
      json: { ...DEFAULT_USER_SETTINGS, timezone: "UTC" },
      rev: 5,
      updated_at: 5,
      pending: null,
    });

    const applied = await applySyncSettings({
      settings: { ...DEFAULT_USER_SETTINGS, timezone: "Asia/Tokyo" },
      rev: 5,
      updated_at: 5,
    });

    expect(applied).toBe(false);
    expect((await getLocalSettings()).settings.timezone).toBe("UTC");
  });

  it("上传成功后记回 rev 并清掉待上传标记", async () => {
    await saveLocalSettings({ ...DEFAULT_USER_SETTINGS, timezone: "UTC" }, 100);
    await markSettingsSynced(3, 300);

    const local = await getLocalSettings();
    expect(local.rev).toBe(3);
    expect(local.pending).toBe(false);
    expect(local.settings.timezone).toBe("UTC"); // 内容不被清掉
  });
});

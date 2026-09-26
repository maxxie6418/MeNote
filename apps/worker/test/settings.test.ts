/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 用户级设置（M2-7）：`GET/PUT /api/settings` 与同步响应里的设置载荷。
 *
 * 口径：整份覆盖、**后写为准**（不生成冲突副本）；没写过或 JSON 坏掉都退回默认值。
 */
import { DEFAULT_USER_SETTINGS, base64UrlEncode, type UserSettingsPayload } from "@menote/shared";
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";

async function registerOwner(username: string): Promise<{ cookie: string; id: string }> {
  const key = new Uint8Array(32);
  key.fill(9);
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
    body: JSON.stringify({ username, login_key: base64UrlEncode(key) }),
  });
  const cookie = ((res.headers.get("set-cookie") ?? "").split(";")[0] ?? "").trim();
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
  const body = (await me.json()) as { id: string };
  return { cookie, id: body.id };
}

function writeHeaders(cookie: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Menote": "1",
    Origin: ORIGIN,
    Cookie: cookie,
  };
}

let alice: { cookie: string; id: string };

beforeEach(async () => {
  await freshDatabase();
  alice = await registerOwner("alice");
});

describe("GET /api/settings", () => {
  it("未登录 401", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/settings`)).status).toBe(401);
  });

  it("从没写过时返回默认值，rev = 0", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/settings`, { headers: { Cookie: alice.cookie } });
    const body = (await res.json()) as UserSettingsPayload;

    expect(res.status).toBe(200);
    expect(body.rev).toBe(0);
    expect(body.settings).toEqual(DEFAULT_USER_SETTINGS);
    // 默认：主题切换与立即锁定开，其余关（M18-03）
    expect(body.settings.quick_menu).toEqual(["theme", "lock"]);
  });
});

describe("PUT /api/settings", () => {
  it("整份覆盖写，rev 从 1 开始递增", async () => {
    const next = {
      start_view: "recent" as const,
      timezone: "Asia/Tokyo",
      editor_mode: "preview" as const,
      quick_menu: ["theme", "search"] as const,
    };

    const first = await SELF.fetch(`${ORIGIN}/api/settings`, {
      method: "PUT",
      headers: writeHeaders(alice.cookie),
      body: JSON.stringify({ settings: next, base_rev: 0 }),
    });
    const firstBody = (await first.json()) as UserSettingsPayload;
    expect(first.status).toBe(200);
    expect(firstBody.rev).toBe(1);
    expect(firstBody.settings.timezone).toBe("Asia/Tokyo");

    const second = await SELF.fetch(`${ORIGIN}/api/settings`, {
      method: "PUT",
      headers: writeHeaders(alice.cookie),
      body: JSON.stringify({ settings: { ...next, start_view: "starred" }, base_rev: 1 }),
    });
    const secondBody = (await second.json()) as UserSettingsPayload;
    expect(secondBody.rev).toBe(2);
    expect(secondBody.settings.start_view).toBe("starred");

    // 再读一次应拿到最新值
    const read = await SELF.fetch(`${ORIGIN}/api/settings`, { headers: { Cookie: alice.cookie } });
    expect(((await read.json()) as UserSettingsPayload).settings.start_view).toBe("starred");
  });

  it("非法内容 422（枚举外的启动视图 / 未知的菜单项 / 非整数基线）", async () => {
    for (const payload of [
      { settings: { ...DEFAULT_USER_SETTINGS, start_view: "notebook" }, base_rev: 0 },
      { settings: { ...DEFAULT_USER_SETTINGS, quick_menu: ["theme", "unknown"] }, base_rev: 0 },
      { settings: DEFAULT_USER_SETTINGS, base_rev: "x" },
    ]) {
      const res = await SELF.fetch(`${ORIGIN}/api/settings`, {
        method: "PUT",
        headers: writeHeaders(alice.cookie),
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(422);
    }
  });

  it("库里 JSON 坏掉时读回默认值，不 500", async () => {
    await env.DB.prepare(
      "INSERT INTO user_settings (user_id, json, rev, sync_seq, updated_at) VALUES (?, '{坏掉的', 3, 1, 1)",
    )
      .bind(alice.id)
      .run();

    const res = await SELF.fetch(`${ORIGIN}/api/settings`, { headers: { Cookie: alice.cookie } });
    const body = (await res.json()) as UserSettingsPayload;
    expect(res.status).toBe(200);
    expect(body.settings).toEqual(DEFAULT_USER_SETTINGS);
    expect(body.rev).toBe(3); // rev 照常返回，客户端下次写入会覆盖坏数据
  });
});

describe("同步响应里的设置", () => {
  it("每次 pull 都带上设置载荷（不参与游标）", async () => {
    await SELF.fetch(`${ORIGIN}/api/settings`, {
      method: "PUT",
      headers: writeHeaders(alice.cookie),
      body: JSON.stringify({
        settings: { ...DEFAULT_USER_SETTINGS, timezone: "UTC" },
        base_rev: 0,
      }),
    });

    const res = await SELF.fetch(`${ORIGIN}/api/sync?cursor=0`, {
      headers: { Cookie: alice.cookie },
    });
    const body = (await res.json()) as { settings: UserSettingsPayload; next_cursor: number };

    expect(body.settings.settings.timezone).toBe("UTC");
    expect(body.settings.rev).toBe(1);
    // 设置不推进游标（没有条目也没有文件夹）
    expect(body.next_cursor).toBe(0);
  });
});

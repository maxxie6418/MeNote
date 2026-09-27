/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 版本历史服务端（M4-5；《M4 设计》§4）。
 *
 * 大部分用例直接打服务层（`sealVersion` / `restoreVersion` / `sparsifyItem`）：
 * 这一摊的重点是**版本语义**（去重、压缩、恢复、保留），不是 HTTP 管线；
 * 归属与鉴权那几条才走真路由。桶用 miniflare 的真实 R2。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import {
  DEFAULT_VERSION_TRASH_SETTINGS,
  DAY_MS,
  VERSION_GZIP_MAX_BYTES,
  base64UrlEncode,
  newUlid,
} from "@menote/shared";
import { versionKey } from "../src/adapters/r2";
import {
  chooseSparseVictims,
  sparsifyItem,
} from "../src/services/version-retention";
import { getVersionBody, restoreVersion, sealVersion, sealIdleVersions } from "../src/services/versions";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";
const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);
let seq = 0;

/** 造一个用户 + 一条笔记（直接落库，省掉 HTTP 管线；版本语义与它无关） */
async function seedNote(userId = "u1", itemId = "i1", body = "第一版正文"): Promise<string> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, username, role, auth_salt, auth_kdf, auth_verifier, sync_seq, tombstone_floor, created_at, updated_at)
     VALUES (?, ?, 'owner', X'00', 'PBKDF2-SHA-256', X'00', 0, 0, 1, 1)`,
  )
    .bind(userId, `user-${userId}`)
    .run();

  const hash = await sha256Hex(body);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO items (id, user_id, type, title, enc_self, in_enc_space, size_bytes, content_hash, tags,
       is_task, pinned, starred, rev, meta_rev, sync_seq, created_at, updated_at, last_edit_at, deleted_at)
     VALUES (?, ?, 'note', '标题', 0, 0, ?, ?, '[]', 0, 0, 0, 1, 1, 1, 1, 1, ?, NULL)`,
  )
    .bind(itemId, userId, new TextEncoder().encode(body).length, hash, NOW)
    .run();
  await env.DB.prepare(
    "INSERT INTO item_bodies (item_id, body) VALUES (?, ?) ON CONFLICT(item_id) DO UPDATE SET body = excluded.body",
  )
    .bind(itemId, body)
    .run();

  return hash;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function seal(
  body: string,
  overrides: Partial<Parameters<typeof sealVersion>[3]> = {},
  now = NOW,
): Promise<{ id: string; codec: string; created: boolean }> {
  const hash = await sha256Hex(body);
  const result = await sealVersion(
    env,
    "u1",
    "i1",
    {
      reason: "autosave_idle",
      body,
      contentHash: hash,
      title: "标题",
      sizeBytes: new TextEncoder().encode(body).length,
      rev: 1,
      ...overrides,
    },
    now,
  );
  return { id: result.version.id, codec: result.version.codec, created: result.created };
}

beforeEach(async () => {
  await freshDatabase();
  await seedNote();
});

describe("封存", () => {
  it("正文写进 R2 的 v/{uid}/{item_id}/{version_id}，元数据进 D1", async () => {
    const { id } = await seal("第一版正文");

    const row = await env.DB.prepare("SELECT r2_key FROM item_versions WHERE id = ?")
      .bind(id)
      .first<{ r2_key: string }>();
    expect(row?.r2_key).toBe(versionKey("u1", "i1", id));

    const object = await (env.ATTACHMENTS as R2Bucket).get(row?.r2_key ?? "");
    expect(object).not.toBeNull();
  });

  it("content_hash 与最近版本相同则不新增（自动保存很频繁，内容没变是常态）", async () => {
    const first = await seal("同一份内容");
    expect(first.created).toBe(true);

    // 再封一次同样的内容
    const second = await seal("同一份内容");
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);

    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM item_versions").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("256KB 以内走 gzip 且能解回原文", async () => {
    const body = "内容".repeat(1000); // 远小于 256KB，但足够看出来压缩
    const { id, codec } = await seal(body);
    expect(codec).toBe("gzip");

    const { body: decoded } = await getVersionBody(env, "u1", id);
    expect(decoded).toBe(body);
  });

  it("超过 256KB 用 codec='none' 且不解压（Worker CPU 预算）", async () => {
    const body = "a".repeat(VERSION_GZIP_MAX_BYTES + 10);
    const { id, codec } = await seal(body);
    expect(codec).toBe("none");

    const { body: decoded } = await getVersionBody(env, "u1", id);
    expect(decoded).toBe(body);
  });

  it("手动版本落库即 keep=1（不参与稀疏化）", async () => {
    const { id } = await seal("手动存的", { reason: "manual", label: "发布前" });

    const row = await env.DB.prepare("SELECT keep, label, reason FROM item_versions WHERE id = ?")
      .bind(id)
      .first<{ keep: number; label: string | null; reason: string }>();
    expect(row?.keep).toBe(1);
    expect(row?.label).toBe("发布前");
    expect(row?.reason).toBe("manual");
  });
});

describe("恢复", () => {
  it("先封存 pre_restore(keep=1) 再覆盖正文：rev+1 / meta_rev+1 / 同一 sync_seq", async () => {
    // 先封 v1，然后把当前稿改成"第二版"
    const v1 = await seal("第一版正文", { reason: "manual" });
    await env.DB.prepare("UPDATE item_bodies SET body = ? WHERE item_id = 'i1'").bind("第二版正文").run();
    await env.DB.prepare(
      "UPDATE items SET content_hash = ?, size_bytes = ?, rev = 2 WHERE id = 'i1'",
    )
      .bind(await sha256Hex("第二版正文"), new TextEncoder().encode("第二版正文").length)
      .run();

    const before = await env.DB.prepare("SELECT rev, meta_rev FROM items WHERE id = 'i1'")
      .first<{ rev: number; meta_rev: number }>();
    const counterBefore = await env.DB.prepare("SELECT sync_seq FROM users WHERE id = 'u1'")
      .first<{ sync_seq: number }>();
    const versionsBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM item_versions").first<{
      n: number;
    }>();

    const result = await restoreVersion(env, "u1", v1.id, NOW + 1000);
    expect(result.restored.id).toBe(v1.id);
    expect(result.sealed?.reason).toBe("pre_restore");
    expect(result.sealed?.keep).toBe(1);

    // 正文回到 v1
    const body = await env.DB.prepare("SELECT body FROM item_bodies WHERE item_id = 'i1'")
      .first<{ body: string }>();
    expect(body?.body).toBe("第一版正文");

    const after = await env.DB.prepare("SELECT rev, meta_rev, sync_seq FROM items WHERE id = 'i1'")
      .first<{ rev: number; meta_rev: number; sync_seq: number }>();
    const counterAfter = await env.DB.prepare("SELECT sync_seq FROM users WHERE id = 'u1'")
      .first<{ sync_seq: number }>();

    expect({ rev: after?.rev, meta_rev: after?.meta_rev }).toEqual({
      rev: (before?.rev ?? 0) + 1,
      meta_rev: (before?.meta_rev ?? 0) + 1,
    });
    // 游标（用户计数器）推进了，且条目上的 sync_seq 与它一致——客户端就是按这个值判断"有没有新东西"
    expect(counterAfter?.sync_seq).toBe((counterBefore?.sync_seq ?? 0) + 1);
    expect(after?.sync_seq).toBe(counterAfter?.sync_seq);

    // 版本表**只多不减**：多出来的是 pre_restore 那一条，被恢复的版本还在
    const versionsAfter = await env.DB.prepare("SELECT COUNT(*) AS n FROM item_versions").first<{
      n: number;
    }>();
    expect(versionsAfter?.n).toBe((versionsBefore?.n ?? 0) + 1);
    const still = await env.DB.prepare("SELECT 1 AS x FROM item_versions WHERE id = ?")
      .bind(v1.id)
      .first();
    expect(still).not.toBeNull();
  });

  it("恢复可被再次撤回：再恢复 pre_restore 那个版本就回到恢复前的内容", async () => {
    const v1 = await seal("第一版正文", { reason: "manual" });
    await env.DB.prepare("UPDATE item_bodies SET body = ? WHERE item_id = 'i1'").bind("第二版正文").run();
    await env.DB.prepare(
      "UPDATE items SET content_hash = ?, size_bytes = ?, rev = 2 WHERE id = 'i1'",
    )
      .bind(await sha256Hex("第二版正文"), new TextEncoder().encode("第二版正文").length)
      .run();

    // 恢复到 v1（此时会封存"第二版正文"为 pre_restore）
    const first = await restoreVersion(env, "u1", v1.id, NOW + 1000);
    const undoId = first.sealed?.id ?? "";
    expect(undoId).not.toBe("");

    // 再恢复那个 pre_restore：内容回到"第二版正文"
    await restoreVersion(env, "u1", undoId, NOW + 2000);
    const body = await env.DB.prepare("SELECT body FROM item_bodies WHERE item_id = 'i1'")
      .first<{ body: string }>();
    expect(body?.body).toBe("第二版正文");
  });

  it("别人的版本恢复不了（归属校验）", async () => {
    const v1 = await seal("我的正文", { reason: "manual" });
    await expect(restoreVersion(env, "u2", v1.id, NOW)).rejects.toThrow();
  });
});

describe("保留与稀疏化", () => {
  it("chooseSparseVictims：24 小时内全留；更早的按档只留每桶最新；keep 与手动版本永不入选", () => {
    const day = DAY_MS;
    const victims = chooseSparseVictims(
      [
        { id: "recent-1", created_at: NOW - 1000, keep: 0, reason: "autosave_idle" },
        { id: "recent-2", created_at: NOW - 2000, keep: 0, reason: "autosave_idle" },
        // 2 天前、同一个 6 小时桶里的两条 → 旧的该删
        { id: "d2-a", created_at: NOW - 2 * day, keep: 0, reason: "autosave_idle" },
        { id: "d2-b", created_at: NOW - 2 * day + 60_000, keep: 0, reason: "autosave_idle" },
        // 手动版本与 keep 版本不入选
        { id: "manual", created_at: NOW - 3 * day, keep: 0, reason: "manual" },
        { id: "kept", created_at: NOW - 3 * day, keep: 1, reason: "autosave_idle" },
      ],
      NOW,
    );

    expect(victims).toContain("d2-a");
    expect(victims).not.toContain("d2-b");
    expect(victims).not.toContain("recent-1");
    expect(victims).not.toContain("recent-2");
    expect(victims).not.toContain("manual");
    expect(victims).not.toContain("kept");
  });

  it("稀疏化删最旧的、把 R2 键登记进 r2_gc_queue，且 keep=1 不动", async () => {
    // 三个版本落在**同一个时间桶**里（8 天前那一档按天分桶）：只有最旧的该被删。
    // 关键：`keep = 1` 与手动版本永不入选。
    const kept = await seal("手动版本", { reason: "manual" }, NOW - 8 * DAY_MS);
    const oldest = await seal("旧内容", { reason: "autosave_idle" }, NOW - 8 * DAY_MS + 60_000);
    const newest = await seal("新内容", { reason: "autosave_idle" }, NOW - 8 * DAY_MS + 120_000);

    const result = await sparsifyItem(
      env,
      "u1",
      "i1",
      { ...DEFAULT_VERSION_TRASH_SETTINGS, versions_keep: 20 },
      NOW,
    );
    expect(result.removed).toBe(1);
    expect(result.reason).toBe("age");

    // 手动（keep=1）与同桶最新的那条都还在；最旧的没了
    for (const id of [kept.id, newest.id]) {
      expect(
        await env.DB.prepare("SELECT 1 AS x FROM item_versions WHERE id = ?").bind(id).first(),
      ).not.toBeNull();
    }
    expect(
      await env.DB.prepare("SELECT 1 AS x FROM item_versions WHERE id = ?").bind(oldest.id).first(),
    ).toBeNull();

    const queued = await env.DB.prepare("SELECT r2_key, reason FROM r2_gc_queue WHERE user_id = 'u1'")
      .all<{ r2_key: string; reason: string }>();
    expect(queued.results).toHaveLength(1);
    expect(queued.results[0]?.reason).toBe("replace");
    expect(queued.results[0]?.r2_key).toBe(versionKey("u1", "i1", oldest.id));
  });

  it("条数上限：24 小时内的版本不受密度分档影响，只按 versions_keep 裁", async () => {
    // 5 个版本都落在 24 小时内（密度分档全留），所以唯一会删它们的就是条数上限
    for (let index = 0; index < 5; index += 1) {
      await seal(`内容 ${index}`, { reason: "autosave_idle" }, NOW - (5 - index) * 60_000);
    }

    const result = await sparsifyItem(
      env,
      "u1",
      "i1",
      { ...DEFAULT_VERSION_TRASH_SETTINGS, versions_keep: 3 },
      NOW,
    );
    expect(result.removed).toBe(2);
    expect(result.reason).toBe("count");

    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM item_versions WHERE user_id = 'u1'").first<{
      n: number;
    }>();
    expect(left?.n).toBe(3);
  });
});

describe("idle 兜底封存", () => {
  it("停编辑超过阈值的条目被补封一次；同一份内容不会重复封", async () => {
    // seedNote 时 last_edit_at = NOW；把"现在"推到 20 分钟后
    const later = NOW + 20 * 60 * 1000;
    const first = await sealIdleVersions(env, later, 10, 3);
    expect(first).toBe(1);

    // 再跑一轮：last_edit_at 早于最新版本 → 不再是候选
    const second = await sealIdleVersions(env, later + 60_000, 10, 3);
    expect(second).toBe(0);
  });

  it("刚编辑过的条目不是候选（不到 idle 阈值）", async () => {
    const sealed = await sealIdleVersions(env, NOW + 60_000, 10, 3);
    expect(sealed).toBe(0);
  });
});

describe("路由与鉴权", () => {
  /** 这个文件里 `beforeEach` 已经建了 u1（种子用户），所以再注册就属于"第二个账号"——要先放开注册 */
  async function openRegistration(): Promise<void> {
    await env.DB.prepare(
      "INSERT INTO app_meta (key, value) VALUES ('registration_open', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
    ).run();
  }

  async function registerUser(username: string): Promise<{ cookie: string; id: string }> {
    seq += 1;
    await openRegistration();
    const bytes = new Uint8Array(32);
    bytes.fill(seq);
    const response = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
      body: JSON.stringify({ username, login_key: base64UrlEncode(bytes) }),
    });
    if (!response.ok) {
      throw new Error(`注册失败：${response.status} ${await response.text()}`);
    }
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
    const body = (await me.json()) as { id: string };
    return { cookie, id: body.id };
  }

  it("列表与取正文都要登录；别人的版本取不到", async () => {
    const v1 = await seal("我的正文", { reason: "manual" });

    const anonymous = await SELF.fetch(`${ORIGIN}/api/versions/${v1.id}`);
    expect(anonymous.status).toBe(401);

    const alice = await registerUser("Alice");
    const list = await SELF.fetch(`${ORIGIN}/api/items/i1/versions`, {
      headers: { Cookie: alice.cookie },
    });
    expect(list.status).toBe(200);
    const page = (await list.json()) as { versions: unknown[] };
    // i1 属于 u1（不是 Alice），所以她的列表里没有它
    expect(page.versions).toHaveLength(0);

    const foreign = await SELF.fetch(`${ORIGIN}/api/versions/${v1.id}`, {
      headers: { Cookie: alice.cookie },
    });
    expect(foreign.status).toBe(404);
  });

  it("keep 开关走路由（保留的版本不参与稀疏化）", async () => {
    const alice = await registerUser("Alice");
    await seedNote(alice.id, "alice-item", "alice 的正文");
    const hash = await sha256Hex("alice 的正文");
    const sealed = await sealVersion(
      env,
      alice.id,
      "alice-item",
      {
        reason: "autosave_idle",
        body: "alice 的正文",
        contentHash: hash,
        title: "标题",
        sizeBytes: 10,
        rev: 1,
      },
      NOW,
    );

    const response = await SELF.fetch(`${ORIGIN}/api/versions/${sealed.version.id}/keep`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Menote": "1",
        Origin: ORIGIN,
        Cookie: alice.cookie,
      },
      body: JSON.stringify({ keep: true }),
    });
    expect(response.status).toBe(200);

    const row = await env.DB.prepare("SELECT keep FROM item_versions WHERE id = ?")
      .bind(sealed.version.id)
      .first<{ keep: number }>();
    expect(row?.keep).toBe(1);
  });
});

/** 让 `itemId` 默认值有个显式来源（测试里多处用到） */
void newUlid;

/**
 * 元数据补丁的两条新规则（2026-09-27 按用户拍板加入）：
 *
 * 1. **单向类型变更**（M4-9「降级为普通笔记」）：只允许 `table → note`；
 *    已经是笔记的、Memo、以及**加密内容**一律拒绝（类型变更会让门禁与正文渲染都对不上）；
 * 2. **降级前封存**（设计 §4.1 的 `pre_convert`）在路由层做——本文件只测服务层判定，
 *    封存那一段由 `routes/items.ts` 的 PATCH 分支负责（另有 versions 用例覆盖封存本身）。
 */
import { base64UrlEncode } from "@menote/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import { freshDatabase } from "./helpers";
import { createItem } from "../src/services/items";
import { patchItemMeta } from "../src/services/item-meta";

const ORIGIN = "https://menote.test";
const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

let deviceSeq = 1;

function loginKey(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return base64UrlEncode(bytes);
}

/** 注册一个用户并取回它的 id（`createItem` 的 `sync_seq` 取自 `users` 行，所以必须先有用户） */
async function registerUser(username: string): Promise<string> {
  deviceSeq += 1;
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
    body: JSON.stringify({ username, login_key: loginKey(deviceSeq) }),
  });
  const cookie = ((res.headers.get("set-cookie") ?? "").split(";")[0] ?? "").trim();
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
  const body = (await me.json()) as { id: string };
  return body.id;
}

/** 造一行条目：走 `createItem` 服务（字段与约束由它保证），再按需补加密标记 */
async function seedItem(
  userId: string,
  id: string,
  type: "note" | "table" | "memo",
  extra: { enc_self?: number; in_enc_space?: number } = {},
): Promise<void> {
  await createItem(
    env.DB,
    userId,
    {
      id,
      type,
      // Memo 没有独立标题（`createItem` 会拒），其它类型必须有标题
      title: type === "memo" ? null : "标题",
      folderId: null,
      tags: [],
      // Memo 必须带 `memo_at`（表上有 CHECK：`type <> 'memo' OR memo_at IS NOT NULL`）
      memoAt: type === "memo" ? NOW : null,
      isTask: 0,
      taskStatus: null,
      taskDue: null,
      taskPriority: null,
      contentHash: "h",
      body: "正文",
      deviceLabel: null,
    },
    NOW,
  );
  if (extra.enc_self || extra.in_enc_space) {
    await env.DB.prepare("UPDATE items SET enc_self = ?, in_enc_space = ? WHERE id = ?")
      .bind(extra.enc_self ?? 0, extra.in_enc_space ?? 0, id)
      .run();
  }
}

async function typeOf(id: string): Promise<string | undefined> {
  const row = await env.DB.prepare("SELECT type FROM items WHERE id = ?")
    .bind(id)
    .first<{ type: string }>();
  return row?.type;
}

beforeEach(async () => {
  await freshDatabase();
});

describe("单向类型变更（table → note）", () => {
  it("表格可以降级成笔记：`type` 真的改了，`meta_rev` 进一位", async () => {
    const user = await registerUser("Alice");
    const id = "01J000000000000000000000B1";
    await seedItem(user, id, "table");

    const result = await patchItemMeta(env.DB, user, id, { base_meta_rev: 1, type: "note" }, NOW);

    expect(result.meta_rev).toBe(2);
    expect(await typeOf(id)).toBe("note");
  });

  it("**已经是笔记的条目**不能再发 `type`（契约只接受降级，不接受反向改类型）", async () => {
    const user = await registerUser("Alice");
    const id = "01J000000000000000000000B2";
    await seedItem(user, id, "note");

    await expect(
      patchItemMeta(env.DB, user, id, { base_meta_rev: 1, type: "note" }, NOW),
    ).rejects.toThrow(/只有表格可以降级/);
    expect(await typeOf(id)).toBe("note");
  });

  it("Memo 不能降级（它压根不是表格）", async () => {
    const user = await registerUser("Alice");
    const id = "01J000000000000000000000B3";
    await seedItem(user, id, "memo");

    await expect(
      patchItemMeta(env.DB, user, id, { base_meta_rev: 1, type: "note" }, NOW),
    ).rejects.toThrow(/只有表格可以降级/);
  });

  it("**加密内容**不能改类型（单篇加密与加密空间都拒绝）", async () => {
    const user = await registerUser("Alice");
    const encrypted = "01J000000000000000000000B4";
    const inSpace = "01J000000000000000000000B5";
    await seedItem(user, encrypted, "table", { enc_self: 1 });
    await seedItem(user, inSpace, "table", { in_enc_space: 1 });

    for (const id of [encrypted, inSpace]) {
      await expect(
        patchItemMeta(env.DB, user, id, { base_meta_rev: 1, type: "note" }, NOW),
      ).rejects.toThrow(/加密内容不能改类型/);
      expect(await typeOf(id)).toBe("table");
    }
  });
});

/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * MCP 写类工具的**权限位与可见性**（M6 批 3）。
 *
 * 从 `mcp-write.test.ts` 拆出来是因为那个文件已经顶到 500 行预算，而这一组用例的
 * 关注点本来就与那六个工具的机制不同：那边验"乐观锁 / 幂等 / 封存 / 审计"怎么工作，
 * 这边验"**够不着**"——没权限位的令牌动不了手，范围外的条目连看都看不到。
 *
 * 三条底线（架构 §十三-2 隔离 + 设计 §六-8）：
 * - 四个权限位**逐个**生效，只读令牌一个写工具都调不动；
 * - 令牌范围外的条目，**写类工具同样读不到**（只读侧的那条在 `mcp-read.test.ts`）；
 * - MCP **不能改变内容的加密归属**——移入加密空间被拒。
 */
import { MCP_PERM_READ, newUlid } from "@menote/shared";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { call, failure, makeFolder, makeToken, openRegistration, registerUser, seedItem } from "./mcp-helpers";
import { freshDatabase } from "./helpers";

beforeEach(async () => {
  await freshDatabase();
});

describe("权限位（批 3）", () => {
  it("只读令牌调六个写工具：全部被权限位挡住，且原数据一个字不动", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret: readOnly } = await makeToken(cookie, { name: "只读", perms: MCP_PERM_READ });
    const id = await seedItem(userId, newUlid(), "正文", { title: "甲" });

    for (const [tool, args] of [
      ["create_item", { type: "note", title: "x", content: "y", operation_id: "p" }],
      ["append_to_item", { id, text: "y", operation_id: "p" }],
      ["edit_item", { id, expected_rev: 1, mode: "replace_all", content: "y" }],
      ["edit_table_rows", { id, expected_rev: 1, updates: { r1: { a: "b" } } }],
      ["organize_item", { id, expected_meta_rev: 1, title: "y" }],
      ["trash_item", { id, expected_rev: 1, operation_id: "p" }],
    ] as const) {
      const message = failure((await call(readOnly, tool, args as Record<string, unknown>)).body);
      // 提示里要带上"缺哪个权限"——agent 读得懂才会让用户去改令牌
      expect(message, `${tool} 应当被权限位挡住`).toContain("权限");
    }

    const row = await env.DB.prepare("SELECT rev, meta_rev, deleted_at FROM items WHERE id = ?").bind(id).first<{
      rev: number;
      meta_rev: number;
      deleted_at: number | null;
    }>();
    expect(row).toMatchObject({ rev: 1, meta_rev: 1, deleted_at: null });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM items").first<{ n: number }>()).toMatchObject({ n: 1 });
  });
});

describe("范围（批 3）", () => {
  it("范围外的条目：写类工具读不到也改不动，原条目零变化", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const inScope = await makeFolder(userId, "范围内");
    const outOfScope = await makeFolder(userId, "范围外");
    const { secret } = await makeToken(cookie, { folder_scope: [inScope] });
    const outside = await seedItem(userId, newUlid(), "正文", { folderId: outOfScope, title: "范围外" });

    for (const args of [
      { id: outside, text: "y", operation_id: "o" },
      { id: outside, expected_rev: 1, mode: "replace_all", content: "y" },
      { id: outside, expected_rev: 1, operation_id: "o2" },
    ]) {
      const tool = "text" in args ? "append_to_item" : "expected_rev" in args && "content" in args ? "edit_item" : "trash_item";
      expect(failure((await call(secret, tool, args as Record<string, unknown>)).body)).toContain("不在可见范围");
    }

    const row = await env.DB.prepare("SELECT rev, meta_rev, deleted_at FROM items WHERE id = ?").bind(outside).first<{
      rev: number;
      meta_rev: number;
      deleted_at: number | null;
    }>();
    expect(row).toMatchObject({ rev: 1, meta_rev: 1, deleted_at: null });
  });

  it("限定文件夹的令牌不能把内容移到范围外（含根目录）", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const inScope = await makeFolder(userId, "范围内");
    const outOfScope = await makeFolder(userId, "范围外");
    const { secret } = await makeToken(cookie, { folder_scope: [inScope] });
    const inside = await seedItem(userId, newUlid(), "正文", { folderId: inScope, title: "范围内" });

    expect(failure((await call(secret, "organize_item", { id: inside, expected_meta_rev: 1, folder_id: outOfScope })).body)).toContain(
      "范围",
    );
    // 移出范围的方式之一就是"挪到根目录"，那也是移出
    expect(failure((await call(secret, "organize_item", { id: inside, expected_meta_rev: 1, folder_id: null })).body)).toContain(
      "根目录",
    );
  });
});

describe("隐私归属（批 3）", () => {
  it("MCP 不能把内容移入加密空间：看不见加密内容，就不该有改变加密归属的能力", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "正文", { title: "甲" });
    const space = await env.DB.prepare("SELECT id FROM folders WHERE user_id = ? AND is_enc_space = 1")
      .bind(userId)
      .first<{ id: string }>();

    expect(failure((await call(secret, "organize_item", { id, expected_meta_rev: 1, folder_id: space?.id })).body)).toContain(
      "加密空间",
    );
    const row = await env.DB.prepare("SELECT in_enc_space, folder_id FROM items WHERE id = ?").bind(id).first<{
      in_enc_space: number;
      folder_id: string | null;
    }>();
    expect(row?.in_enc_space).toBe(0);
    expect(row?.folder_id).toBeNull();
  });

  it("单篇加密的条目对 MCP 完全不可见（读不到，自然也改不动）", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const secretItem = await seedItem(userId, newUlid(), "加密正文", { title: "加密", encSelf: 1 });

    expect(failure((await call(secret, "edit_item", { id: secretItem, expected_rev: 1, mode: "replace_all", content: "y" })).body)).toContain(
      "不在可见范围",
    );
    const body = await env.DB.prepare("SELECT body FROM item_bodies WHERE item_id = ?").bind(secretItem).first<{ body: string }>();
    expect(body?.body).toBe("加密正文");
  });

  it("跨租户：owner 的令牌动不了家人的条目", async () => {
    const { cookie } = await registerUser("owner1", 1);
    await openRegistration(cookie);
    const other = await registerUser("family", 2);
    const theirItem = await seedItem(other.userId, newUlid(), "别人的正文", { title: "他们的" });

    const { secret } = await makeToken(cookie);
    expect(
      failure((await call(secret, "edit_item", { id: theirItem, expected_rev: 1, mode: "replace_all", content: "y" })).body),
    ).toContain("不在可见范围");
    const body = await env.DB.prepare("SELECT body FROM item_bodies WHERE item_id = ?").bind(theirItem).first<{ body: string }>();
    expect(body?.body).toBe("别人的正文");
  });
});

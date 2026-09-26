/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 服务端搜索兜底（M2-6）：`GET /api/search`。
 *
 * 验四件事：
 * 1. **租户与隐私**：别的用户的条目搜不到；加密条目（`enc_self` / `in_enc_space`）搜不到；
 * 2. **`instr()` 语义**：输入里的 `%` `_` 不当通配符用（这是"不用 `LIKE`"的收益之一）；
 * 3. **筛选**：类型 / 文件夹（含根目录）/ 标签 / 时间；
 * 4. 参数与鉴权的边界：未登录 401、空查询 400。
 *
 * 数据直接用 SQL 播（不经过前端同步链路）：这里要验的是搜索本身，注册/写入链路的正确性由
 * `auth.test.ts` / `items.test.ts` 各自负责。
 */
import { newUlid, base64UrlEncode } from "@menote/shared";
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { buildSearchSql } from "../src/services/search";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";

interface SeedInput {
  id?: string;
  type?: "note" | "table" | "memo";
  title?: string | null;
  tags?: string[];
  body: string;
  folderId?: string | null;
  updatedAt?: number;
  encSelf?: number;
  inEncSpace?: number;
}

/** 播一条条目（含正文）；不校验业务规则，只保证满足表上的 NOT NULL / CHECK */
async function seedItem(userId: string, input: SeedInput): Promise<string> {
  const id = input.id ?? newUlid();
  const now = input.updatedAt ?? Date.now();
  const type = input.type ?? "note";
  const title = type === "memo" ? null : (input.title ?? "");

  await env.DB.prepare(
    "INSERT INTO items (id, user_id, type, folder_id, title, enc_self, in_enc_space, size_bytes, content_hash, tags, memo_at, is_task, pinned, starred, rev, meta_rev, sync_seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'h', ?, ?, 0, 0, 0, 1, 1, 1, ?, ?)",
  )
    .bind(
      id,
      userId,
      type,
      input.folderId ?? null,
      title,
      input.encSelf ?? 0,
      input.inEncSpace ?? 0,
      input.body.length,
      JSON.stringify(input.tags ?? []),
      type === "memo" ? now : null,
      now,
      now,
    )
    .run();

  await env.DB.prepare("INSERT INTO item_bodies (item_id, body) VALUES (?, ?)")
    .bind(id, input.body)
    .run();

  return id;
}

async function registerOwner(username: string): Promise<{ cookie: string; id: string }> {
  const key = new Uint8Array(32);
  key.fill(7);
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

interface SearchRow {
  id: string;
  tags: string[];
  snippet: string;
}

async function search(
  cookie: string,
  params: Record<string, string>,
): Promise<{ status: number; results: SearchRow[] }> {
  const res = await SELF.fetch(
    `${ORIGIN}/api/search?${new URLSearchParams(params).toString()}`,
    { headers: { Cookie: cookie } },
  );
  const body = (await res.json()) as { results?: SearchRow[] };
  return { status: res.status, results: body.results ?? [] };
}

let alice: { cookie: string; id: string };

beforeEach(async () => {
  await freshDatabase();
  alice = await registerOwner("alice");
});

describe("SQL 组装（不依赖 Worker）", () => {
  it("条件里始终带 user_id、隐私过滤与 instr，且不用 LIKE", () => {
    const { sql, params } = buildSearchSql("u1", {
      text: "方案",
      type: "all",
      folderId: undefined,
      tag: null,
      from: null,
      to: null,
      limit: 50,
    });

    expect(sql).toContain("i.user_id = ?");
    expect(sql).toContain("i.deleted_at IS NULL");
    expect(sql).toContain("i.enc_self = 0");
    expect(sql).toContain("i.in_enc_space = 0");
    expect(sql).toContain("instr(lower(");
    expect(sql).not.toContain("LIKE");
    expect(params).toContain("u1");
  });

  it("筛选条件按需追加：类型 / 根目录 / 标签（带引号）/ 时间", () => {
    const { sql, params } = buildSearchSql("u1", {
      text: "a",
      type: "note",
      folderId: null,
      tag: "工作",
      from: 100,
      to: 200,
      limit: 10,
    });

    expect(sql).toContain("i.type = ?");
    expect(sql).toContain("i.folder_id IS NULL");
    expect(sql).toContain("instr(i.tags, ?) > 0");
    expect(sql).toContain("i.updated_at >= ?");
    expect(sql).toContain("i.updated_at <= ?");
    // 标签带引号匹配，避免 "工作" 命中 "工作日志"
    expect(params).toContain('"工作"');
  });
});

describe("GET /api/search", () => {
  it("未登录 401；空查询 422（invalid 的既有映射）", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/search?q=方案`)).status).toBe(401);

    const empty = await SELF.fetch(`${ORIGIN}/api/search?q=%20`, {
      headers: { Cookie: alice.cookie },
    });
    expect(empty.status).toBe(422);
  });

  it("按标题 / 正文 / 标签命中，并给出正文片段", async () => {
    await seedItem(alice.id, { title: "会议记录", body: "今天我们讨论了发布方案与排期", tags: ["工作"] });
    await seedItem(alice.id, { title: "购物清单", body: "牛奶与鸡蛋", tags: ["生活"] });

    expect((await search(alice.cookie, { q: "会议" })).results).toHaveLength(1);

    const byBody = await search(alice.cookie, { q: "发布方案" });
    expect(byBody.results).toHaveLength(1);
    expect(byBody.results[0]?.snippet).toContain("发布方案");

    const byTag = await search(alice.cookie, { q: "工作" });
    expect(byTag.results).toHaveLength(1);
    expect(byTag.results[0]?.tags).toEqual(["工作"]);
  });

  it("搜不到别的用户的条目（多租户隔离）", async () => {
    await seedItem("someone-else", { title: "别人的秘密方案", body: "别人的内容" });
    expect((await search(alice.cookie, { q: "别人的秘密方案" })).results).toEqual([]);
  });

  it("加密条目不进结果（与客户端 isSearchVisible 同源）", async () => {
    await seedItem(alice.id, { title: "单篇加密", body: "加密内容方案甲", encSelf: 1 });
    await seedItem(alice.id, { title: "空间内", body: "加密内容方案乙", inEncSpace: 1 });

    expect((await search(alice.cookie, { q: "加密内容方案" })).results).toEqual([]);
  });

  it("输入里的 % 与 _ 不是通配符（instr 语义）", async () => {
    await seedItem(alice.id, { title: "百分比 100%", body: "a_b 下划线" });

    expect((await search(alice.cookie, { q: "100%" })).results).toHaveLength(1);
    expect((await search(alice.cookie, { q: "a_b" })).results).toHaveLength(1);
    // 若被当通配符，"1%0" 会命中 "100%"；instr 语义下不会
    expect((await search(alice.cookie, { q: "1%0" })).results).toEqual([]);
  });

  it("按类型 / 标签 / 时间筛选", async () => {
    const note = await seedItem(alice.id, {
      title: "笔记里的方案",
      body: "共同词 方案",
      tags: ["工作"],
      updatedAt: 1_000,
    });
    const memo = await seedItem(alice.id, {
      type: "memo",
      body: "Memo 里的方案 共同词",
      tags: ["生活"],
      updatedAt: 5_000,
    });

    expect((await search(alice.cookie, { q: "方案", type: "memo" })).results.map((r) => r.id)).toEqual([
      memo,
    ]);
    expect((await search(alice.cookie, { q: "方案", type: "note" })).results.map((r) => r.id)).toEqual([
      note,
    ]);
    expect((await search(alice.cookie, { q: "方案", tag: "生活" })).results.map((r) => r.id)).toEqual([
      memo,
    ]);
    expect((await search(alice.cookie, { q: "方案", from: "2000" })).results.map((r) => r.id)).toEqual([
      memo,
    ]);
    expect((await search(alice.cookie, { q: "方案", to: "2000" })).results.map((r) => r.id)).toEqual([
      note,
    ]);
  });

  it("根目录筛选用 folder=root；指定文件夹按 id", async () => {
    const root = await seedItem(alice.id, { title: "根目录方案", body: "共同词 方案" });
    const folderId = newUlid();
    await env.DB.prepare(
      "INSERT INTO folders (id, user_id, parent_id, is_enc_space, in_enc_space, name, depth, position, meta_rev, sync_seq, created_at, updated_at) VALUES (?, ?, NULL, 0, 0, '学习', 1, 0, 1, 1, 1, 1)",
    )
      .bind(folderId, alice.id)
      .run();
    const inFolder = await seedItem(alice.id, { title: "夹内方案", body: "共同词 方案", folderId });

    expect((await search(alice.cookie, { q: "方案", folder: "root" })).results.map((r) => r.id)).toEqual([
      root,
    ]);
    expect((await search(alice.cookie, { q: "方案", folder: folderId })).results.map((r) => r.id)).toEqual([
      inFolder,
    ]);
  });
});

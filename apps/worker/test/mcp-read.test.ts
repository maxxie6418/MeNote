/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * MCP 端点与只读工具（M6 批 2）的集成用例：走 `POST /mcp` 与 `POST /mcp/k/<令牌>`。
 *
 * 盯的是设计稿 §三-3 处理顺序、§四可见性不变式、§六-2 五个只读工具这几条底线：
 * - **鉴权**：令牌无效 / 已撤销 / 已过期一律 401 且**文案相同**（不区分原因＝防探测）；
 *   撤销后下一次调用立刻失效；URL 方式受 `allow_url` 约束；
 * - **限速**：按分钟窗口计数，超了 429 + JSON-RPC `-32029`；跨窗口自动重置；
 * - **可见性 I1**：单篇加密 / 加密空间内 / 回收站 / 范围外 / 未勾 Memo —— 五类一律读不到，
 *   且**与真的不存在返回完全相同的响应体**（不泄露存在性）；
 * - **有界读取**：正文默认 8000 字符、上限 20000，超出给 `next_cursor`；
 * - **业务失败走 `isError: true`** 而不是 JSON-RPC error（设计 §5.2）。
 */
import { base64UrlEncode, newUlid, type McpTokenRecord } from "@menote/shared";
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";

function sessionHeaders(cookie?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Menote": "1",
    Origin: ORIGIN,
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

function loginKey(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return base64UrlEncode(bytes);
}

async function registerUser(username: string, seed: number): Promise<{ cookie: string; userId: string }> {
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: sessionHeaders(),
    body: JSON.stringify({ username, login_key: loginKey(seed) }),
  });
  const cookie = (res.headers.get("set-cookie")?.split(";")[0] ?? "").trim();
  const me = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: sessionHeaders(cookie) });
  const { id: userId } = (await me.json()) as { id: string };
  return { cookie, userId };
}

async function openRegistration(cookie: string): Promise<void> {
  await SELF.fetch(`${ORIGIN}/api/admin/registration`, {
    method: "PUT",
    headers: sessionHeaders(cookie),
    body: JSON.stringify({ open: true }),
  });
}

/** 建令牌并返回完整串（批 1 的接口） */
async function makeToken(
  cookie: string,
  body: Record<string, unknown> = {},
): Promise<{ secret: string; token: McpTokenRecord }> {
  const res = await SELF.fetch(`${ORIGIN}/api/mcp/tokens`, {
    method: "POST",
    headers: sessionHeaders(cookie),
    body: JSON.stringify({ name: "测试", perms: 1, ...body }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { secret: string; token: McpTokenRecord };
}

interface RpcResult {
  result?: { content?: Array<{ text: string }>; structuredContent?: unknown; isError?: boolean };
  error?: { code: number; message: string };
  jsonrpc?: string;
  id?: string | number | null;
}

/** 一次 `tools/call`，返回解析后的响应 */
async function call(
  secret: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<{ status: number; body: RpcResult }> {
  const res = await SELF.fetch(`${ORIGIN}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  return { status: res.status, body: (await res.json()) as RpcResult };
}

/** 一次 `tools/call` 的业务载荷（`structuredContent` 优先，回落到解析 text） */
function payload(rpc: RpcResult): Record<string, unknown> {
  const structured = rpc.result?.structuredContent;
  if (structured !== undefined) return structured as Record<string, unknown>;
  const text = rpc.result?.content?.[0]?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

async function rpc(
  secret: string,
  body: Record<string, unknown>,
  path = "/mcp",
): Promise<{ status: number; body: RpcResult }> {
  const res = await SELF.fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as RpcResult };
}

/** 直接造一条条目（绕过同步端点，测试里更快也更好控） */
async function seedItem(
  userId: string,
  id: string,
  body: string,
  flags: {
    encSelf?: number;
    inEncSpace?: number;
    deleted?: boolean;
    folderId?: string | null;
    type?: string;
    title?: string | null;
    tags?: string;
    updatedAt?: number;
  } = {},
): Promise<string> {
  const now = flags.updatedAt ?? Date.now();
  const bytes = new TextEncoder().encode(body).length;
  const type = flags.type ?? "note";
  // Memo 有两条建表 CHECK 约束：必须有时间戳、不能有标题、不能挂文件夹
  const memoAt = type === "memo" ? now : null;
  const title = flags.title === undefined ? (type === "memo" ? null : "标题") : flags.title;
  await env.DB.prepare(
    `INSERT INTO items (id, user_id, type, folder_id, title, enc_self, in_enc_space, size_bytes, content_hash, tags, memo_at, is_task, task_status, task_due, task_priority, pinned, starred, rev, meta_rev, sync_seq, created_at, updated_at, last_edit_at, last_device, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, 0, 0, 1, 1, 1, ?, ?, ?, NULL, ?)`,
  )
    .bind(
      id,
      userId,
      type,
      type === "memo" ? null : (flags.folderId ?? null),
      title,
      flags.encSelf ?? 0,
      flags.inEncSpace ?? 0,
      bytes,
      "h" + id,
      flags.tags ?? "[]",
      memoAt,
      now,
      now,
      now,
      flags.deleted ? now : null,
    )
    .run();
  await env.DB.prepare("INSERT INTO item_bodies (item_id, body) VALUES (?, ?)").bind(id, body).run();
  return id;
}

async function makeFolder(userId: string, name: string, parentId: string | null = null): Promise<string> {
  const id = newUlid();
  await env.DB.prepare(
    "INSERT INTO folders (id, user_id, parent_id, is_enc_space, in_enc_space, name, depth, position, meta_rev, sync_seq, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?, 0, 1, 0, ?, ?)",
  )
    .bind(id, userId, parentId, name, parentId === null ? 1 : 2, Date.now(), Date.now())
    .run();
  return id;
}

beforeEach(async () => {
  await freshDatabase();
});

describe("MCP 协议层（批 2）", () => {
  it("GET /mcp 一律 405（不做 SSE）", async () => {
    const res = await SELF.fetch(`${ORIGIN}/mcp`);
    expect(res.status).toBe(405);
  });

  it("initialize / ping / notifications/initialized", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);

    const init = await rpc(secret, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(init.status).toBe(200);
    const result = init.body.result as Record<string, unknown>;
    expect(result.protocolVersion).toBeTruthy();
    expect((result.serverInfo as { name: string }).name).toBe("Menote");
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });

    const ping = await rpc(secret, { jsonrpc: "2.0", id: 2, method: "ping" });
    expect(ping.body.result).toEqual({});

    // 通知：202 空体、不回 result
    const res = await SELF.fetch(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("tools/list 出 5 个只读工具，且名字都在定稿的 11 个之内", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const list = await rpc(secret, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = (list.body.result as { tools: Array<{ name: string; inputSchema: unknown }> }).tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "list_folders",
      "list_items",
      "list_versions",
      "read_item",
      "search",
    ]);
    for (const tool of tools) expect(tool.inputSchema).toBeTruthy();
  });

  it("协议层错误：未知方法 -32601、坏消息 -32600", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    expect((await rpc(secret, { jsonrpc: "2.0", id: 1, method: "nope" })).body.error?.code).toBe(-32601);
    expect((await rpc(secret, { id: 1, method: "ping" })).body.error?.code).toBe(-32600);
  });

  it("没注册的写类工具：报「没有这个工具」而不是「权限不足」", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    // 批 2 只注册了只读工具——那枚令牌确实没有这个能力，说「没有」比说「没权限」准确
    const res = await call(secret, "edit_item", { id: "x" });
    expect(res.body.error?.code).toBe(-32601);
  });
});

describe("MCP 鉴权与限速（批 2）", () => {
  it("令牌无效 / 已撤销 / 已过期：401 且文案相同（不区分原因）", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const bogus = await SELF.fetch(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer mn_不是真令牌" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    const bogusBody = (await bogus.json()) as { message: string };
    expect(bogus.status).toBe(401);

    const revoked = await makeToken(cookie, { name: "撤销" });
    await SELF.fetch(`${ORIGIN}/api/mcp/tokens/${revoked.token.id}`, {
      method: "DELETE",
      headers: sessionHeaders(cookie),
    });
    const afterRevoke = await SELF.fetch(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${revoked.secret}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    const revokeBody = (await afterRevoke.json()) as { message: string };
    expect(afterRevoke.status).toBe(401);
    // 文案一致＝探测者分不出"曾经有效过"
    expect(revokeBody.message).toBe(bogusBody.message);

    const expired = await makeToken(cookie, { name: "过期", expires_in: 60_000 });
    await env.DB.prepare("UPDATE api_tokens SET expires_at = 1 WHERE id = ?")
      .bind(expired.token.id)
      .run();
    const afterExpire = await SELF.fetch(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${expired.secret}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(afterExpire.status).toBe(401);
    expect(((await afterExpire.json()) as { message: string }).message).toBe(bogusBody.message);
  });

  it("撤销后下一次调用立刻失效（不靠缓存）", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const { secret, token } = await makeToken(cookie);
    expect((await rpc(secret, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(200);
    await SELF.fetch(`${ORIGIN}/api/mcp/tokens/${token.id}`, {
      method: "DELETE",
      headers: sessionHeaders(cookie),
    });
    expect((await rpc(secret, { jsonrpc: "2.0", id: 2, method: "ping" })).status).toBe(401);
  });

  it("URL 方式受 allow_url 约束；勾过之后与请求头方式结果完全一致", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const off = await makeToken(cookie, { name: "不许 URL" });
    expect((await rpc(off.secret, { jsonrpc: "2.0", id: 1, method: "ping" }, `/mcp/k/${off.secret}`)).status).toBe(401);

    const on = await makeToken(cookie, { name: "允许 URL", allow_url: 1 });
    const viaHeader = await rpc(on.secret, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const viaUrl = await rpc(on.secret, { jsonrpc: "2.0", id: 1, method: "tools/list" }, `/mcp/k/${on.secret}`);
    expect(viaUrl.status).toBe(200);
    // 往返一致：两种传输方式拿到的东西**逐字节相同**
    expect(JSON.stringify(viaUrl.body)).toBe(JSON.stringify(viaHeader.body));
  });

  it("限速：超过 rate_per_min 后 429 + -32029，跨窗口自动重置", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const { secret, token } = await makeToken(cookie, { rate_per_min: 2 });
    await rpc(secret, { jsonrpc: "2.0", id: 1, method: "ping" });
    await rpc(secret, { jsonrpc: "2.0", id: 2, method: "ping" });
    const third = await rpc(secret, { jsonrpc: "2.0", id: 3, method: "ping" });
    expect(third.status).toBe(429);
    expect(third.body.error?.code).toBe(-32029);

    // 把窗口推回过去 → 计数应重置
    await env.DB.prepare("UPDATE api_tokens SET rate_window_start = 1 WHERE id = ?")
      .bind(token.id)
      .run();
    expect((await rpc(secret, { jsonrpc: "2.0", id: 4, method: "ping" })).status).toBe(200);
  });

  it("限速只数调用，不数协议噪声（ping 也算一次——它是真实调用）", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const { secret, token } = await makeToken(cookie, { rate_per_min: 1 });
    expect((await rpc(secret, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(200);
    const row = await env.DB.prepare("SELECT rate_call_count FROM api_tokens WHERE id = ?")
      .bind(token.id)
      .first<{ rate_call_count: number }>();
    expect(row?.rate_call_count).toBe(1);
    expect((await rpc(secret, { jsonrpc: "2.0", id: 2, method: "ping" })).status).toBe(429);
  });
});

describe("MCP 只读工具（批 2）", () => {
  it("search：命中正文片段、返回 rev、片段 200 字符", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    await seedItem(userId, newUlid(), `# 标题\n\n这里有独特标记 XQR7。${"尾巴".repeat(200)}`, { title: "带标记" });

    const res = await call(secret, "search", { query: "XQR7" });
    const data = payload(res.body);
    const results = data.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("带标记");
    expect(results[0]?.rev).toBe(1);
    expect(String(results[0]?.snippet)).toContain("XQR7");
    // 片段 200 字符封顶（不是界面的 120）
    expect(String(results[0]?.snippet).length).toBeLessThanOrEqual(200);
  });

  it("search：空 query 走 isError 而不是协议错误（agent 能自己纠正）", async () => {
    const { cookie } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const res = await call(secret, "search", { query: "   " });
    expect(res.status).toBe(200);
    expect(res.body.result?.isError).toBe(true);
    expect(String(payload(res.body).error)).toContain("query");
  });

  it("list_folders：不含加密空间节点，计数不含隐私内容", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const normal = await makeFolder(userId, "普通");
    await makeFolder(userId, "子", normal);
    await seedItem(userId, newUlid(), "a", { folderId: normal, title: "可见" });
    await seedItem(userId, newUlid(), "b", { folderId: normal, title: "加密", encSelf: 1 });
    await seedItem(userId, newUlid(), "c", { folderId: normal, title: "已删", deleted: true });
    await seedItem(userId, newUlid(), "d", { folderId: normal, title: "空间内", inEncSpace: 1 });

    const res = await call(secret, "list_folders", {});
    const folders = payload(res.body).folders as Array<{ id: string; name: string; item_count: number }>;
    const names = folders.map((f) => f.name);
    // 加密空间节点不出现在树里
    expect(names).not.toContain("加密空间");
    expect(names).toEqual(["普通", "子"]);
    // 计数只算可见的 1 条：加密的、删掉的、空间内的都不计（M17-03）
    expect(folders.find((f) => f.name === "普通")?.item_count).toBe(1);
  });

  it("list_folders：标签使用次数只数可见条目", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    await seedItem(userId, newUlid(), "a", { tags: JSON.stringify(["工作", "dev"]) });
    await seedItem(userId, newUlid(), "b", { tags: JSON.stringify(["工作"]), encSelf: 1 });

    const tags = payload((await call(secret, "list_folders", {})).body).tags as Array<{
      name: string;
      count: number;
    }>;
    // "工作" 出现 2 次，但加密那条不计
    expect(tags.find((t) => t.name === "工作")?.count).toBe(1);
    expect(tags.find((t) => t.name === "dev")?.count).toBe(1);
  });

  it("list_items：只给元数据，不含正文", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    await seedItem(userId, newUlid(), "机密正文标记ZZZ", { title: "甲" });
    await seedItem(userId, newUlid(), "另一条", { title: "乙", type: "table" });

    const items = payload((await call(secret, "list_items", {})).body).items as Array<
      Record<string, unknown>
    >;
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.title).sort()).toEqual(["乙", "甲"]);
    expect(JSON.stringify(items)).not.toContain("ZZZ");
    expect(items.find((i) => i.title === "甲")?.rev).toBe(1);
  });

  it("list_items：按类型 / 标签 / 清单状态筛选", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    await seedItem(userId, newUlid(), "a", { title: "笔记", type: "note" });
    await seedItem(userId, newUlid(), "b", { title: "表格", type: "table", tags: JSON.stringify(["工作"]) });
    await seedItem(userId, newUlid(), "c", { title: "别的工作", tags: JSON.stringify(["工作日志"]) });

    const byType = payload((await call(secret, "list_items", { type: "table" })).body).items as Array<
      Record<string, unknown>
    >;
    expect(byType).toHaveLength(1);
    expect(byType[0]?.title).toBe("表格");

    // 带引号匹配：「工作」不该命中「工作日志」
    const byTag = payload((await call(secret, "list_items", { tag: "工作" })).body).items as Array<
      Record<string, unknown>
    >;
    expect(byTag).toHaveLength(1);
    expect(byTag[0]?.title).toBe("表格");
  });

  it("read_item：区间读 + 游标续读到文末", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "0123456789", { title: "十位" });

    const first = payload((await call(secret, "read_item", { id, max_chars: 4 })).body);
    expect(first.text).toBe("0123");
    expect(first.total_chars).toBe(10);
    expect(first.next_cursor).toBeTruthy();

    const second = payload(
      (await call(secret, "read_item", { id, max_chars: 4, cursor: first.next_cursor })).body,
    );
    expect(second.text).toBe("4567");

    const last = payload(
      (await call(secret, "read_item", { id, max_chars: 100, cursor: second.next_cursor })).body,
    );
    expect(last.text).toBe("89");
    expect(last.next_cursor).toBeNull();
  });

  it("read_item：max_chars 封顶 20000（防止一次灌爆上下文）", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const id = await seedItem(userId, newUlid(), "x".repeat(30_000), { title: "很大" });
    const data = payload((await call(secret, "read_item", { id, max_chars: 999_999 })).body);
    expect(String(data.text).length).toBe(20_000);
    expect(data.next_cursor).toBeTruthy();
  });

  it("read_item：按小节读；同名小节如实报 ambiguous", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const body = ["# T", "", "## 甲", "", "甲正文", "", "## 乙", "", "乙正文", "", "## 甲", "", "又一个甲"].join(
      "\n",
    );
    const id = await seedItem(userId, newUlid(), body, { title: "多节" });

    const one = payload((await call(secret, "read_item", { id, section: "乙" })).body);
    expect(String(one.text)).toContain("乙正文");
    expect(String(one.text)).not.toContain("甲正文");
    expect(one.ambiguous).toBe(false);

    const dup = payload((await call(secret, "read_item", { id, section: "甲" })).body);
    expect(dup.ambiguous).toBe(true);
    expect(String(dup.text)).toContain("甲正文");

    const missing = await call(secret, "read_item", { id, section: "不存在" });
    expect(missing.body.result?.isError).toBe(true);
    expect(String(payload(missing.body).error)).toContain("没有找到");
  });

  it("list_versions：可见条目能列版本；不可见条目与不存在同形", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    const { secret } = await makeToken(cookie);
    const visible = newUlid();
    await seedItem(userId, visible, "a", { title: "可见" });
    const secretItem = newUlid();
    await seedItem(userId, secretItem, "b", { title: "加密", encSelf: 1 });

    const none = payload((await call(secret, "list_versions", { id: visible })).body);
    expect(Array.isArray(none.versions)).toBe(true);

    const hidden = await call(secret, "list_versions", { id: secretItem });
    const missing = await call(secret, "list_versions", { id: newUlid() });
    // 关键：不可见与不存在给出**完全一样**的响应
    expect(hidden.body.result?.isError).toBe(true);
    expect(missing.body.result?.isError).toBe(true);
    expect(JSON.stringify(hidden.body)).toBe(JSON.stringify(missing.body));
  });
});

describe("MCP 可见性不变式 I1（批 2）", () => {
  it("五类不可见：单篇加密 / 空间内 / 回收站 / 范围外 / 未勾 Memo", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);

    const inScope = await makeFolder(userId, "范围内");
    await makeFolder(userId, "子目录", inScope);
    const outOfScope = await makeFolder(userId, "范围外");

    const items = {
      normal: newUlid(),
      inSub: newUlid(),
      encSelf: newUlid(),
      inSpace: newUlid(),
      trashed: newUlid(),
      outOf: newUlid(),
      memo: newUlid(),
    };
    await seedItem(userId, items.normal, "可见正文", { folderId: inScope, title: "正常" });
    await seedItem(userId, items.inSub, "子目录正文", { folderId: await makeFolder(userId, "另", inScope), title: "子目录" });
    await seedItem(userId, items.encSelf, "加密正文", { folderId: inScope, title: "加密", encSelf: 1 });
    await seedItem(userId, items.inSpace, "空间正文", { inEncSpace: 1, title: "空间内" });
    await seedItem(userId, items.trashed, "已删正文", { folderId: inScope, title: "已删", deleted: true });
    await seedItem(userId, items.outOf, "范围外正文", { folderId: outOfScope, title: "范围外" });
    await seedItem(userId, items.memo, "Memo 正文", { type: "memo", title: null });

    const { secret } = await makeToken(cookie, { folder_scope: [inScope] });

    const visible = (await call(secret, "list_items", {})).body;
    const ids = (payload(visible).items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toContain(items.normal);
    // 含子文件夹（需求 §4.5 的两层展开）
    expect(ids.some((id) => id === items.inSub)).toBe(true);
    // 范围外 / 加密 / 空间内 / 回收站 / Memo 全部不可见
    for (const hidden of [items.outOf, items.encSelf, items.inSpace, items.trashed, items.memo]) {
      expect(ids).not.toContain(hidden);
    }

    // 逐个 read_item 也读不到，且与「不存在」响应体一致
    for (const hidden of [items.outOf, items.encSelf, items.inSpace, items.trashed]) {
      const got = await call(secret, "read_item", { id: hidden });
      const ghost = await call(secret, "read_item", { id: newUlid() });
      expect(got.body.result?.isError).toBe(true);
      expect(JSON.stringify(got.body)).toBe(JSON.stringify(ghost.body));
    }
  });

  it("勾了「包含 Memo」才看得见 Memo，且与是否勾了范围无关", async () => {
    const { cookie, userId } = await registerUser("owner1", 1);
    await seedItem(userId, newUlid(), "Memo 正文", { type: "memo", title: null });

    const off = await makeToken(cookie, { name: "不含 Memo" });
    expect((payload((await call(off.secret, "list_items", {})).body).items as unknown[])).toHaveLength(0);

    const on = await makeToken(cookie, { name: "含 Memo", include_memos: 1 });
    const items = payload((await call(on.secret, "list_items", {})).body).items as Array<{ type: string }>;
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe("memo");
  });

  it("跨租户：别人的条目对令牌不可见（owner 也不行）", async () => {
    const { cookie } = await registerUser("owner1", 1);
    await openRegistration(cookie);
    const other = await registerUser("family", 2);
    const theirItem = newUlid();
    await seedItem(other.userId, theirItem, "别人的正文", { title: "他们的" });

    const { secret } = await makeToken(cookie);
    const items = payload((await call(secret, "list_items", {})).body).items as Array<{ id: string }>;
    expect(items.map((i) => i.id)).not.toContain(theirItem);
    expect((await call(secret, "read_item", { id: theirItem })).body.result?.isError).toBe(true);
  });
});

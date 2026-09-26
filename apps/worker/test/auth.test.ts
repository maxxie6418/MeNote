/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SESSION_COOKIE_NAME, base64UrlEncode } from "@menote/shared";
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";

interface SendOptions {
  cookie?: string;
  /** 传 null 表示不带 Origin 头；不传则用本站 origin */
  origin?: string | null;
  /** false 表示故意不带 CSRF 头 */
  csrf?: boolean;
}

/** 登录密钥：32 字节 base64url（服务端只做 HMAC 比对，不校验 KDF 结果） */
function loginKey(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return base64UrlEncode(bytes);
}

async function send(
  method: string,
  path: string,
  body: unknown,
  options: SendOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.csrf !== false) headers["X-Menote"] = "1";
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers["Origin"] = origin;
  if (options.cookie) headers["Cookie"] = options.cookie;

  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

function cookieOf(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return (raw.split(";")[0] ?? "").trim();
}

async function registerUser(
  username: string,
  seed: number,
): Promise<{ cookie: string; body: { user: { id: string; username: string; role: string } } }> {
  const res = await send("POST", "/api/auth/register", { username, login_key: loginKey(seed) });
  const body = (await res.json()) as { user: { id: string; username: string; role: string } };
  return { cookie: cookieOf(res), body };
}

async function openRegistration(cookie: string): Promise<Response> {
  return send("PUT", "/api/admin/registration", { open: true }, { cookie });
}

async function getMe(cookie?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers["Cookie"] = cookie;
  return SELF.fetch(`${ORIGIN}/api/auth/me`, { headers });
}

beforeEach(async () => {
  await freshDatabase();
});

describe("注册", () => {
  it("测试环境已注入 AUTH_PEPPER（否则整组认证用例会在无 pepper 下假通过）", () => {
    expect(typeof env.AUTH_PEPPER).toBe("string");
    expect(env.AUTH_PEPPER.length).toBeGreaterThan(0);
    expect(env.AUTH_PEPPER).not.toBe("undefined");
  });

  it("首位注册即 owner，并自动登录（下发会话 Cookie）", async () => {
    const res = await send("POST", "/api/auth/register", {
      username: "Alice",
      login_key: loginKey(1),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: { role: string; username: string } };
    expect(body.user.role).toBe("owner");
    expect(body.user.username).toBe("Alice");

    const cookie = cookieOf(res);
    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);

    const me = await getMe(cookie);
    expect(me.status).toBe(200);
    expect(((await me.json()) as { role: string }).role).toBe("owner");
  });

  it("注册开关默认关闭：用户已存在时新注册返回 403 forbidden", async () => {
    await registerUser("Alice", 1);

    const res = await send("POST", "/api/auth/register", { username: "Bob", login_key: loginKey(2) });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("forbidden");
  });

  it("owner 打开注册开关后，新用户注册为 member；非 owner 不能改开关", async () => {
    const owner = await registerUser("Alice", 1);
    const user = await send("POST", "/api/auth/register", { username: "x", login_key: loginKey(2) });
    expect(user.status).toBe(403);

    expect((await openRegistration(owner.cookie)).status).toBe(200);

    const bob = await registerUser("Bob", 2);
    expect(bob.body.user.role).toBe("member");

    // member 不能改注册开关
    const forbidden = await send("PUT", "/api/admin/registration", { open: false }, { cookie: bob.cookie });
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as { code: string }).code).toBe("forbidden");
  });

  it("用户名非法返回 422；重名（不区分大小写）返回 422 且提示占用", async () => {
    const bad = await send("POST", "/api/auth/register", { username: "中文名", login_key: loginKey(1) });
    expect(bad.status).toBe(422);

    const owner = await registerUser("Alice", 1);
    await openRegistration(owner.cookie);

    const dup = await send("POST", "/api/auth/register", { username: "ALICE", login_key: loginKey(2) });
    expect(dup.status).toBe(422);
    expect(((await dup.json()) as { message: string }).message).toBe("用户名已被占用");
  });
});

describe("prelogin", () => {
  it("不存在的用户名返回确定性假盐；注册后返回真盐，且大小写不敏感", async () => {
    const first = await send("POST", "/api/auth/prelogin", { username: "ghost" });
    const second = await send("POST", "/api/auth/prelogin", { username: "ghost" });
    expect(first.status).toBe(200);

    const a = (await first.json()) as { auth_salt: string; auth_kdf: { alg: string } };
    const b = (await second.json()) as { auth_salt: string };
    expect(a.auth_salt).toBe(b.auth_salt);
    expect(a.auth_kdf.alg).toBe("PBKDF2-SHA256");

    await registerUser("Alice", 1);
    const real = (await (await send("POST", "/api/auth/prelogin", { username: "Alice" })).json()) as {
      auth_salt: string;
    };
    const upper = (await (await send("POST", "/api/auth/prelogin", { username: "ALICE" })).json()) as {
      auth_salt: string;
    };
    expect(real.auth_salt).not.toBe(a.auth_salt);
    expect(upper.auth_salt).toBe(real.auth_salt);
  });
});

describe("登录与会话", () => {
  it("正确密钥下发会话；错误密钥与不存在的用户都返回同一文案 401", async () => {
    await registerUser("Alice", 1);

    const bad = await send("POST", "/api/auth/login", { username: "Alice", login_key: loginKey(9) });
    expect(bad.status).toBe(401);
    expect(((await bad.json()) as { message: string }).message).toBe("用户名或密码错误");

    const missing = await send("POST", "/api/auth/login", { username: "Nobody", login_key: loginKey(9) });
    expect(missing.status).toBe(401);
    expect(((await missing.json()) as { message: string }).message).toBe("用户名或密码错误");

    const ok = await send("POST", "/api/auth/login", { username: "Alice", login_key: loginKey(1) });
    expect(ok.status).toBe(200);
    expect(cookieOf(ok).startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);

    // 大小写不敏感登录
    const upper = await send("POST", "/api/auth/login", { username: "ALICE", login_key: loginKey(1) });
    expect(upper.status).toBe(200);
  });

  it("连续失败 5 次后进入冷却：429 带剩余秒数，冷却期内正确密钥也被拒", async () => {
    await registerUser("Alice", 1);

    for (let i = 0; i < 5; i += 1) {
      const res = await send("POST", "/api/auth/login", { username: "Alice", login_key: loginKey(9) });
      expect(res.status).toBe(401);
    }

    const locked = await send("POST", "/api/auth/login", { username: "Alice", login_key: loginKey(9) });
    expect(locked.status).toBe(429);
    const body = (await locked.json()) as { code: string; detail?: { retry_after?: number } };
    expect(body.code).toBe("rate_limited");
    expect(body.detail?.retry_after ?? 0).toBeGreaterThan(0);

    const correct = await send("POST", "/api/auth/login", { username: "Alice", login_key: loginKey(1) });
    expect(correct.status).toBe(429);
  });

  it("未登录访问 /me 返回 401；登出后当前会话失效", async () => {
    expect((await getMe()).status).toBe(401);

    const owner = await registerUser("Alice", 1);
    expect((await getMe(owner.cookie)).status).toBe(200);

    const logout = await send("POST", "/api/auth/logout", {}, { cookie: owner.cookie });
    expect(logout.status).toBe(204);
    expect((await getMe(owner.cookie)).status).toBe(401);
  });

  it("伪造的会话令牌按未登录处理（不 500）", async () => {
    const fake = `${SESSION_COOKIE_NAME}=not-a-real-token`;
    const res = await getMe(fake);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("unauthenticated");
  });
});

describe("修改登录密码", () => {
  it("旧密码失效、新密码可用；当前设备保留，其他设备会话失效", async () => {
    const owner = await registerUser("Alice", 1);
    const second = await send("POST", "/api/auth/login", { username: "Alice", login_key: loginKey(1) });
    const secondCookie = cookieOf(second);
    expect(secondCookie).not.toBe(owner.cookie);

    const changed = await send(
      "POST",
      "/api/auth/password",
      { login_key: loginKey(1), new_login_key: loginKey(3) },
      { cookie: owner.cookie },
    );
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as { invalidated_sessions: number }).invalidated_sessions).toBe(1);

    expect((await getMe(secondCookie)).status).toBe(401);
    expect((await getMe(owner.cookie)).status).toBe(200);

    const oldKey = await send("POST", "/api/auth/login", { username: "Alice", login_key: loginKey(1) });
    expect(oldKey.status).toBe(401);
    const newKey = await send("POST", "/api/auth/login", { username: "Alice", login_key: loginKey(3) });
    expect(newKey.status).toBe(200);
  });

  it("旧密码不正确时拒绝（401），且不改动凭据", async () => {
    const owner = await registerUser("Alice", 1);
    const res = await send(
      "POST",
      "/api/auth/password",
      { login_key: loginKey(7), new_login_key: loginKey(3) },
      { cookie: owner.cookie },
    );
    expect(res.status).toBe(401);

    const stillOld = await send("POST", "/api/auth/login", { username: "Alice", login_key: loginKey(1) });
    expect(stillOld.status).toBe(200);
  });
});

describe("CSRF 与请求头", () => {
  it("缺少 X-Menote 头返回 403 csrf", async () => {
    const res = await send("POST", "/api/auth/prelogin", { username: "ghost" }, { csrf: false });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("csrf");
  });

  it("Origin 与本站不一致返回 403 csrf", async () => {
    const res = await send(
      "POST",
      "/api/auth/prelogin",
      { username: "ghost" },
      { origin: "https://evil.test" },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("csrf");
  });

  it("GET 不受 CSRF 约束", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/health`);
    expect(res.status).toBe(200);
  });
});

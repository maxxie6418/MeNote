/**
 * 本地开发服种子账号：`admin` / `admin123`（`pnpm dev:seed`）。
 *
 * ── 为什么走接口、不直接写库 ──────────────────────────────────────────
 * 登录接口**不收密码**，只收 `login_key`（浏览器侧派生，见
 * `apps/web/src/features/auth/kdf.ts` 与认证设计 §2）。本脚本因此完整复刻浏览器那一步：
 *
 *   1. `GET  /api/auth/registration-state` → 库里还有人吗
 *   2. `POST /api/auth/prelogin`  { username }            → 拿盐与 KDF 参数
 *   3. PBKDF2-SHA256(password, salt, iterations, dkLen)   → base64url
 *   4. `POST /api/auth/register` { username, login_key }  → 建成首位 owner（自动登录）
 *
 * 好处是**哈希逻辑只有 worker 一份**，不存在"脚本里另写一套、哪天对不上"的问题；
 * 脚本也完全不碰数据库文件、不读 `AUTH_PEPPER`。
 *
 * ── 安全边界（这是本脚本存在的前提，不是可选项） ─────────────────────
 * 目标地址必须是 `localhost` / `127.0.0.1` / `[::1]`，否则**拒绝运行**。
 * 加上这道闸，这个脚本在任何情况下都不可能把弱口令账号写进线上库；
 * 它也只是本地开发工具，不参与 `build` / `deploy` 任何一条链路。
 *
 * ── 幂等 ───────────────────────────────────────────────────────────
 * 库里已经有用户时**直接退出 0 且什么都不做**，绝不覆盖既有账号。
 * 想重置本地数据见 `wiki/guides/local-dev.md` §九（删 `apps/web/.wrangler/state`）。
 */
import { webcrypto } from "node:crypto";

/**
 * CSRF 自定义头（架构 §13.2）。这里**内联**而不从 `@menote/shared` import：
 * shared 的 dist 内部是无扩展名的相对导入，Node 裸跑解析不了（vite/vitest 走打包器才没事），
 * 为此给根包加一条 workspace 依赖不划算。
 *
 * 两处值若哪天在 `packages/shared/src/auth.ts` 改了，这里会**响亮地失败**——
 * 缺头直接 403，不会静默写出坏数据。
 */
const CSRF_HEADER_NAME = "X-Menote";
const CSRF_HEADER_VALUE = "1";

const BASE = (process.env.MENOTE_DEV_URL ?? "http://localhost:5173").replace(/\/+$/, "");
const USERNAME = process.env.MENOTE_SEED_USER ?? "admin";
const PASSWORD = process.env.MENOTE_SEED_PASSWORD ?? "admin123";
/** `--verify`：不建号，只确认这组凭据现在还能登进去 */
const VERIFY_ONLY = process.argv.includes("--verify");

/** 弱口令只允许出现在本机：解析出的主机名必须是回环地址 */
function assertLocalOnly(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`MENOTE_DEV_URL 不是合法 URL：${url}`);
  }
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (!local) {
    throw new Error(
      `拒绝执行：目标 ${url} 不是本机地址。\n` +
        `本脚本会建一个弱口令账号，只能对本地开发服用。\n` +
        `线上库请走正常注册流程。`,
    );
  }
}

async function call(path, init) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    // 所有非 GET 的 /api/* 必须带这个头（架构 §13.2，CSRF 第一层）
    headers: { "content-type": "application/json", [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE, ...init?.headers },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

/** 与 `features/auth/kdf.ts` 的 `deriveLoginKey` 同一套：PBKDF2-SHA256 → base64url */
async function deriveLoginKey(password, saltBase64Url, kdf) {
  if (kdf?.alg !== "PBKDF2-SHA256") {
    throw new Error(`未预期的 KDF 算法：${kdf?.alg}（本脚本只实现了 PBKDF2-SHA256）`);
  }
  const salt = Buffer.from(saltBase64Url, "base64url");
  const baseKey = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: kdf.iterations, hash: "SHA-256" },
    baseKey,
    kdf.dkLen * 8,
  );
  return Buffer.from(bits).toString("base64url");
}

async function main() {
  assertLocalOnly(BASE);
  console.log(`目标 ${BASE}`);

  // 0) 服务在不在
  let health;
  try {
    health = await call("/api/health");
  } catch (error) {
    throw new Error(`连不上 ${BASE}：${error.message}\n先跑 pnpm dev。`, { cause: error });
  }
  if (health.status !== 200) {
    throw new Error(`/api/health 返回 ${health.status}：${JSON.stringify(health.body)}`);
  }

  // 1) 库里有没有人——有就什么都不做，绝不覆盖
  const state = await call("/api/auth/registration-state");
  if (state.status !== 200) {
    throw new Error(`读注册状态失败 ${state.status}：${JSON.stringify(state.body)}`);
  }
  if (state.body?.has_users === true) {
    if (!VERIFY_ONLY) {
      console.log("库里已经有用户了，什么都不做。");
      console.log("想重置本地数据：删掉 apps/web/.wrangler/state 后重启 pnpm dev，再跑本脚本。");
      return;
    }
    console.log("库里已有用户，按 --verify 只校验登录。");
  } else if (VERIFY_ONLY) {
    throw new Error("库里还没有用户，先不带 --verify 跑一次建号。");
  } else {
    await seed();
  }

  await verify();
}

/** 建号：取盐 → 派生 → 注册（首位用户自动成为 owner） */
async function seed() {
  const pre = await call("/api/auth/prelogin", {
    method: "POST",
    body: JSON.stringify({ username: USERNAME }),
  });
  if (pre.status !== 200) {
    throw new Error(`prelogin 失败 ${pre.status}：${JSON.stringify(pre.body)}`);
  }
  const loginKey = await deriveLoginKey(PASSWORD, pre.body.auth_salt, pre.body.auth_kdf);
  const created = await call("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username: USERNAME, login_key: loginKey }),
  });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`注册失败 ${created.status}：${JSON.stringify(created.body)}`);
  }
  const user = created.body?.user;
  console.log(`建好了：${user?.username}（role=${user?.role}）`);
}

/**
 * 校验登录：走的是**另一个端点**（`/api/auth/login`），服务端拿存下来的
 * `auth_verifier` 比对——所以这一步过了才能说"密码确实是这个"。
 */
async function verify() {
  const pre = await call("/api/auth/prelogin", {
    method: "POST",
    body: JSON.stringify({ username: USERNAME }),
  });
  if (pre.status !== 200) {
    throw new Error(`prelogin 失败 ${pre.status}：${JSON.stringify(pre.body)}`);
  }
  const loginKey = await deriveLoginKey(PASSWORD, pre.body.auth_salt, pre.body.auth_kdf);
  const logged = await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: USERNAME, login_key: loginKey }),
  });
  if (logged.status !== 200) {
    throw new Error(`登录校验失败 ${logged.status}：${JSON.stringify(logged.body)}`);
  }
  const user = logged.body?.user;
  console.log(`登录校验通过：${user?.username}（role=${user?.role}）`);
  console.log(`登录：${BASE}  用户名 ${USERNAME}  密码 ${PASSWORD}`);
}

main().catch((error) => {
  console.error(`失败：${error.message}`);
  process.exitCode = 1;
});

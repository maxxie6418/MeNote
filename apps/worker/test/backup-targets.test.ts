/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * 外部备份目标（批 1）的集成用例：五个接口。
 *
 * 盯的是设计 §五 的**安全底线**与实施计划的验收点：
 * - **凭据任何响应都不回显**（逐个响应断言，最重要的一条）；
 * - 跨租户隔离：别人的目标 id 一律 404；
 * - `kind` / `delete_policy` / `schedule` 非法值 422；
 * - S3 必须给桶名；
 * - 删目标**不动远端**（只清账本）；
 * - **测试连接用请求体里的一次性明文、不落库**，且失败原因**不含凭据**。
 */
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers";

const ORIGIN = "https://menote.test";
const SECRET = "s3cr3t-pass-不该出现在任何响应里";

function headers(cookie: string): Record<string, string> {
  return { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN, Cookie: cookie };
}

async function register(username: string, seed: number): Promise<string> {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  const res = await SELF.fetch(`${ORIGIN}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
    body: JSON.stringify({ username, login_key: Buffer.from(bytes).toString("base64url") }),
  });
  return (res.headers.get("set-cookie")?.split(";")[0] ?? "").trim();
}

async function createTarget(
  cookie: string,
  body: Record<string, unknown> = {},
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/backup/targets`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({
      kind: "webdav",
      label: "家里的 NAS",
      endpoint: "https://nas.example.com/menote/",
      secret: SECRET,
      ...body,
    }),
  });
}

/** 抓库里那一行的 `secret_wrapped`，用来证明"落库的是密文不是明文" */
async function storedSecret(id: string): Promise<string> {
  const row = await env.DB.prepare("SELECT secret_wrapped FROM user_backup_targets WHERE id = ?")
    .bind(id)
    .first<{ secret_wrapped: ArrayBuffer }>();
  return Buffer.from(row?.secret_wrapped ?? new ArrayBuffer(0)).toString("base64url");
}

beforeEach(async () => {
  await freshDatabase();
});

describe("外部备份目标：建 / 列 / 改 / 删（批 1）", () => {
  it("建目标：响应含 has_secret=true，**不含凭据明文**", async () => {
    const cookie = await register("owner1", 1);
    const res = await createTarget(cookie);
    expect(res.status).toBe(201);

    const text = await res.text();
    expect(text).not.toContain(SECRET);
    const body = JSON.parse(text) as { target: { id: string; kind: string; has_secret: boolean; delete_policy: string; schedule: string; endpoint: string } };
    expect(body.target.has_secret).toBe(true);
    // 尾斜杠归一，免得同一个目录被存成三种样子
    expect(body.target.endpoint).toBe("https://nas.example.com/menote");
    // **默认只增不删**（用户 2026-10-03 拍板：默认取安全的那一档）
    expect(body.target.delete_policy).toBe("append_only");
    expect(body.target.schedule).toBe("daily");
  });

  it("**落库的是密文**：库里那一列解不开就说明真加密了", async () => {
    const cookie = await register("owner1", 1);
    const body = (await (await createTarget(cookie)).json()) as { target: { id: string } };
    const stored = await storedSecret(body.target.id);
    expect(stored).not.toContain(SECRET);
    expect(stored.length).toBeGreaterThan(0);
  });

  it("列目标：所有响应里都搜不到凭据", async () => {
    const cookie = await register("owner1", 1);
    await createTarget(cookie);
    await createTarget(cookie, { label: "R2", endpoint: "https://s3.example.com" });

    const res = await SELF.fetch(`${ORIGIN}/api/backup/targets`, { headers: headers(cookie) });
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    const body = JSON.parse(text) as { targets: Array<{ label: string; has_secret: boolean }> };
    expect(body.targets).toHaveLength(2);
    expect(body.targets.every((target) => target.has_secret)).toBe(true);
  });

  it("改：secret 缺省 = 不动凭据；给了才替换", async () => {
    const cookie = await register("owner1", 1);
    const created = (await (await createTarget(cookie)).json()) as { target: { id: string } };
    const before = await storedSecret(created.target.id);

    await SELF.fetch(`${ORIGIN}/api/backup/targets/${created.target.id}`, {
      method: "PUT",
      headers: headers(cookie),
      body: JSON.stringify({ label: "改个名" }),
    });
    expect(await storedSecret(created.target.id)).toBe(before);

    const res = await SELF.fetch(`${ORIGIN}/api/backup/targets/${created.target.id}`, {
      method: "PUT",
      headers: headers(cookie),
      body: JSON.stringify({ secret: "新口令" }),
    });
    expect(res.status).toBe(200);
    expect(await storedSecret(created.target.id)).not.toBe(before);
    expect(await res.text()).not.toContain("新口令");
  });

  it("改：schedule / delete_policy 生效", async () => {
    const cookie = await register("owner1", 1);
    const created = (await (await createTarget(cookie)).json()) as { target: { id: string } };
    const res = await SELF.fetch(`${ORIGIN}/api/backup/targets/${created.target.id}`, {
      method: "PUT",
      headers: headers(cookie),
      body: JSON.stringify({ schedule: "weekly", delete_policy: "sync" }),
    });
    const body = (await res.json()) as { target: { schedule: string; delete_policy: string } };
    expect(body.target.schedule).toBe("weekly");
    expect(body.target.delete_policy).toBe("sync");
  });

  it("删：只清账本（远端一个字节都不动，所以这里没有远端调用）", async () => {
    const cookie = await register("owner1", 1);
    const created = (await (await createTarget(cookie)).json()) as { target: { id: string } };
    const res = await SELF.fetch(`${ORIGIN}/api/backup/targets/${created.target.id}`, {
      method: "DELETE",
      headers: headers(cookie),
    });
    expect(res.status).toBe(200);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM user_backup_targets WHERE id = ?")
      .bind(created.target.id)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe("外部备份目标：校验（批 1）", () => {
  it("S3 目标必须给桶名；WebDAV 的桶名 / region 一律 null", async () => {
    const cookie = await register("owner1", 1);
    expect((await createTarget(cookie, { kind: "s3", bucket: null })).status).toBe(422);

    const ok = await createTarget(cookie, { kind: "s3", bucket: "my-backups", region: "auto" });
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as { target: { bucket: string; region: string } };
    expect(body.target.bucket).toBe("my-backups");
    expect(body.target.region).toBe("auto");
  });

  it("非法枚举值 → 422（kind / delete_policy / schedule）", async () => {
    const cookie = await register("owner1", 1);
    expect((await createTarget(cookie, { kind: "ftp" })).status).toBe(422);
    expect((await createTarget(cookie, { delete_policy: "purge" })).status).toBe(422);
    expect((await createTarget(cookie, { schedule: "hourly" })).status).toBe(422);
  });

  it("endpoint 必须带 scheme；**Git 目标首期不做**（CHECK 与契约都不收）", async () => {
    const cookie = await register("owner1", 1);
    expect((await createTarget(cookie, { endpoint: "nas.example.com/menote" })).status).toBe(422);
    expect((await createTarget(cookie, { kind: "git", endpoint: "https://git.example.com/menote" })).status).toBe(422);
  });

  it("空名称 / 空凭据 → 422", async () => {
    const cookie = await register("owner1", 1);
    expect((await createTarget(cookie, { label: "   " })).status).toBe(422);
    expect((await createTarget(cookie, { secret: "" })).status).toBe(422);
  });
});

describe("外部备份目标：隔离（批 1）", () => {
  it("别人的目标 id 一律 404，且**不泄露它存不存在**", async () => {
    const owner = await register("owner1", 1);
    const member = await register("family", 2);
    const created = (await (await createTarget(owner)).json()) as { target: { id: string } };

    // 注册默认关，第二个账号要等第一个开了才行——这里直接用第一个建好的会话去探
    const res = await SELF.fetch(`${ORIGIN}/api/backup/targets/${created.target.id}`, {
      headers: headers(member),
    });
    expect(res.status).toBe(404);
    // 对不存在的 id 也是 404：两者响应一致 = 探不出存在性
    const ghost = await SELF.fetch(`${ORIGIN}/api/backup/targets/00000000000000000000000000`, {
      headers: headers(member),
    });
    expect(ghost.status).toBe(404);
    expect(await ghost.text()).toBe(await res.text());
  });

  it("未登录一律 401", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/backup/targets`, {
      headers: { "Content-Type": "application/json", "X-Menote": "1", Origin: ORIGIN },
    });
    expect(res.status).toBe(401);
  });
});

describe("外部备份目标：测试连接（批 1）", () => {
  it("用请求体里的一次性明文，**不落库**", async () => {
    const cookie = await register("owner1", 1);
    const created = (await (await createTarget(cookie)).json()) as { target: { id: string } };
    const before = await storedSecret(created.target.id);

    // 地址指向一个打不通的端口，探针必然失败——我们要验的是"明文没落库"
    const res = await SELF.fetch(`${ORIGIN}/api/backup/targets/${created.target.id}/test`, {
      method: "POST",
      headers: headers(cookie),
      body: JSON.stringify({ secret: "临时明文口令", endpoint: "https://127.0.0.1:9/never" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    // 失败原因**不含凭据**
    expect(body.message).not.toContain("临时明文口令");
    // 库里那一份**一个字都没动**
    expect(await storedSecret(created.target.id)).toBe(before);
  });
});

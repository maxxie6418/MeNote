/**
 * 外部备份目标的路由（M7 第 4 项 批 1；设计 §四）。
 *
 * 五个接口全是**会话鉴权**（`requireSession`）：目标含凭据，不进 URL、不进公开面。
 * 挂 `/api/backup/targets`——`POST .../test` 走请求体里的**一次性明文**，不落库（设计 §四）。
 */
import {
  CreateBackupTargetSchema,
  TestBackupTargetSchema,
  UpdateBackupTargetSchema,
  type BackupTestResult,
} from "@menote/shared";
import { Hono } from "hono";
import * as v from "valibot";
import { createS3Adapter } from "../adapters/s3";
import { BackupAdapterError, type BackupAdapterTarget } from "../adapters/backup-adapter";
import { createWebdavAdapter } from "../adapters/webdav";
import { DomainError } from "../errors";
import { requireSession } from "../middleware/session";
import { readJsonBody } from "../validation";
import {
  createBackupTarget,
  deleteBackupTarget,
  listBackupTargets,
  loadBackupTargetRow,
  readTargetSecret,
  updateBackupTarget,
} from "../services/backup-targets";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

/** 目标 id 的形状（ULID），非法即 422 —— 不去库里"查不到就 404"，那样能探 id 是否存在 */
const IdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(64));

function requireId(raw: string): string {
  const parsed = v.safeParse(IdSchema, raw);
  if (!parsed.success) throw new DomainError("invalid", "目标 ID 格式不合法");
  return parsed.output;
}

app.get("/backup/targets", requireSession, async (c) => {
  return c.json({ targets: await listBackupTargets(c.env.DB, c.get("user").id) });
});

app.post("/backup/targets", requireSession, async (c) => {
  const parsed = v.safeParse(CreateBackupTargetSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");
  const record = await createBackupTarget(c.env, c.get("user").id, parsed.output, Date.now());
  return c.json({ target: record }, 201);
});

app.put("/backup/targets/:id", requireSession, async (c) => {
  const id = requireId(c.req.param("id"));
  const parsed = v.safeParse(UpdateBackupTargetSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");
  return c.json({ target: await updateBackupTarget(c.env, c.get("user").id, id, parsed.output) });
});

/** 删目标：**只清账本，远端文件不动**（设计 §四） */
app.delete("/backup/targets/:id", requireSession, async (c) => {
  await deleteBackupTarget(c.env.DB, c.get("user").id, requireId(c.req.param("id")));
  return c.json({ ok: true });
});

/**
 * 测试连接。
 *
 * 凭据优先用**请求体里的明文**（用户正在输入的那份，尚未落库）；缺省才解库里那份。
 * 无论哪条路，**明文都不进响应、不进日志**——失败时只回一句不含凭据的中文。
 */
app.post("/backup/targets/:id/test", requireSession, async (c) => {
  const userId = c.get("user").id;
  const id = requireId(c.req.param("id"));
  const parsed = v.safeParse(TestBackupTargetSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");

  const row = await loadBackupTargetRow(c.env.DB, userId, id);
  const secret = parsed.output.secret ?? (await readTargetSecret(c.env, row));
  const target: BackupAdapterTarget = {
    id: row.id,
    kind: row.kind,
    endpoint: parsed.output.endpoint ?? row.endpoint,
    bucket: row.bucket,
    region: row.region,
    username: row.username,
    secret,
    delete_policy: row.delete_policy as BackupAdapterTarget["delete_policy"],
  };
  const adapter = row.kind === "s3" ? createS3Adapter(target) : createWebdavAdapter(target);

  const result: BackupTestResult = await adapter
    .probe()
    .then((ok) => ok)
    .catch((error: unknown) =>
      error instanceof BackupAdapterError
        ? { ok: false, message: error.message }
        : { ok: false, message: "连接失败，请稍后重试" },
    );
  return c.json(result);
});

export default app;

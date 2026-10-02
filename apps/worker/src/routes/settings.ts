/**
 * 设置路由（架构 §2.3.2：设置与隐私标记归 `routes/settings.ts` + `services/settings.ts`）。
 *
 * 两类：实例级注册开关（仅 owner，M1）与**用户级设置**（M2-7，跟随账号同步）。
 */
import { RegistrationUpdateSchema, ShareOriginUpdateSchema, UserSettingsWriteSchema } from "@menote/shared";
import { Hono } from "hono";
import type { Context } from "hono";
import * as v from "valibot";
import { DomainError } from "../errors";
import { requireSession } from "../middleware/session";
import {
  getRegistrationState,
  getShareOrigin,
  getUserSettings,
  putUserSettings,
  setRegistrationState,
  setShareOrigin,
} from "../services/settings";
import type { AppEnv } from "../types";
import { readJsonBody } from "../validation";

const app = new Hono<AppEnv>();

function requireOwner(c: Context<AppEnv>): void {
  if (c.get("user").role !== "owner") {
    throw new DomainError("forbidden", "仅管理员可操作");
  }
}

app.get("/settings", requireSession, async (c) => {
  return c.json(await getUserSettings(c.env.DB, c.get("user").id));
});

app.put("/settings", requireSession, async (c) => {
  const parsed = v.safeParse(UserSettingsWriteSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");

  return c.json(
    await putUserSettings(c.env.DB, c.get("user").id, parsed.output, Date.now()),
  );
});

app.get("/admin/registration", requireSession, async (c) => {
  requireOwner(c);
  return c.json(await getRegistrationState(c.env.DB, Date.now()));
});

app.put("/admin/registration", requireSession, async (c) => {
  requireOwner(c);
  const parsed = v.safeParse(RegistrationUpdateSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");

  return c.json(
    await setRegistrationState(
      c.env.DB,
      { open: parsed.output.open, closeAt: parsed.output.close_at },
      Date.now(),
    ),
  );
});

// —— 分享子域（M5-S2）：实例级、仅 owner；空值 = 未配置（分享链接退回当前站点 origin）——

app.get("/admin/share-origin", requireSession, async (c) => {
  requireOwner(c);
  return c.json({ origin: await getShareOrigin(c.env.DB) });
});

app.put("/admin/share-origin", requireSession, async (c) => {
  requireOwner(c);
  const parsed = v.safeParse(ShareOriginUpdateSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");

  return c.json({ origin: await setShareOrigin(c.env.DB, parsed.output.origin) });
});

export default app;

/**
 * 隐私锁门禁材料路由（架构 §2.3.2 的 `routes/crypto.ts`；《隐私锁设计》§4.2）。
 *
 * 四个端点，都需要会话（不是公开接口）：
 * | `GET /api/crypto`        | 取材料（未启用时 `enabled: false`） |
 * | `PUT /api/crypto`        | 启用 / 改密 / 重置 / 重新包裹 K 后整体覆盖（带 `k` 即重包备份包裹） |
 * | `POST /api/crypto/reset` | 忘记密码：服务端用**从根机密派生的备份包裹键**解出 K |
 * | `DELETE /api/crypto`     | 关闭隐私锁（有隐私内容时拒绝） |
 *
 * 响应一律 `no-store`：这是门禁材料，任何中间缓存都不该留。
 */
import { CryptoWriteSchema } from "@menote/shared";
import { Hono } from "hono";
import * as v from "valibot";
import { DomainError } from "../errors";
import { requireSession } from "../middleware/session";
import {
  deleteCryptoMaterials,
  getCryptoState,
  putCryptoMaterials,
  resetContentKey,
} from "../services/crypto";
import type { AppEnv } from "../types";
import { readJsonBody } from "../validation";

const app = new Hono<AppEnv>();

app.get("/crypto", requireSession, async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await getCryptoState(c.env.DB, c.get("user").id));
});

app.put("/crypto", requireSession, async (c) => {
  const parsed = v.safeParse(CryptoWriteSchema, await readJsonBody(c));
  if (!parsed.success) throw new DomainError("invalid", "请求内容不合法");

  c.header("Cache-Control", "no-store");
  return c.json(
    await putCryptoMaterials(c.env, c.env.DB, c.get("user").id, parsed.output, Date.now()),
  );
});

app.post("/crypto/reset", requireSession, async (c) => {
  const result = await resetContentKey(c.env, c.env.DB, c.get("user").id);
  c.header("Cache-Control", "no-store");
  return c.json(result);
});

app.delete("/crypto", requireSession, async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await deleteCryptoMaterials(c.env.DB, c.get("user").id));
});

export default app;

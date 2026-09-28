import type { UserRole } from "@menote/shared";

/**
 * 只用到 **D1 与对象桶** 的最小环境。
 *
 * 服务层按需收窄到这个形状，而不是到处依赖完整的 `EnvBindings`：
 * 一来服务层确实只用这两样（依赖少一点，测试替身就简单一点），
 * 二来"某个服务偷偷读了机密"这种事会直接在类型上暴露。
 */
export interface StorageEnv {
  DB: D1Database;
  /** 附件与版本正文的对象桶；本地没带绑定时为 `undefined`，用到它的代码必须容忍 */
  ATTACHMENTS?: R2Bucket;
}

/** Worker 绑定（wrangler.jsonc 声明；本地 dev 与测试由 miniflare/workerd 模拟） */
export interface EnvBindings extends StorageEnv {
  /** Static Assets 绑定（前端构建产物） */
  ASSETS: Fetcher;
  /**
   * 服务端机密（架构 §13.2）：`auth_verifier = HMAC-SHA256(AUTH_PEPPER, 登录密钥)` 与
   * prelogin 假盐派生都用它。本地放 `.dev.vars`，生产在部署页填写。
   *
   * 【2026-09-28】它同时是**唯一的根机密**：隐私锁内容密钥 K 的"备份包裹键"由它
   * **域分离派生**（`SHA-256(AUTH_PEPPER ‖ "menote-backup-wrap-v1")`，见 `@menote/shared`
   * 的 `backupWrapKeyInput`）。原先单独的 `BACKUP_CRED_KEY` 机密已删除——自托管只配一个。
   */
  AUTH_PEPPER: string;
}

/** 已通过会话鉴权的用户（挂到 Hono 的 context 上） */
export interface SessionUser {
  id: string;
  username: string;
  role: UserRole;
}

/** requireSession 中间件写入的 context 变量 */
export interface SessionVariables {
  user: SessionUser;
  /** 当前会话令牌的 SHA-256（登出与"改密后失效其他设备"要用） */
  tokenHash: ArrayBuffer;
}

/** Hono 应用环境（绑定 + 上下文变量） */
export interface AppEnv {
  Bindings: EnvBindings;
  Variables: SessionVariables;
}

/**
 * 让 `Cloudflare.Env`（workerd 与 `@cloudflare/vitest-pool-workers` 的 `env` 类型）
 * 与本项目的绑定声明合并，测试里可以直接 `env.DB`、`env.AUTH_PEPPER` 且有类型。
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    // 这是声明合并的标准写法（必须用 interface），空体是刻意的
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends EnvBindings {}
  }
}

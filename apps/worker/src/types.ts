import type { UserRole } from "@menote/shared";

/** Worker 绑定（wrangler.jsonc 声明；本地 dev 与测试由 miniflare/workerd 模拟） */
export interface EnvBindings {
  /** D1 数据库（M1 起由运行时自愈建表，见 db/selfheal.ts） */
  DB: D1Database;
  /** Static Assets 绑定（前端构建产物） */
  ASSETS: Fetcher;
  /**
   * 服务端机密（架构 §13.2）：`auth_verifier = HMAC-SHA256(AUTH_PEPPER, 登录密钥)` 与
   * prelogin 假盐派生都用它。本地放 `.dev.vars`，生产在部署页填写。
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

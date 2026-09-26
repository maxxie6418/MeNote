/** Worker 绑定（wrangler.jsonc 声明；本地 dev 与测试由 miniflare/workerd 模拟） */
export interface EnvBindings {
  /** D1 数据库（M0 仅绑定占位，M1 起建表） */
  DB: D1Database;
  /** Static Assets 绑定（前端构建产物） */
  ASSETS: Fetcher;
}

/**
 * 让 `Cloudflare.Env`（workerd 与 `@cloudflare/vitest-pool-workers` 的 `env` 类型）
 * 与本项目的绑定声明合并，测试里可以直接 `env.DB` 且有类型。
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    // 这是声明合并的标准写法（必须用 interface），空体是刻意的
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends EnvBindings {}
  }
}

/** Worker 绑定（wrangler.jsonc 声明；本地 dev 与测试由 miniflare/workerd 模拟） */
export interface EnvBindings {
  /** D1 数据库（M0 仅绑定占位，M1 起建表） */
  DB: D1Database;
  /** Static Assets 绑定（前端构建产物） */
  ASSETS: Fetcher;
}

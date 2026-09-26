/**
 * 测试目录专用的最小 Node 类型声明。
 *
 * 为什么不装 `@types/node`：`apps/web/tsconfig.json` 的 `types` 只有 `vite/client`，
 * 而 **Web 应用本体不该看见 Node API**（否则有人会在组件里 `import fs` 还能通过类型检查）。
 * 只有少数测试（读样式源码做不变量守卫）需要读文件，因此在这里只声明用到的那一个成员。
 */
declare module "node:fs" {
  export function readFileSync(path: URL | string, encoding: "utf8"): string;
}

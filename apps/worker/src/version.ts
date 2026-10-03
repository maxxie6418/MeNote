/**
 * Worker 侧的应用版本（唯一来源，别处不要再写一遍）。
 *
 * 与 `apps/web/src/app/about.ts` 是同一套做法：Vite 在构建期从**根 `package.json`**
 * 注入 `__APP_VERSION__`（`apps/web/vite.config.ts` 的 `define` 对前端与 Worker 同时生效——
 * 它们在同一个构建里）。所以 AGENTS「版本号只维护一份」在 Worker 侧也成立。
 *
 * 没有注入时（例如直接跑 vitest）退化为 `"dev"`，**不编造版本号**。
 *
 * 用途只有一个：写进备份包的 `manifest.app_version`——将来要能判断
 * 「这份备份是哪个版本导出的」，而版本号只有根 `package.json` 说了算。
 */
declare const __APP_VERSION__: string;

export const WORKER_APP_VERSION: string =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__ !== "" ? __APP_VERSION__ : "dev";

/**
 * 「关于」页与账户快捷菜单共用的两个事实（唯一来源，别处不要再写一遍）。
 *
 * 版本号：由 Vite 在构建期从**根 `package.json`** 注入 `__APP_VERSION__`
 * （AGENTS「版本号规范」：根 package.json 的 `version` 是唯一当前版本）。
 * 没有注入时（例如有人在没配 define 的环境里直接跑）退化为 `"dev"`，**不编造版本号**。
 */
declare const __APP_VERSION__: string;

export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__ !== "" ? __APP_VERSION__ : "dev";

/** 项目仓库地址（用户 2026-09-27 要求：设置 › 关于 里要能看到它） */
export const PROJECT_REPO_URL = "https://github.com/maxxie6418/MeNote";

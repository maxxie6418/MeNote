// Workers Builds 的默认部署命令是仓库根的 `npx wrangler deploy`，wrangler 会
// 优先采用 <cwd>/.wrangler/deploy/config.json 指向的「部署配置」并忽略根
// wrangler.jsonc（输入配置）。Vite 构建只会把该指针写到 apps/web/.wrangler/，
// 这里在仓库根再生成一份，指向真正的产物配置，让默认部署命令开箱即用。
// 注意：configPath 相对于 .wrangler/deploy/ 目录解析，故为 ../.. 前缀。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = join(root, ".wrangler", "deploy");

mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "config.json"),
  JSON.stringify({ configPath: "../../apps/web/dist/menote/wrangler.json" }),
);
console.log("build: 已生成 .wrangler/deploy/config.json → apps/web/dist/menote/wrangler.json");

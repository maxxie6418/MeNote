// 首屏 JS 体积预算（架构 §14.1：≤ 200 KB gzip）。
// 统计构建产物 index.html 直接引用的 JS 资源之和；懒加载分包不计入。
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(new URL("../apps/web/dist/client", import.meta.url));
const BUDGET_BYTES = 200 * 1024;

const html = readFileSync(join(distDir, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);

if (scripts.length === 0) {
  console.error("check:size：index.html 未引用任何 JS，构建产物异常");
  process.exit(1);
}

let total = 0;
for (const src of scripts) {
  const file = join(distDir, decodeURI(src).replace(/^\//, ""));
  total += gzipSync(readFileSync(file)).length;
}

const kb = (total / 1024).toFixed(1);
if (total > BUDGET_BYTES) {
  console.error(`check:size：首屏 JS gzip ${kb} KB，超出预算 ${BUDGET_BYTES / 1024} KB`);
  process.exit(1);
}
console.log(`check:size：首屏 JS gzip ${kb} KB ≤ ${BUDGET_BYTES / 1024} KB`);

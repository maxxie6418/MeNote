import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// Cloudflare Vite 插件：dev 时前端 + Worker（workerd + 本地 D1）一体运行；
// build 时产出 dist/client（静态资源）与 output wrangler.json（部署用）。
export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      // 唯一 Worker 配置在仓库根（架构 §2.3）
      configPath: "../../wrangler.jsonc",
    }),
  ],
});

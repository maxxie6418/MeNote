import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import rootPackage from "../../package.json" with { type: "json" };

// Cloudflare Vite 插件：dev 时前端 + Worker（workerd + 本地 D1）一体运行；
// build 时产出 dist/client（静态资源）与 output wrangler.json（部署用）。
//
// `__APP_VERSION__`：版本号只在根 `package.json` 维护一份（AGENTS「版本号规范」），
// 构建期注入前端；「关于」页与账户菜单读它，**不在前端复制一份版本号**。
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(rootPackage.version),
  },
  // 分享查看器（M5-S3）**不另建 html 入口**：@cloudflare/vite-plugin v1.60 的客户端
  // 入口由插件接管，手写 `build.rollupOptions.input` 会让入口解析失败（UNRESOLVED_ENTRY）。
  // 改为 `main.tsx` 按 `/s/<分享ID>` 路径分流（两边动态导入，访客不拉主应用 chunk）。
  plugins: [
    react(),
    cloudflare({
      // 唯一 Worker 配置在仓库根（架构 §2.3）
      configPath: "../../wrangler.jsonc",
    }),
  ],
});

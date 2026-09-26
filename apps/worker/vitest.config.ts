import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// pool-workers 0.22（vitest 4 era）：cloudflareTest 作为 Vitest 插件使用，
// 接收原 poolOptions.workers 选项。仓库根 wrangler.jsonc 是唯一 Worker 配置。
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "../../wrangler.jsonc",
      },
      // 测试专用机密：不是真实密钥（生产在部署页填写，本地放 .dev.vars）。
      // 只在这里注入，避免把机密塞进 wrangler.jsonc 的 vars。
      miniflare: {
        bindings: {
          AUTH_PEPPER: "test-pepper-not-a-real-secret",
        },
      },
    }),
  ],
});

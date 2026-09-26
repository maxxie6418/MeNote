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
    }),
  ],
});

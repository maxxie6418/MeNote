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
      // 2026-09-28 起实例只配**一个**根机密：备份包裹键由它域分离派生，不再有 BACKUP_CRED_KEY。
      miniflare: {
        bindings: {
          AUTH_PEPPER: "test-pepper-not-a-real-secret",
        },
        /**
         * 附件桶（M4-4）：**只在测试里**给 miniflare 加一个同名桶绑定。
         *
         * 为什么不在 `wrangler.jsonc` 里声明：生产绑定要等用户开通 R2 之后再加，
         * 而"新增绑定不会自动供给"——先写进部署配置会让 Workers Builds 挂在没有桶的账户上。
         * 测试用 miniflare 的桶（真实的 R2 API 形状，不是内存假件），所以代码路径是真的。
         */
        r2Buckets: ["ATTACHMENTS"],
      },
    }),
  ],
});

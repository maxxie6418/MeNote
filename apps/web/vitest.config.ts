import { defineConfig } from "vitest/config";
import rootPackage from "../../package.json" with { type: "json" };

// 数据层是纯逻辑 + fake-indexeddb，不需要 jsdom；用 node 环境也能顺带防住"误用 window/document"。
// 需要真实 workerd / D1 的测试在 apps/worker（@cloudflare/vitest-pool-workers）。
export default defineConfig({
  // 与 `vite.config.ts` 同一份来源（根 package.json）：测试里也拿得到版本号，「关于」页有断言
  define: {
    __APP_VERSION__: JSON.stringify(rootPackage.version),
  },
  test: {
    environment: "node",
    // 组件测试用 .tsx（文件头 `@vitest-environment jsdom` 单独切换环境）
    include: ["test/**/*.test.{ts,tsx}"],
  },
});

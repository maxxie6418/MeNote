import { defineConfig } from "vitest/config";

// 数据层是纯逻辑 + fake-indexeddb，不需要 jsdom；用 node 环境也能顺带防住"误用 window/document"。
// 需要真实 workerd / D1 的测试在 apps/worker（@cloudflare/vitest-pool-workers）。
export default defineConfig({
  test: {
    environment: "node",
    // 组件测试用 .tsx（文件头 `@vitest-environment jsdom` 单独切换环境）
    include: ["test/**/*.test.{ts,tsx}"],
  },
});

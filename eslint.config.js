import eslint from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// 行数预算（架构 §2.3.1 / §2.3.3）。
// 注意 flat config 后条覆盖前条：全局 500 → 路由/服务 300 → 入口 100。
const globalMaxLines = ["error", { max: 500, skipBlankLines: true, skipComments: true }];
const domainMaxLines = ["warn", { max: 300, skipBlankLines: true, skipComments: true }];
const entryMaxLines = ["error", { max: 100, skipBlankLines: true, skipComments: true }];

const reactHooksRules =
  reactHooks.configs?.recommended?.rules ??
  reactHooks.configs?.["recommended-latest"]?.rules ??
  {};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-types/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      ".agents/**",
      ".workbuddy/**",
      "prototype/**",
      "docs/**",
      "wiki/**",
      "deliverables/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { fixStyle: "inline-type-imports" },
      ],
    },
  },
  {
    // CLI 脚本以 console 输出为职责，关闭 no-console
    files: ["scripts/**/*.mjs"],
    rules: { "no-console": "off" },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: { "max-lines": globalMaxLines },
  },
  {
    files: ["apps/worker/src/{routes,services,db,jobs,adapters,middleware}/**/*.ts"],
    rules: { "max-lines": domainMaxLines },
  },
  {
    files: ["apps/worker/src/index.ts", "apps/web/src/main.tsx"],
    rules: { "max-lines": entryMaxLines },
  },
  {
    // React hooks 仅前端
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooksRules,
  },
  // —— 依赖方向护栏（架构 §2.3.3 第 1 条）——
  {
    // 路由层不得直接访问仓储层（routes → services → db）
    files: ["apps/worker/src/routes/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/db/**"],
              message: "路由不得直接访问仓储层：先转服务层（架构 §2.3.3）。",
            },
          ],
        },
      ],
    },
  },
  {
    // 服务层不得依赖 Hono、不得反向引用路由
    files: ["apps/worker/src/services/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["hono", "hono/*"],
              message: "服务层不得依赖 Hono（路由层职责，架构 §4.2）。",
            },
            {
              group: ["**/routes/**"],
              message: "服务层不得反向引用路由（架构 §2.3.3）。",
            },
          ],
        },
      ],
    },
  },
  {
    // 仓储层不得引用服务与路由
    files: ["apps/worker/src/db/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/services/**", "**/routes/**"],
              message: "仓储层不得引用服务与路由（架构 §2.3.3）。",
            },
          ],
        },
      ],
    },
  },
  {
    // packages/* 不依赖任何 apps/*（保证两端可运行、可单测）
    files: ["packages/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/apps/**", "@menote/web", "@menote/worker"],
              message: "共享包不得依赖 apps/*（架构 §2.3）。",
            },
          ],
        },
      ],
    },
  },
  // 前端 feature 互不依赖（跨 feature 复用只走 app/ 或 data/）：M2 引入
  // features/ 时补 no-restricted-imports 规则，此处置注释占位。
);
